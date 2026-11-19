import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createFixedVhd } from './vhd.js';
import { zipAndSplit } from './zip.js';

const MB = 1024 * 1024;

export async function runPipeline(opts, send, signal) {
  const { items, maxSizeBytes, outputDir, baseName, renameToTxt } = opts;

  if (!items?.files?.length) throw new Error('Нет данных для обработки');
  if (maxSizeBytes < MB) throw new Error('Да скинь ты файл напрямую, Господи!');
  if (!outputDir) throw new Error('Не выбран путь сохранения');
  if (!baseName) throw new Error('Не задано имя файла');

  await fsp.mkdir(outputDir, { recursive: true });

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omni-archiver-'));
  const vhdPath = path.join(tempDir, 'data.vhd');

  let hadError = false;
  try {
    const vhdSizeBytes = Math.max(
      256 * MB,
      Math.ceil((items.totalBytes * 1.2 + 128 * MB) / MB) * MB,
    );
    const vhdSizeMb = Math.floor(vhdSizeBytes / MB);

    send({ stage: 'vhd-create', message: 'Создаю VHD-файл…', progress: 0 });
    await createFixedVhd(vhdPath, vhdSizeBytes, signal);
    send({ stage: 'vhd-create', message: 'VHD-файл создан', progress: 100 });
    if (signal.aborted) throw new Error('Отменено');

    send({ stage: 'mount', message: 'Запрашиваю права администратора…', progress: 0 });
    const spec = {
      vhdPath,
      vhdSizeMb,
      directories: items.directories,
      files: items.files,
      totalBytes: items.totalBytes,
    };
    await runElevatedVhdFill(spec, tempDir, send, signal);
    if (signal.aborted) throw new Error('Отменено');

    send({ stage: 'compress', message: 'Сжимаю и разбиваю…', progress: 0 });
    const result = await zipAndSplit({
      vhdPath,
      outputDir,
      baseName,
      maxSizeBytes,
      renameToTxt,
      onProgress: (p) => send({ stage: 'compress', ...p }),
      signal,
    });

    send({ stage: 'done', message: 'Готово', progress: 100, result });
    return result;
  } catch (e) {
    hadError = true;
    throw e;
  } finally {
    if (hadError) {
      console.error(`[omni-archiver] tempDir сохранён для отладки: ${tempDir}`);
    } else {
      try { await fsp.rm(tempDir, { recursive: true, force: true }); } catch { }
    }
  }
}

async function runElevatedVhdFill(spec, tempDir, send, signal) {
  const specFile = path.join(tempDir, 'spec.json');
  const statusFile = path.join(tempDir, 'status.json');
  const scriptFile = path.join(tempDir, 'fill.ps1');
  const logFile = path.join(tempDir, 'elevated.log');
  const exitFile = path.join(tempDir, 'elevated.exit');
  const bootFile = `${statusFile}.boot`;

  const scriptSrc = fileURLToPath(new URL('./vhd.ps1', import.meta.url));

  await fsp.writeFile(specFile, JSON.stringify(spec), 'utf8');
  await fsp.writeFile(statusFile, JSON.stringify({ stage: 'pending' }), 'utf8');
  await fsp.copyFile(scriptSrc, scriptFile);

  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

  // Внутренняя команда elevated-PowerShell: выполняет vhd.ps1,
  // весь stdout/stderr → elevated.log, exit code → elevated.exit
  const innerCmd =
    `$ErrorActionPreference = 'Continue'; ` +
    `& ${q(scriptFile)} -SpecFile ${q(specFile)} -StatusFile ${q(statusFile)} *> ${q(logFile)}; ` +
    `$code = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }; ` +
    `$code | Out-File -FilePath ${q(exitFile)} -Encoding ASCII -Force`;

  // Внешняя команда: запрашивает UAC и ждёт.
  // Аргументы передаются МАССИВОМ — никакой ручной сборки строк с кавычками.
  const argsArray = `@('-NoProfile','-ExecutionPolicy','Bypass','-Command', ${q(innerCmd)})`;

  const outerCmd =
    `$p = $null; ` +
    `try { ` +
    `  $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList ${argsArray} -ErrorAction Stop; ` +
    `  if ($p -eq $null) { 'null' | Out-File -FilePath ${q(exitFile)} -Encoding ASCII -Force } ` +
    `  else { $p.ExitCode | Out-File -FilePath ${q(exitFile)} -Encoding ASCII -Force } ` +
    `} catch { ` +
    `  "ELEVATION_ERROR: $($_.Exception.Message)" | Out-File -FilePath ${q(exitFile)} -Encoding ASCII -Force; ` +
    `  exit 2 ` +
    `}`;

  const proc = spawn('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', outerCmd],
    { windowsHide: true });

  let exited = false;
  proc.on('close', () => { exited = true; });

  const startedAt = Date.now();

  const STAGE_RU = {
    mount: 'Монтирую VHD (UAC уже подтверждён)…',
    copy: 'Копирую файлы внутрь VHD…',
    detach: 'Отмонтирую VHD…',
    done: 'VHD готов',
  };

  while (!exited) {
    if (signal.aborted) { try { proc.kill(); } catch { } throw new Error('Отменено'); }
    await new Promise((r) => setTimeout(r, 300));

    try {
      let raw = await fsp.readFile(statusFile, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      const s = JSON.parse(raw);
      if (s.stage && s.stage !== 'pending' && s.stage !== 'error') {
        send({
          stage: s.stage,
          message: STAGE_RU[s.stage] || s.message || '',
          progress: s.progress ?? 0,
          current: s.current,
          total: s.total,
          file: s.file,
        });
      }
      if (s.stage === 'done') break;
    } catch { /* status может быть в процессе записи — игнорируем */ }

    if (Date.now() - startedAt > 30 * 60 * 1000) {
      try { proc.kill(); } catch { }
      throw new Error('Таймаут elevated-скрипта (30 минут)');
    }
  }

  if (!exited) await new Promise((r) => proc.on('close', r));

  let exitCode = null;
  try {
    let raw = await fsp.readFile(exitFile, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    raw = raw.trim();
    if (raw.startsWith('ELEVATION_ERROR')) {
      throw new Error(`Не удалось запустить elevated-скрипт: ${raw}`);
    }
    if (raw !== 'null' && raw !== '') {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) exitCode = n;
    }
  } catch (e) {
    if (e.message.includes('Не удалось запустить elevated')) throw e;
  }

  let final = null;
  try {
    let raw = await fsp.readFile(statusFile, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    final = JSON.parse(raw);
  } catch { }

  let logContent = '';
  for (const f of [logFile, `${statusFile}.log`]) {
    try {
      let raw = await fsp.readFile(f, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      if (raw.trim()) logContent += `--- ${path.basename(f)} ---\n${raw}\n`;
    } catch { }
  }

  if (final?.stage === 'done' && (exitCode === 0 || exitCode === null)) return;

  const bootExists = await fsp.access(bootFile).then(() => true).catch(() => false);
  if (!bootExists && exitCode === null) {
    throw new Error('UAC-скрипт не запустился (пользователь отменил запрос или повышение прав заблокировано)');
  }

  const detail = final?.message || `exit code ${exitCode ?? 'unknown'}`;
  const logTail = logContent.split(/\r?\n/).filter(Boolean).slice(-25).join('\n');
  throw new Error(
    `Не удалось создать VHD: ${detail}\n\n` +
    `Полный лог: ${logFile}\n` +
    `Хвост лога:\n${logTail || '(пусто)'}`
  );
}