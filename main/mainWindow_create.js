import electronPkg from 'electron';
const { BrowserWindow, screen, app, ipcMain } = electronPkg;
import { attachToWebContents } from './ipc_browserContextMenu.js';
import {
    restoreWindowsExplorerForShutdown,
    keepWindowsDesktopAtBottom,
} from './ipc_nativeWindows.js';
import { execFile } from 'node:child_process';

// Защита от повторного запуска: before-quit, SIGTERM/SIGINT и watchdog
// могут сработать почти одновременно, а процедура завершения — не быстрая.
let shuttingDown = false;

// Watchdog за оконным менеджером. Если KWin умер — Electron должен
// завершиться сам, не дожидаясь сигналов от сессионного скрипта.
let wmWatchdogTimer = null;
let wmSeen = false;              // видели ли мы KWin живым хотя бы раз
let wmFailures = 0;              // подряд идущие неудачные проверки

/**
 * Проверяет, жив ли KWin.
 *
 * Используем pgrep -x kwin_x11 — это буквально «есть ли процесс».
 * Считаем WM живым, если процесс найден. Проверка лёгкая (<5 мс),
 * запускается раз в секунду — накладных расходов незаметно.
 *
 * Почему не xprop -root _NET_SUPPORTING_WM_CHECK: после SIGKILL
 * X11-свойство на root-окне остаётся (никто его не снимает), и такая
 * проверка даст ложное "WM жив" именно в том сценарии, который нам
 * важен — аварийное завершение сессии.
 */
function checkWM(callback) {
    execFile('pgrep', ['-x', 'kwin_x11'], { timeout: 1000 }, (err, stdout) => {
        const alive = !err && (stdout || '').trim().length > 0;
        callback(alive);
    });
}

function startWMWatchdog(mainWindow) {
    // Даём KWin время на старт: сессионный скрипт запускает его чуть
    // раньше Electron, но полная инициализация занимает мгновения.
    // Первая проверка — через 3 секунды, дальше раз в секунду.
    setTimeout(() => {
        wmWatchdogTimer = setInterval(() => {
            checkWM((alive) => {
                if (alive) {
                    wmSeen = true;
                    wmFailures = 0;
                    return;
                }

                // KWin не найден. Требуем два подряд провала (2 секунды
                // без процесса), чтобы не сработать на коротком мерцании
                // при kwin_x11 --replace, когда старый процесс уже ушёл,
                // а новый ещё не поднялся.
                wmFailures++;

                // Если KWin ни разу не был жив — возможно, сессия ещё
                // стартует или это не сессионный запуск. Не трогаем.
                if (!wmSeen) return;

                if (wmFailures >= 2) {
                    console.log('[shutdown] KWin исчез — инициирую завершение');
                    shutdownAll(mainWindow);
                }
            });
        }, 1000);
    }, 3000);
}

/**
 * Корректное завершение Omniscience.
 *
 * Порядок:
 *   1. Берём список всех BrowserWindow, кроме главного.
 *   2. Закрываем их по одному; после каждого — короткий yield
 *      (setImmediate), чтобы event loop успел обработать close и,
 *      если приложение плодит окна прямо сейчас — увидеть новые.
 *   3. Цикл повторяется, пока чужих окон не останется.
 *      Это закрывает случай "новое окно появилось посреди завершения".
 *   4. Закрываем сам mainWindow.
 *   5. app.quit() — гарантированный выход процесса.
 *
 * Идемпотентна: повторные вызовы ничего не делают.
 */
async function shutdownAll(mainWindow) {
    if (shuttingDown) return;
    shuttingDown = true;

    // Гасим watchdog — он своё дело сделал.
    if (wmWatchdogTimer) {
        clearInterval(wmWatchdogTimer);
        wmWatchdogTimer = null;
    }

    await restoreWindowsExplorerForShutdown();

    try {
        while (true) {
            const others = BrowserWindow.getAllWindows()
                .filter(w => w !== mainWindow && !w.isDestroyed());

            if (others.length === 0) break;

            for (const w of others) {
                try { w.close(); } catch (_) { /* окно уже умерло */ }
                // даём event loop обработать close и возможный spawn новых окон
                await new Promise(resolve => setImmediate(resolve));
            }
        }
    } catch (err) {
        console.error('[shutdown] error closing secondary windows:', err);
    }

    // Последним — главное окно.
    try {
        if (!mainWindow.isDestroyed()) {
            mainWindow.close();
        }
    } catch (err) {
        console.error('[shutdown] error closing main window:', err);
    }

    // Гарантированный выход процесса, даже если сработал before-quit
    // и мы подавили его preventDefault'ом.
    try { app.quit(); } catch (_) { }
}

export default async function () {
    const primaryDisplay = screen.getPrimaryDisplay();
    const bounds = process.platform === 'win32'
        ? primaryDisplay.bounds
        : { x: 0, y: 0, ...primaryDisplay.workAreaSize };

    const isSession = process.env.OMNISCIENCE_SESSION === '1' && process.platform !== 'win32';

    global.mainWindow = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        show: process.platform !== 'win32',
        type: 'desktop',
        frame: false,
        icon: global.paths.icon,
        focusable: true,
        skipTaskbar: true,
        webPreferences: {
            enableRemoteModule: false,
            nodeIntegration: false,
            contextIsolation: true,
            autoplayPolicy: 'no-user-gesture-required',
            webSecurity: true,
            webviewTag: true,
        },
    });

    if (process.platform === 'win32') {
        // ВАЖНО: setWindowsDesktopWindow больше НЕ вызываем — она делает
        // SetParent(WorkerW), после чего окно структурно оказывается под
        // SysListView32 и не получает ни кликов, ни фокуса.

        let desktopOrderUpdate = Promise.resolve();
        let desktopOrderTimer = null;
        let desktopOrderPending = false;
        const keepDesktopAtBottom = () => {
            if (desktopOrderPending
                || global.mainWindow.isDestroyed()
                || !global.mainWindow.isVisible()) return;
            desktopOrderPending = true;
            desktopOrderUpdate = desktopOrderUpdate
                .then(() => keepWindowsDesktopAtBottom(global.mainWindow))
                .catch((error) => {
                    console.error('[windows-desktop] failed to keep desktop at bottom:', error.message);
                })
                .finally(() => {
                    desktopOrderPending = false;
                    if (global.mainWindow.isDestroyed()) return;
                    desktopOrderTimer = setTimeout(keepDesktopAtBottom, 1000);
                    desktopOrderTimer.unref();
                });
        };
        global.mainWindow.on('blur', keepDesktopAtBottom);
        global.mainWindow.on('focus', keepDesktopAtBottom);
        global.mainWindow.on('show', keepDesktopAtBottom);
        global.mainWindow.once('closed', () => {
            if (desktopOrderTimer) clearTimeout(desktopOrderTimer);
        });

        // При смене метрик дисплея нужно только пере-применить bounds
        // штатными средствами Electron, без PS1.
        const handleDisplayMetricsChanged = (_event, _display, changedMetrics) => {
            if (changedMetrics.includes('bounds') || changedMetrics.includes('workArea')) {
                const primary = screen.getPrimaryDisplay();
                global.mainWindow.setBounds(primary.bounds);
                keepDesktopAtBottom();
            }
        };
        screen.on('display-metrics-changed', handleDisplayMetricsChanged);
        global.mainWindow.once('closed', () => {
            screen.removeListener('display-metrics-changed', handleDisplayMetricsChanged);
        });

        global.mainWindow.once('ready-to-show', () => {
            if (global.mainWindow.isDestroyed()) return;
            // showInactive() специально НЕ фокусирует — было ошибкой.
            global.mainWindow.show();
            global.mainWindow.focus();
            keepDesktopAtBottom();
        });
    }

    attachToWebContents(global.mainWindow.webContents);

    // ------------------------------------------------------------
    // Завершение сессии
    // ------------------------------------------------------------
    // SIGTERM/SIGINT прилетают, если сессионный скрипт корректно
    // сигналит процессу. Даже если эта цепочка не сработает — watchdog
    // ниже поймает смерть KWin и завершит Electron сам.
    process.on('SIGTERM', () => shutdownAll(global.mainWindow));
    process.on('SIGINT', () => shutdownAll(global.mainWindow));

    // Если mainWindow закрывают напрямую (X, Alt+F4, kill окна) —
    // перехватываем quit и проводим ту же процедуру.
    app.on('before-quit', (e) => {
        if (!shuttingDown) {
            e.preventDefault();
            shutdownAll(global.mainWindow);
        }
    });

    // Watchdog запускаем только в сессионном режиме. При обычном
    // `npx electron .` из терминала разработчика KWin может быть
    // чужим или отсутствовать — там watchdog не нужен и может
    // сработать ложно.
    if (isSession) {
        startWMWatchdog(global.mainWindow);
    }

    const backgroundReady = new Promise((resolve, reject) => {
        const win = global.mainWindow;
        const cleanup = () => {
            win.removeListener('ready-to-show', onReady);
            win.removeListener('closed', onClosed);
            win.webContents.removeListener('did-fail-load', onFailedLoad);
        };
        const onReady = () => {
            cleanup();
            resolve();
        };
        const onClosed = () => {
            cleanup();
            reject(new Error('Background window closed before it was ready'));
        };
        const onFailedLoad = (_event, errorCode, description, url, isMainFrame) => {
            if (!isMainFrame || errorCode === -3) return;
            cleanup();
            reject(new Error(`Background window failed to load (${errorCode}): ${description} (${url})`));
        };

        win.once('ready-to-show', onReady);
        win.once('closed', onClosed);
        win.webContents.on('did-fail-load', onFailedLoad);
    });
    global.mainWindowReady = backgroundReady;
    backgroundReady.catch(() => {});

    await global.$.mainWindow_on_loaded();
}