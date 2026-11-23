import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_THEME_SETTINGS,
  handleRequest,
  startFileServer,
} from './bridge.mjs';

test('lists project programs and marks only apps with an HTML entry point', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-'));
  try {
    await mkdir(path.join(root, 'componentapps', 'settings'), { recursive: true });
    await mkdir(path.join(root, 'componentapps', 'windows-settings'), { recursive: true });
    await mkdir(path.join(root, 'webapps', 'music'), { recursive: true });
    await mkdir(path.join(root, 'extensions', 'theme'), { recursive: true });
    await mkdir(path.join(root, 'dist', 'componentapps', 'windows-settings'), { recursive: true });
    await mkdir(path.join(root, 'dist', 'webapps', 'music'), { recursive: true });
    await writeFile(path.join(root, 'webapps', 'music', 'index.html'), '<html></html>');
    await writeFile(
      path.join(root, 'componentapps', 'windows-settings', 'index.html'),
      '<html></html>',
    );
    await writeFile(
      path.join(root, 'dist', 'componentapps', 'windows-settings', 'index.html'),
      '<html></html>',
    );
    await writeFile(path.join(root, 'dist', 'webapps', 'music', 'index.html'), '<html></html>');
    await writeFile(path.join(root, 'extensions', 'theme', 'manifest.json'), '{}');

    const programs = await handleRequest(
      { method: 'list-programs' },
      { projectRoot: root, platform: 'win32' },
    );
    assert.deepEqual(programs.map(({ id, entryPoint }) => ({ id, entryPoint })), [
      { id: 'componentapps:settings', entryPoint: null },
      {
        id: 'componentapps:windows-settings',
        entryPoint: path.join('componentapps', 'windows-settings', 'index.html'),
      },
      { id: 'extensions:theme', entryPoint: null },
      { id: 'webapps:music', entryPoint: path.join('webapps', 'music', 'index.html') },
    ]);
    assert.equal(programs.find(({ id }) => id === 'webapps:music').launchable, true);
    assert.equal(programs.find(({ id }) => id === 'componentapps:settings').launchable, false);
    assert.equal(programs.find(({ id }) => id === 'componentapps:windows-settings').launchable, true);
    const nonWindowsPrograms = await handleRequest(
      { method: 'list-programs' },
      { projectRoot: root, platform: 'linux' },
    );
    assert.equal(
      nonWindowsPrograms.find(({ id }) => id === 'componentapps:windows-settings').launchable,
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builds the original overview app list from built component and web apps', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-overview-'));
  try {
    for (const appPath of [
      path.join(root, 'componentapps', 'apps-list'),
      path.join(root, 'webapps', 'music'),
      path.join(root, 'public', 'omniscience', 'componentapps', 'apps-list'),
      path.join(root, 'public', 'omniscience', 'webapps', 'music'),
    ]) {
      await mkdir(appPath, { recursive: true });
    }
    await writeFile(path.join(root, 'config.json'), JSON.stringify({
      homepageUrl: 'https://example.com',
    }));
    await writeFile(path.join(root, 'componentapps', 'apps-list', 'index.html'), '');
    await writeFile(path.join(root, 'componentapps', 'apps-list', 'favicon.png'), 'icon');
    await writeFile(path.join(root, 'webapps', 'music', 'index.html'), '');
    await writeFile(
      path.join(root, 'public', 'omniscience', 'componentapps', 'apps-list', 'index.html'),
      '',
    );
    await writeFile(
      path.join(root, 'public', 'omniscience', 'webapps', 'music', 'index.html'),
      '',
    );

    const apps = await handleRequest(
      { method: 'get-apps-list' },
      { projectRoot: root, platform: 'win32' },
    );
    assert.deepEqual(apps.map(({ id, type, url }) => ({ id, type, url })), [
      {
        id: 'new-browser-window',
        type: 'browser',
        url: 'https://example.com',
      },
      {
        id: 'apps-list',
        type: 'componentapp',
        url: '/omniscience/componentapps/apps-list/index.html',
      },
      {
        id: 'music',
        type: 'webapp',
        url: '/omniscience/webapps/music/index.html',
      },
    ]);
    assert.equal(
      apps.find(({ id }) => id === 'apps-list').icon,
      `data:image/png;base64,${Buffer.from('icon').toString('base64')}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('opens a validated Windows settings category through control.exe', async () => {
  const calls = [];
  const child = new EventEmitter();
  child.unref = () => calls.push('unref');
  const context = {
    projectRoot: 'C:\\Omniscience',
    platform: 'win32',
    windir: 'D:\\Windows',
    spawn(...args) {
      calls.push(args);
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  };

  const result = await handleRequest({
    method: 'open-windows-settings-category',
    payload: { category: 'update' },
  }, context);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    [
      path.join('D:\\Windows', 'System32', 'control.exe'),
      ['/name', 'Microsoft.WindowsUpdate'],
      { detached: true, stdio: 'ignore', windowsHide: false },
    ],
    'unref',
  ]);
});

test('lists Windows Start Menu shortcuts and packaged apps for the shell menu', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-native-apps-'));
  const appData = path.join(root, 'user');
  const programData = path.join(root, 'common');
  const userPrograms = path.join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Tools',
  );
  const commonPrograms = path.join(
    programData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  try {
    await mkdir(userPrograms, { recursive: true });
    await mkdir(commonPrograms, { recursive: true });
    await writeFile(path.join(userPrograms, 'Editor.lnk'), '');
    await writeFile(path.join(userPrograms, 'Website.url'), '');
    await writeFile(path.join(commonPrograms, 'Notes.txt'), '');
    const calls = [];
    const context = {
      projectRoot: root,
      platform: 'win32',
      appData,
      programData,
      systemRoot: 'D:\\Windows',
      async execFileAsync(executable, args, options) {
        calls.push({ executable, args, options });
        return {
          stdout: JSON.stringify([
            {
              Name: 'Календарь',
              AppID: 'Microsoft.WindowsCalendar_8wekyb3d8bbwe!App',
            },
            { Name: 'Invalid app id', AppID: 'not-an-app-id' },
          ]),
        };
      },
    };

    const apps = await handleRequest({ method: 'list-native-apps' }, context);
    assert.deepEqual(apps
      .map(({ name, launchType }) => ({ name, launchType }))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru')), [
      { name: 'Календарь', launchType: 'uwp' },
      { name: 'Editor', launchType: 'shortcut' },
      { name: 'Website', launchType: 'shortcut' },
    ]);
    assert.ok(apps.some(({ id }) => id === `native:${path.join(userPrograms, 'Editor.lnk').toLowerCase()}`));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('-Action'));
    assert.equal(calls[0].args.at(-1), 'List');

    const nonWindowsApps = await handleRequest(
      { method: 'list-native-apps' },
      { projectRoot: root, platform: 'linux' },
    );
    assert.deepEqual(nonWindowsApps, []);
    await assert.rejects(
      handleRequest({
        method: 'launch-native-app',
        payload: { id: 'native:some-shortcut' },
      }, { projectRoot: root, platform: 'linux' }),
      /only supported on Windows/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('launches only listed Windows shortcuts and packaged apps', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-native-launch-'));
  const appData = path.join(root, 'user');
  const programs = path.join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  const appUserModelId = 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App';
  const processCalls = [];
  const child = new EventEmitter();
  child.unref = () => processCalls.push('unref');
  const context = {
    projectRoot: root,
    platform: 'win32',
    appData,
    programData: path.join(root, 'common'),
    systemRoot: 'D:\\Windows',
    spawn(executable, args, options) {
      processCalls.push({ executable, args, options });
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
    async execFileAsync(executable, args) {
      processCalls.push({ executable, args });
      return {
        stdout: args.at(-1) === 'List'
          ? JSON.stringify([{ Name: 'Calculator', AppID: appUserModelId }])
          : '{"processId":42}',
      };
    },
  };
  try {
    await mkdir(programs, { recursive: true });
    await writeFile(path.join(programs, 'Editor.lnk'), '');
    const apps = await handleRequest({ method: 'list-native-apps' }, context);

    assert.deepEqual(await handleRequest({
      method: 'launch-native-app',
      payload: { id: apps.find(({ launchType }) => launchType === 'shortcut').id },
    }, context), { opened: true });
    assert.deepEqual(processCalls.slice(-2), [
      {
        executable: path.join('D:\\Windows', 'explorer.exe'),
        args: [path.join(programs, 'Editor.lnk')],
        options: { detached: true, stdio: 'ignore', windowsHide: false },
      },
      'unref',
    ]);

    assert.deepEqual(await handleRequest({
      method: 'launch-native-app',
      payload: { id: apps.find(({ launchType }) => launchType === 'uwp').id },
    }, context), { opened: true });
    assert.deepEqual(processCalls.at(-1).args.slice(-3), [
      'Launch',
      '-AppId',
      appUserModelId,
    ]);
    await assert.rejects(
      handleRequest({
        method: 'launch-native-app',
        payload: { id: 'native:C:\\unknown\\unsafe.exe' },
      }, context),
      /no longer available/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects unknown categories and Windows settings requests off Windows', async () => {
  const context = { projectRoot: 'C:\\Omniscience', platform: 'win32' };
  await assert.rejects(
    handleRequest({
      method: 'open-windows-settings-category',
      payload: { category: 'arbitrary-command' },
    }, context),
    /category was not found/,
  );
  await assert.rejects(
    handleRequest({
      method: 'open-windows-settings-category',
      payload: { category: 'system' },
    }, { projectRoot: 'C:\\Omniscience', platform: 'linux' }),
    /only available on Windows/,
  );
});

test('reports Windows settings process startup failures', async () => {
  const child = new EventEmitter();
  const context = {
    projectRoot: 'C:\\Omniscience',
    platform: 'win32',
    spawn() {
      process.nextTick(() => child.emit('error', new Error('Control Panel is unavailable')));
      return child;
    },
  };
  await assert.rejects(
    handleRequest({
      method: 'open-windows-settings-category',
      payload: { category: 'system' },
    }, context),
    /Control Panel is unavailable/,
  );
});

test('opens the configured homepage for the original browser card', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-browser-'));
  try {
    await writeFile(path.join(root, 'config.json'), JSON.stringify({
      homepageUrl: 'https://example.com/start',
    }));
    const result = await handleRequest({
      method: 'open-program',
      payload: { programId: 'new-browser-window' },
    }, { projectRoot: root, platform: 'win32', themeSettings: DEFAULT_THEME_SETTINGS });
    assert.equal(result.kind, 'webapp');
    assert.equal(result.name, 'Браузер');
    assert.equal(result.url, 'https://example.com/start');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports the Node runtime through the sidecar health request', async () => {
  const health = await handleRequest({ method: 'health' }, 'C:\\Omniscience');
  assert.equal(health.nodeVersion, process.version);
  assert.equal(health.projectRoot, 'C:\\Omniscience');
});

test('applies built-in theme settings to local app pages and rejects invalid settings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-'));
  const dist = path.join(root, 'dist');
  const context = {
    projectRoot: root,
    fileServerUrl: null,
    themeSettings: { ...DEFAULT_THEME_SETTINGS },
  };
  try {
    await mkdir(path.join(dist, 'webapps', 'music'), { recursive: true });
    await writeFile(
      path.join(dist, 'webapps', 'music', 'index.html'),
      '<!doctype html><html><head><title>Music</title></head><body></body></html>',
    );
    const { server, baseUrl } = await startFileServer(dist, () => context.themeSettings);
    try {
      const settings = await handleRequest({
        method: 'set-theme',
        payload: { ...DEFAULT_THEME_SETTINGS, maxR: 80, shadowColor: '#123abc' },
      }, context);
      assert.equal(settings.maxR, 80);
      assert.deepEqual(await handleRequest({ method: 'get-theme' }, context), settings);

      const page = await fetch(`${baseUrl}/webapps/music/index.html`);
      const html = await page.text();
      assert.match(html, /__omniscience\/theme\/base\.css/);
      assert.match(html, /__omniscience\/theme\/content\.js/);
      assert.ok(html.includes('maxR\\":80'));

      await assert.rejects(
        handleRequest({
          method: 'set-theme',
          payload: { ...DEFAULT_THEME_SETTINGS, targetAlpha: 2 },
        }, context),
        /Invalid Omni Theme settings/,
      );
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('adapts Node directory data for the existing desktop file grid', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-'));
  try {
    await mkdir(path.join(root, 'folder'));
    await writeFile(path.join(root, 'picture.png'), 'image');
    const listing = await handleRequest({
      method: 'read-desktop-directory',
      payload: { path: root },
    }, root);
    assert.equal(listing.success, true);
    assert.deepEqual(
      listing.files.map(({ name, isDir, mediaKind }) => ({ name, isDir, mediaKind })),
      [
        { name: 'folder', isDir: true, mediaKind: null },
        { name: 'picture.png', isDir: false, mediaKind: 'image' },
      ],
    );

    const directories = await handleRequest({ method: 'get-user-dirs' }, root);
    assert.equal(path.isAbsolute(directories.desktop), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('returns an explicit error for unknown sidecar methods', async () => {
  await assert.rejects(
    handleRequest({ method: 'delete-everything' }, 'C:\\Omniscience'),
    /Unknown Node\.js sidecar method/,
  );
});

test('lists and controls only windows hidden from the Windows taskbar', async () => {
  const requests = [];
  const context = {
    projectRoot: 'C:\\Omniscience',
    platform: 'win32',
    nativeWindowHost: {
      async request(action, payload) {
        requests.push({ action, payload });
        if (action === 'list') {
          return [
            {
              id: '101',
              title: 'Hidden player',
              pid: 12,
              imagePath: 'C:\\Apps\\player.exe',
              taskbarHidden: true,
              minimized: true,
              maximized: false,
              focused: false,
            },
            { id: '102', title: 'Visible app', taskbarHidden: false, maximized: false },
          ];
        }
        return true;
      },
    },
  };

  const windows = await handleRequest({ method: 'list-hidden-windows' }, context);
  assert.deepEqual(windows, [{
    id: '101',
    title: 'Hidden player',
    processName: 'player',
    pid: 12,
    minimized: true,
    maximized: false,
    focused: false,
  }]);

  await handleRequest({
    method: 'manage-hidden-window',
    payload: { id: '101', action: 'focus' },
  }, context);
  await handleRequest({
    method: 'manage-hidden-window',
    payload: { id: '101', action: 'minimize' },
  }, context);
  await handleRequest({
    method: 'manage-hidden-window',
    payload: { id: '101', action: 'maximize' },
  }, context);
  assert.deepEqual(requests.map(({ action }) => action), [
    'list', 'list', 'focus',
    'list', 'minimize',
    'list', 'maximize',
  ]);
  assert.deepEqual(requests.at(-1), {
    action: 'maximize',
    payload: { hwnd: '101', maximize: true },
  });

  await assert.rejects(
    handleRequest({
      method: 'manage-hidden-window',
      payload: { id: '102', action: 'close' },
    }, context),
    /no longer available/,
  );
  await assert.rejects(
    handleRequest({
      method: 'manage-hidden-window',
      payload: { id: '101', action: 'move' },
    }, context),
    /Unsupported hidden-window action/,
  );
});

test('lists and controls visible native app windows for the window controls', async () => {
  const requests = [];
  const context = {
    projectRoot: 'C:\\Omniscience',
    platform: 'win32',
    nativeWindowHost: {
      async request(action, payload) {
        requests.push({ action, payload });
        if (action === 'list') {
          return [
            {
              id: '201',
              title: 'Visible app',
              pid: 24,
              imagePath: 'C:\\Apps\\visible.exe',
              visible: true,
              taskbarHidden: false,
              focused: true,
              maximized: false,
              x: 10,
              y: 20,
              width: 800,
              height: 600,
            },
            { id: '202', title: 'Hidden app', visible: true, taskbarHidden: true },
            { id: '203', title: 'Invisible app', visible: false, taskbarHidden: false },
          ];
        }
        return true;
      },
    },
  };

  const windows = await handleRequest({ method: 'list-native-windows' }, context);
  assert.deepEqual(windows.map(({ id, title, processName, focused }) => ({
    id, title, processName, focused,
  })), [{
    id: '201',
    title: 'Visible app',
    processName: 'visible',
    focused: true,
  }]);

  await handleRequest({
    method: 'manage-native-window',
    payload: { id: '201', action: 'focus' },
  }, context);
  assert.deepEqual(requests.at(-1), {
    action: 'focus',
    payload: { hwnd: '201' },
  });
  await assert.rejects(
    handleRequest({
      method: 'manage-native-window',
      payload: { id: '202', action: 'focus' },
    }, context),
    /no longer available/,
  );
});

test('reports when hidden-window enumeration is unavailable off Windows', async () => {
  await assert.rejects(
    handleRequest(
      { method: 'list-hidden-windows' },
      { projectRoot: 'C:\\Omniscience', platform: 'linux' },
    ),
    /only supported on Windows/,
  );
});

test('does not open a program unless it is an available webapp', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-'));
  try {
    await assert.rejects(
      handleRequest(
        { method: 'open-program', payload: { programId: 'webapps:missing' } },
        { projectRoot: root, fileServerUrl: 'http://127.0.0.1:1234' },
      ),
      /Program not found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('opens only the migrated componentapps in trusted Tauri asset windows', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-'));
  const context = {
    projectRoot: root,
    fileServerUrl: 'http://127.0.0.1:1234',
    themeSettings: { ...DEFAULT_THEME_SETTINGS },
    platform: 'win32',
  };
  try {
    for (const appName of ['create-item', 'rename', 'settings', 'windows-settings']) {
      await mkdir(path.join(root, 'componentapps', appName), { recursive: true });
      await writeFile(path.join(root, 'componentapps', appName, 'index.html'), '<html></html>');
    }
    for (const appName of ['create-item', 'rename', 'windows-settings']) {
      await mkdir(path.join(root, 'dist', 'componentapps', appName), { recursive: true });
      await writeFile(path.join(root, 'dist', 'componentapps', appName, 'index.html'), '<html></html>');
    }

    const programs = await handleRequest({ method: 'list-programs' }, context);
    assert.equal(programs.find(({ id }) => id === 'componentapps:create-item').launchable, true);
    assert.equal(programs.find(({ id }) => id === 'componentapps:rename').launchable, true);
    assert.equal(programs.find(({ id }) => id === 'componentapps:windows-settings').launchable, true);
    assert.equal(programs.find(({ id }) => id === 'componentapps:settings').launchable, false);

    const result = await handleRequest({
      method: 'open-program',
      payload: { programId: 'componentapps:create-item' },
    }, context);
    assert.deepEqual(result, {
      kind: 'componentapp',
      name: 'create-item',
      appPath: 'omniscience/componentapps/create-item/index.html',
      themeSettings: context.themeSettings,
    });

    const settingsProgram = await handleRequest({
      method: 'open-program',
      payload: { programId: 'componentapps:windows-settings' },
    }, context);
    assert.deepEqual(settingsProgram, {
      kind: 'componentapp',
      name: 'windows-settings',
      appPath: 'omniscience/componentapps/windows-settings/index.html',
      themeSettings: context.themeSettings,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lists, creates, and renames filesystem entries without overwriting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-'));
  try {
    const folderPath = path.join(root, 'created-folder');
    await handleRequest({
      method: 'create-folder',
      payload: { parentPath: root, name: 'created-folder' },
    }, root);
    await handleRequest({
      method: 'create-file',
      payload: { parentPath: folderPath, name: 'source.txt' },
    }, root);
    await writeFile(path.join(folderPath, 'source.txt'), 'preserve this');
    await writeFile(path.join(folderPath, 'existing.txt'), 'do not replace');

    await assert.rejects(
      handleRequest({
        method: 'create-file',
        payload: { parentPath: folderPath, name: 'source.txt' },
      }, root),
      { code: 'EEXIST' },
    );
    await assert.rejects(
      handleRequest({
        method: 'rename-path',
        payload: { path: path.join(folderPath, 'source.txt'), name: 'existing.txt' },
      }, root),
      /EEXIST/,
    );

    const renamedPath = path.join(folderPath, 'renamed.txt');
    await handleRequest({
      method: 'rename-path',
      payload: { path: path.join(folderPath, 'source.txt'), name: 'renamed.txt' },
    }, root);
    assert.equal(await readFile(renamedPath, 'utf8'), 'preserve this');
    await assert.rejects(stat(path.join(folderPath, 'source.txt')), { code: 'ENOENT' });

    const listing = await handleRequest({
      method: 'list-directory',
      payload: { path: root },
    }, root);
    assert.equal(listing.entries[0].name, 'created-folder');
    assert.equal(listing.entries[0].kind, 'directory');
    assert.equal(listing.entries[0].path, folderPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects relative paths and names that escape their parent directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-'));
  try {
    await assert.rejects(
      handleRequest({ method: 'list-directory', payload: { path: 'relative' } }, root),
      /absolute directory path/,
    );
    await assert.rejects(
      handleRequest({
        method: 'create-folder',
        payload: { parentPath: root, name: '..\\outside' },
      }, root),
      /Invalid file or folder name/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('serves built app files locally without exposing files outside dist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-'));
  const dist = path.join(root, 'dist');
  try {
    await mkdir(path.join(dist, 'webapps', 'music'), { recursive: true });
    await writeFile(path.join(dist, 'webapps', 'music', 'index.html'), '<h1>Music</h1>');
    await writeFile(path.join(root, 'private.txt'), 'private');
    const { server, baseUrl } = await startFileServer(dist);
    try {
      const appResponse = await fetch(`${baseUrl}/webapps/music/index.html`);
      assert.equal(appResponse.status, 200);
      assert.match(await appResponse.text(), /<h1>Music<\/h1>/);

      const outsideResponse = await fetch(`${baseUrl}/%2e%2e%2fprivate.txt`);
      assert.notEqual(outsideResponse.status, 200);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
