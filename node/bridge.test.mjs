import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import {
  DEFAULT_THEME_SETTINGS,
  handleRequest,
  listPrograms,
  startFileServer,
} from './bridge.mjs';
import { zipAndSplit } from '../componentapps/omni-archiver/zip.js';
import buildComponentApps from '../main/vite_build.js';
import { resolveForDisplay } from '../src/viewRuntime/paths.js';

test('executes preload and content scripts from their generated entry functions', async () => {
  const runtimeTemplate = await readFile(
    new URL('../src-tauri/src/extension-runtime.js', import.meta.url),
    'utf8',
  );
  const extensions = [{
    id: 'runtime-test',
    targets: { webapps: true },
    preloads: [{ matches: ['<all_urls>'], css: [] }],
    contentScripts: [{
      matches: ['<all_urls>'],
      runAt: 'document_start',
      css: [],
    }],
  }];
  const executorLiteral = `[{
    preloads: [function(chrome) { window.__preloadRan = Boolean(chrome.runtime); }],
    contentScripts: [function(chrome) { window.__contentScriptRan = Boolean(chrome.runtime); }],
  }]`;
  const script = runtimeTemplate
    .replace('__OMNI_EXTENSION_CONFIG__', JSON.stringify(extensions))
    .replace('__OMNI_EXTENSION_EXECUTORS__', executorLiteral)
    .replace('__OMNI_TARGET__', '"webapps"');
  const window = { addEventListener() {} };
  const document = {
    readyState: 'loading',
    head: { appendChild() {} },
    documentElement: {},
    createElement: () => ({ dataset: {} }),
    querySelector: () => null,
    addEventListener() {},
  };

  vm.runInNewContext(script, {
    window,
    document,
    location: { href: 'https://example.com/', pathname: '/' },
    URL,
    console,
  });

  assert.equal(window.__preloadRan, true);
  assert.equal(window.__contentScriptRan, true);
});

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('resolves bundled public assets for Tauri without changing legacy file URLs', () => {
  const previousWindow = globalThis.window;
  try {
    globalThis.window = {
      __TAURI__: {
        core: {
          convertFileSrc: (filePath) => `asset://${filePath.replace(/\\/g, '/')}`,
        },
      },
    };
    assert.equal(
      resolveForDisplay('public/images/background.jpg', 'C:\\Omni'),
      '/images/background.jpg',
    );
    assert.equal(
      resolveForDisplay('C:\\Wallpapers\\night sky.jpg', null),
      'asset://C:/Wallpapers/night sky.jpg',
    );
    assert.equal(
      resolveForDisplay('https://example.com/background.jpg', null),
      'https://example.com/background.jpg',
    );

    globalThis.window = {};
    assert.equal(
      resolveForDisplay('public/images/background.jpg', 'C:\\Omni'),
      'file:///C:/Omni/public/images/background.jpg',
    );
    assert.equal(
      resolveForDisplay('C:\\Wallpapers\\night sky#1.jpg', null),
      'file:///C:/Wallpapers/night%20sky%231.jpg',
    );
    assert.equal(
      resolveForDisplay('\\\\server\\share\\night sky.jpg', null),
      'file://server/share/night%20sky.jpg',
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('places shell windows at the desktop bottom and topmost through the native host', async () => {
  const requests = [];
  const context = {
    platform: 'win32',
    nativeWindowHost: {
      request: async (action, payload) => {
        requests.push({ action, payload });
        return true;
      },
    },
  };

  assert.equal(await handleRequest({
    method: 'set-shell-window-layer',
    payload: { hwnd: '1234', layer: 'desktop' },
  }, context), true);
  assert.equal(await handleRequest({
    method: 'set-shell-window-layer',
    payload: { hwnd: '5678', layer: 'top' },
  }, context), true);
  assert.deepEqual(requests, [
    { action: 'desktop-bottom', payload: { hwnd: '1234' } },
    { action: 'z-order', payload: { hwnd: '5678', layer: 'top' } },
  ]);
  await assert.rejects(handleRequest({
    method: 'set-shell-window-layer',
    payload: { hwnd: '0', layer: 'top' },
  }, context), /valid shell window handle/);
});

test('reserves and releases the workspace panel work area', async () => {
  const requests = [];
  const context = {
    platform: 'win32',
    nativeWindowHost: {
      request: async (action, payload) => {
        requests.push({ action, payload });
        return true;
      },
    },
  };

  assert.equal(await handleRequest({
    method: 'set-shell-panel-dock',
    payload: { hwnd: '1234', x: 120, y: 48, width: 1400, height: 28 },
  }, context), true);
  assert.equal(await handleRequest({
    method: 'remove-shell-panel-dock',
    payload: { hwnd: '1234' },
  }, context), true);
  assert.deepEqual(requests, [
    {
      action: 'dock',
      payload: { hwnd: '1234', x: 120, y: 48, width: 1400, height: 28, edge: 'top' },
    },
    { action: 'dock-remove', payload: { hwnd: '1234' } },
  ]);
  await assert.rejects(handleRequest({
    method: 'set-shell-panel-dock',
    payload: { hwnd: '1234', x: 0, y: 0, width: 0, height: 28 },
  }, context), /Valid shell panel bounds/);
});

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

test('discovers Manifest V3 extensions, serves their popups, and persists extension storage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-extensions-'));
  const extensionDir = path.join(root, 'extensions', 'theme');
  const popupDir = path.join(root, 'public', 'omniscience', 'extensions', 'theme');
  const context = {
    projectRoot: root,
    extensionStoragePath: path.join(root, 'extension-data'),
    fileServerUrl: null,
  };
  try {
    await mkdir(extensionDir, { recursive: true });
    await mkdir(popupDir, { recursive: true });
    await writeFile(path.join(extensionDir, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: 'Theme test',
      version: '1.0',
      action: { default_popup: 'popup.html' },
      content_scripts: [{
        matches: ['https://*.example.com/*'],
        js: ['content.js'],
        css: ['content.css'],
        run_at: 'document_start',
      }],
      omniscience: {
        preloads: [{
          matches: ['<all_urls>'],
          js: ['preload.js'],
        }],
        targets: { extensions: true },
      },
    }));
    await writeFile(path.join(extensionDir, 'popup.html'), '<html>popup</html>');
    await writeFile(path.join(extensionDir, 'content.js'), 'window.__extension_test__ = true;');
    await writeFile(path.join(extensionDir, 'content.css'), 'body { color: red; }');
    await writeFile(path.join(extensionDir, 'preload.js'), 'window.__preload_test__ = true;');
    await writeFile(path.join(popupDir, 'popup.html'), '<html><body>extension popup</body></html>');

    const listed = await handleRequest({ method: 'get-extensions-list' }, context);
    assert.deepEqual(listed.map(({ id, type, title, launchable }) =>
      ({ id, type, title, launchable })), [
      { id: 'theme', type: 'extension', title: 'Theme test', launchable: true },
    ]);

    const runtime = await handleRequest({ method: 'get-extension-runtime' }, context);
    assert.deepEqual(runtime[0].contentScripts, [{
      matches: ['https://*.example.com/*'],
      runAt: 'document_start',
      css: ['body { color: red; }'],
      js: ['window.__extension_test__ = true;'],
    }]);
    assert.deepEqual(runtime[0].preloads, [{
      matches: ['<all_urls>'],
      css: [],
      js: ['window.__preload_test__ = true;'],
    }]);
    assert.deepEqual(runtime[0].targets, {
      webapps: true,
      componentapps: true,
      extensions: true,
      shell: false,
      devtools: false,
    });

    const { server, baseUrl } = await startFileServer(path.join(root, 'public', 'omniscience'));
    try {
      context.fileServerUrl = baseUrl;
      const popupWindow = await handleRequest({
        method: 'open-program',
        payload: { programId: 'extensions:theme', params: { popup: true } },
      }, context);
      assert.equal(popupWindow.kind, 'extension_popup');
      assert.equal(popupWindow.width, 360);
      assert.equal((await fetch(popupWindow.url)).status, 200);
      assert.match(await (await fetch(popupWindow.url)).text(), /extension popup/);

      const changes = await handleRequest({
        method: 'extension-storage-set',
        payload: { extensionId: 'theme', items: { enabled: true, count: 2 } },
      }, context);
      assert.deepEqual(changes, {
        enabled: { newValue: true },
        count: { newValue: 2 },
      });
      assert.deepEqual(await handleRequest({
        method: 'extension-storage-get',
        payload: { extensionId: 'theme', keys: { enabled: false, missing: 'default' } },
      }, context), { enabled: true, missing: 'default' });
      await handleRequest({
        method: 'extension-storage-set',
        payload: { extensionId: 'theme', items: {}, removeKeys: ['count'] },
      }, context);
      assert.deepEqual(await handleRequest({
        method: 'extension-storage-get',
        payload: { extensionId: 'theme' },
      }, context), { enabled: true });
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('discovers componentapps in both source roots and accepts TypeScript entry points', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-componentapp-sources-'));
  try {
    const appSources = [
      path.join(root, 'legacy', 'componentapps', 'legacy-only'),
      path.join(root, 'legacy', 'componentapps', 'shared'),
      path.join(root, 'componentapps', 'shared'),
    ];
    for (const directory of appSources) {
      await mkdir(directory, { recursive: true });
    }
    await writeFile(
      path.join(appSources[0], 'Index.ts'),
      'export const legacyEntry: string = "legacy";',
    );
    await writeFile(
      path.join(appSources[1], 'Index.jsx'),
      'export default function LegacyShared() {}',
    );
    await writeFile(
      path.join(appSources[2], 'Index.tsx'),
      'export default function CurrentShared() { return <main />; }',
    );

    for (const name of ['legacy-only', 'shared']) {
      const builtPath = path.join(root, 'public', 'omniscience', 'componentapps', name);
      await mkdir(builtPath, { recursive: true });
      await writeFile(path.join(builtPath, 'index.html'), '<html></html>');
    }

    const programs = await listPrograms(root);
    assert.deepEqual(
      programs.filter(({ category }) => category === 'componentapps').map(
        ({ id, entryPoint, launchable }) => ({ id, entryPoint, launchable }),
      ),
      [
        {
          id: 'componentapps:legacy-only',
          entryPoint: path.join('componentapps', 'legacy-only', 'index.html'),
          launchable: true,
        },
        {
          id: 'componentapps:shared',
          entryPoint: path.join('componentapps', 'shared', 'index.html'),
          launchable: true,
        },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builds TypeScript componentapps from both roots without leaving generated source files', async () => {
  const root = await mkdtemp(path.join(
    process.cwd(),
    'node_modules',
    '.cache',
    'omni-componentapp-build-',
  ));
  const previousPaths = global.paths;
  const currentPath = path.join(root, 'componentapps', 'current-ts');
  const legacyPath = path.join(root, 'legacy', 'componentapps', 'legacy-ts');
  const distPath = path.join(root, 'dist');
  try {
    for (const directory of [
      path.join(root, 'src'),
      path.join(root, 'public'),
      path.join(root, 'themes'),
      path.join(root, 'webapps'),
      currentPath,
      legacyPath,
    ]) {
      await mkdir(directory, { recursive: true });
    }
    await writeFile(
      path.join(currentPath, 'Index.ts'),
      'const label: string = "current"; document.body.textContent = label;',
    );
    await writeFile(
      path.join(legacyPath, 'Index.ts'),
      'const label: string = "legacy"; document.body.textContent = label;',
    );
    global.paths = {
      projectRoot: root,
      srcDir: path.join(root, 'src'),
      publicDir: path.join(root, 'public'),
      distDir: distPath,
      componentappsDir: path.join(root, 'componentapps'),
      webappsDir: path.join(root, 'webapps'),
    };

    await buildComponentApps();

    for (const name of ['current-ts', 'legacy-ts']) {
      const html = await readFile(
        path.join(distPath, 'componentapps', name, 'index.html'),
        'utf8',
      );
      assert.match(html, /<script type="module"/);
    }
    await assert.rejects(stat(path.join(root, 'componentapps', 'legacy-ts')));
    await assert.rejects(stat(path.join(currentPath, 'index.html')));
  } finally {
    global.paths = previousPaths;
    await rm(root, { recursive: true, force: true });
  }
});

test('builds the original overview app list from built component and web apps', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-overview-'));
  try {
    for (const appPath of [
      path.join(root, 'componentapps', 'apps-list'),
      path.join(root, 'webapps', 'browser'),
      path.join(root, 'webapps', 'music'),
      path.join(root, 'public', 'omniscience', 'componentapps', 'apps-list'),
      path.join(root, 'public', 'omniscience', 'webapps', 'browser'),
      path.join(root, 'public', 'omniscience', 'webapps', 'music'),
    ]) {
      await mkdir(appPath, { recursive: true });
    }
    await writeFile(path.join(root, 'componentapps', 'apps-list', 'index.html'), '');
    await writeFile(path.join(root, 'componentapps', 'apps-list', 'favicon.png'), 'icon');
    await writeFile(path.join(root, 'webapps', 'browser', 'index.html'), '');
    await writeFile(path.join(root, 'webapps', 'music', 'index.html'), '');
    await writeFile(
      path.join(root, 'public', 'omniscience', 'componentapps', 'apps-list', 'index.html'),
      '',
    );
    await writeFile(
      path.join(root, 'public', 'omniscience', 'webapps', 'browser', 'index.html'),
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
        id: 'apps-list',
        type: 'componentapp',
        url: '/omniscience/componentapps/apps-list/index.html',
      },
      {
        id: 'browser',
        type: 'webapp',
        url: '/omniscience/webapps/browser/index.html',
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

test('preserves the legacy Chonky and Monaco file IPC contracts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-componentapp-ipc-'));
  const textPath = path.join(root, 'sample.txt');
  try {
    await writeFile(textPath, 'first version');
    const context = { projectRoot: root, platform: process.platform };
    const folders = await handleRequest({
      method: 'componentapp-ipc',
      payload: { appId: 'Chonky', channel: 'get-default-folders', args: [] },
    }, context);
    assert.ok(folders.some((folder) => folder.id === 'project' && folder.path === root));

    const listing = await handleRequest({
      method: 'componentapp-ipc',
      payload: { appId: 'Chonky', channel: 'get-files', args: [root] },
    }, context);
    assert.equal(listing.success, true);
    assert.ok(listing.files.some((file) => file.id === textPath && file.isDir === false));

    const monacoListing = await handleRequest({
      method: 'componentapp-ipc',
      payload: { appId: 'Monaco', channel: 'get-files', args: [root] },
    }, context);
    assert.equal(monacoListing.success, true);
    assert.ok(monacoListing.files.some((file) => file.id === textPath && file.isDir === false));

    const read = await handleRequest({
      method: 'componentapp-ipc',
      payload: { appId: 'Monaco', channel: 'read-file', args: [textPath] },
    }, context);
    assert.deepEqual(read, { success: true, content: 'first version' });
    await handleRequest({
      method: 'componentapp-ipc',
      payload: {
        appId: 'Monaco',
        channel: 'write-file',
        args: [textPath, 'second version'],
      },
    }, context);
    assert.equal(await readFile(textPath, 'utf8'), 'second version');
    await assert.rejects(
      handleRequest({
        method: 'componentapp-ipc',
        payload: { appId: 'Monaco', channel: 'unexpected', args: [] },
      }, context),
      /Unsupported legacy IPC channel/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('adapts NetworkManager Wi-Fi requests and reports unsupported Bluetooth explicitly', async () => {
  const calls = [];
  const context = {
    projectRoot: process.cwd(),
    wifi: {
      scan: async () => [{ ssid: 'Office', quality: 81 }],
      connect: async (connection) => calls.push(connection),
      disconnect: async () => undefined,
      getCurrentConnections: async () => [{ ssid: 'Office' }],
    },
  };
  const request = (channel, args = []) => handleRequest({
    method: 'componentapp-ipc',
    payload: { appId: 'NetworkManager', channel, args, windowId: 'component-network-test' },
  }, context);

  assert.deepEqual(await request('wifi:scan'), {
    success: true,
    data: [{ ssid: 'Office', quality: 81, displaySsid: 'Office' }],
  });
  assert.deepEqual(await request('wifi:connect', ['Office', 'secret']), { success: true });
  assert.deepEqual(calls, [{ ssid: 'Office', password: 'secret' }]);
  assert.deepEqual(await request('wifi:status'), {
    success: true,
    data: { ssid: 'Office' },
  });
  const bluetooth = await request('bluetooth:start-scan');
  assert.equal(bluetooth.success, false);
  assert.match(bluetooth.error, /Bluetooth/);
});

test('routes validated power-menu actions to the native power backend', async () => {
  const calls = [];
  const context = {
    projectRoot: 'C:\\Omniscience',
    platform: 'win32',
    systemRoot: 'D:\\Windows',
    nativeWindowHost: {
      async request(action) {
        calls.push({ action });
        return true;
      },
    },
    async execFileAsync(executable, args, options) {
      calls.push({ executable, args, options });
      return {};
    },
  };
  const request = (action) => handleRequest({
    method: 'componentapp-ipc',
    payload: {
      appId: 'power-menu',
      channel: 'power-menu:execute',
      args: [{ action }],
      windowId: 'component-power-menu-test',
    },
  }, context);

  assert.deepEqual(await request('restart'), { ok: true });
  assert.deepEqual(await request('sleep'), { ok: true });
  assert.deepEqual(calls, [
    {
      executable: path.join('D:\\Windows', 'System32', 'shutdown.exe'),
      args: ['/r', '/t', '0'],
      options: { windowsHide: true, timeout: 10000 },
    },
    { action: 'suspend' },
  ]);
  await assert.rejects(request('run-command'), /Unsupported power action/);
  assert.equal(calls.length, 2);
});

test('starts and stops a Min WebSocket relay for an individual component window', async () => {
  const port = await getAvailablePort();
  const context = { projectRoot: process.cwd() };
  const request = (channel, args = []) => handleRequest({
    method: 'componentapp-ipc',
    payload: { appId: 'Min', channel, args, windowId: 'component-min-test' },
  }, context);
  let host;
  let peer;
  try {
    assert.deepEqual(await request('start-server', [port]), { success: true, port });
    host = new WebSocket(`ws://127.0.0.1:${port}`);
    peer = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([
      new Promise((resolve, reject) => {
        host.once('open', resolve);
        host.once('error', reject);
      }),
      new Promise((resolve, reject) => {
        peer.once('open', resolve);
        peer.once('error', reject);
      }),
    ]);
    const received = new Promise((resolve) => peer.once('message', (message) => resolve(message.toString())));
    host.send('relay-check');
    assert.equal(await received, 'relay-check');
  } finally {
    await request('stop-server');
    host?.close();
    peer?.close();
  }
});

test('provides archiver enumeration and safely removes output-path probes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-archiver-ipc-'));
  const sourcePath = path.join(root, 'sample.txt');
  const outputPath = path.join(root, 'output');
  try {
    await writeFile(sourcePath, 'archive input');
    const context = { projectRoot: process.cwd() };
    const request = (channel, args = []) => handleRequest({
      method: 'componentapp-ipc',
      payload: { appId: 'omni-archiver', channel, args, windowId: 'component-archiver-test' },
    }, context);

    const listing = await request('enumerate', [[sourcePath]]);
    assert.equal(listing.ok, true);
    assert.deepEqual(listing.files.map(({ source, size }) => ({ source, size })), [
      { source: sourcePath, size: Buffer.byteLength('archive input') },
    ]);

    const resolved = await request('resolve-output-path', [outputPath]);
    assert.deepEqual(resolved, { ok: true, path: outputPath });
    assert.deepEqual(await (await import('node:fs/promises')).readdir(outputPath), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('creates archive fragments with the bundled archiver backend', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-zip-test-'));
  try {
    const vhdPath = path.join(root, 'input.vhd');
    const outputDir = path.join(root, 'fragments');
    await writeFile(vhdPath, Buffer.alloc(1024, 7));
    await mkdir(outputDir, { recursive: true });
    const result = await zipAndSplit({
      vhdPath,
      outputDir,
      baseName: 'test',
      maxSizeBytes: 1024 * 1024,
      renameToTxt: false,
      onProgress: () => undefined,
      signal: new AbortController().signal,
    });
    assert.equal(result.count, 1);
    assert.equal(await stat(result.fragments[0].path).then((info) => info.isFile()), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('provides an isolated PTY session for the xterm component app', async () => {
  const instanceId = 'component-xterm-test';
  const request = (channel, args = []) => handleRequest({
    method: 'componentapp-ipc',
    payload: { appId: 'xterm', channel, args, windowId: instanceId },
  }, { projectRoot: process.cwd() });
  await request('terminal-start');
  try {
    await request('terminal-input', ['echo OMNI_PTY_OK\r']);
    let output = '';
    const deadline = Date.now() + 5000;
    while (!output.includes('OMNI_PTY_OK') && Date.now() < deadline) {
      const result = await request('terminal-poll');
      output += result.data.join('');
      if (!output.includes('OMNI_PTY_OK')) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.match(output, /OMNI_PTY_OK/);
  } finally {
    await request('terminal-exit');
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
      async extractWindowsAppIcons(requests) {
        return new Map(requests.map((request) => [
          request.id,
          {
            dataUrl: `data:image/png;base64,${Buffer.from(path.basename(request.path)).toString('base64')}`,
          },
        ]));
      },
      async execFileAsync(executable, args, options) {
        calls.push({ executable, args, options });
        return {
          stdout: JSON.stringify([
            {
              Name: 'Календарь',
              AppID: 'Microsoft.WindowsCalendar_8wekyb3d8bbwe!App',
              IconPath: 'C:\\Packages\\Calendar\\Assets\\Square44x44Logo.png',
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
    assert.equal(
      apps.find(({ name }) => name === 'Editor').icon,
      `data:image/png;base64,${Buffer.from('Editor.lnk').toString('base64')}`,
    );
    assert.equal(
      apps.find(({ name }) => name === 'Календарь').icon,
      `data:image/png;base64,${Buffer.from('Square44x44Logo.png').toString('base64')}`,
    );
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
    async extractWindowsAppIcons() {
      return new Map();
    },
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

test('opens the browser redirect as a regular webapp', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-browser-'));
  try {
    const redirectPage = await readFile(
      new URL('../webapps/browser/index.html', import.meta.url),
      'utf8',
    );
    assert.match(redirectPage, /window\.location\.href\s*=\s*['"]https:\/\/www\.google\.com['"]/);
    await mkdir(path.join(root, 'webapps', 'browser'), { recursive: true });
    await mkdir(path.join(root, 'public', 'omniscience', 'webapps', 'browser'), {
      recursive: true,
    });
    await writeFile(path.join(root, 'webapps', 'browser', 'index.html'), redirectPage);
    await writeFile(
      path.join(root, 'public', 'omniscience', 'webapps', 'browser', 'index.html'),
      '<!doctype html>',
    );
    const result = await handleRequest({
      method: 'open-program',
      payload: { programId: 'browser' },
    }, {
      projectRoot: root,
      platform: 'win32',
      fileServerUrl: 'http://127.0.0.1:4321',
    });
    assert.equal(result.kind, 'webapp');
    assert.equal(result.name, 'browser');
    assert.equal(result.url, 'http://127.0.0.1:4321/webapps/browser/index.html');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('opens desktop shortcuts through the Windows shell instead of opener path scope', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-desktop-shortcut-'));
  const shortcutPath = path.join(root, 'CODERROR.lnk');
  const requests = [];
  try {
    await writeFile(shortcutPath, 'shortcut');
    const result = await handleRequest({
      method: 'open-path',
      payload: { path: shortcutPath },
    }, {
      projectRoot: root,
      platform: 'win32',
      nativeWindowHost: {
        async request(action, payload) {
          requests.push({ action, payload });
          return true;
        },
      },
    });
    assert.deepEqual(result, { opened: true });
    assert.deepEqual(requests, [{
      action: 'open-path',
      payload: { path: shortcutPath },
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('opens the Windows Open With dialog for the selected file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-desktop-open-with-'));
  const filePath = path.join(root, 'sample.unknown');
  const spawns = [];
  try {
    await writeFile(filePath, 'content');
    const result = await handleRequest({
      method: 'open-with',
      payload: { path: filePath },
    }, {
      platform: 'win32',
      projectRoot: root,
      spawnProcess(executable, args, options) {
        spawns.push({ executable, args, options });
        const child = new EventEmitter();
        child.unref = () => {};
        process.nextTick(() => child.emit('spawn'));
        return child;
      },
    });
    assert.deepEqual(result, { opened: true });
    assert.deepEqual(spawns, [{
      executable: 'rundll32.exe',
      args: ['shell32.dll,OpenAs_RunDLL', filePath],
      options: { detached: true, stdio: 'ignore' },
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('copies, cuts, and pastes desktop files without overwriting existing entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-desktop-clipboard-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  try {
    await mkdir(source);
    await mkdir(destination);
    await writeFile(path.join(source, 'sample.txt'), 'copied');
    const sourcePath = path.join(source, 'sample.txt');

    await handleRequest({ method: 'copy-files', payload: { paths: [sourcePath] } }, root);
    const copied = await handleRequest({
      method: 'paste-files',
      payload: { dir: destination },
    }, root);
    assert.equal(copied.success, true);
    assert.equal(await readFile(path.join(destination, 'sample.txt'), 'utf8'), 'copied');

    await handleRequest({ method: 'cut-files', payload: { paths: [sourcePath] } }, root);
    assert.deepEqual(await handleRequest({ method: 'get-cut-paths' }, root), [sourcePath]);
    const moved = await handleRequest({
      method: 'paste-files',
      payload: { dir: destination },
    }, root);
    assert.equal(moved.success, false);
    assert.equal(moved.results[0].success, false);
    assert.equal(await readFile(sourcePath, 'utf8'), 'copied');

    await handleRequest({ method: 'clear-cut' }, root);
    assert.deepEqual(await handleRequest({ method: 'get-cut-paths' }, root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uses the Windows file clipboard for desktop copy and paste', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-desktop-os-clipboard-'));
  const source = path.join(root, 'source.txt');
  const destination = path.join(root, 'destination');
  const nativeRequests = [];
  let clipboard = { paths: [], isCut: false };
  const context = {
    platform: 'win32',
    projectRoot: root,
    nativeWindowHost: {
      async request(action, payload = {}) {
        nativeRequests.push({ action, payload });
        if (action === 'set-file-clipboard') {
          clipboard = { paths: payload.paths, isCut: payload.isCut };
          return true;
        }
        if (action === 'get-file-clipboard') return clipboard;
        if (action === 'clear-file-clipboard') {
          clipboard = { paths: [], isCut: false };
          return true;
        }
        throw new Error(`Unexpected native action: ${action}`);
      },
    },
  };
  try {
    await writeFile(source, 'clipboard');
    await mkdir(destination);
    await handleRequest({ method: 'cut-files', payload: { paths: [source] } }, context);
    assert.deepEqual(clipboard, { paths: [source], isCut: true });
    assert.deepEqual(await handleRequest({ method: 'get-cut-paths' }, context), [source]);

    const result = await handleRequest({ method: 'paste-files', payload: { dir: destination } }, context);
    assert.equal(result.success, true);
    assert.equal(await readFile(path.join(destination, 'source.txt'), 'utf8'), 'clipboard');
    assert.equal(clipboard.isCut, false);
    assert.deepEqual(nativeRequests.map(({ action }) => action), [
      'set-file-clipboard',
      'get-file-clipboard',
      'get-file-clipboard',
      'clear-file-clipboard',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('copies native dropped files and writes inline dropped files without overwriting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-desktop-drop-'));
  const sourceDirectory = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  const source = path.join(sourceDirectory, 'sample.txt');
  try {
    await mkdir(sourceDirectory);
    await mkdir(destination);
    await writeFile(source, 'native');
    const dropped = await handleRequest({
      method: 'drop-paths',
      payload: { paths: [source], dir: destination },
    }, root);
    assert.equal(dropped.success, true);
    assert.equal(await readFile(source, 'utf8'), 'native');

    const inline = await handleRequest({
      method: 'write-dropped-files',
      payload: {
        dir: destination,
        files: [{ name: 'sample.txt', data: Array.from(Buffer.from('inline')) }],
      },
    }, root);
    assert.equal(inline.success, true);
    assert.equal(await readFile(path.join(destination, 'sample (1).txt'), 'utf8'), 'inline');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports the Node runtime through the sidecar health request', async () => {
  const health = await handleRequest({ method: 'health' }, 'C:\\Omniscience');
  assert.equal(health.nodeVersion, process.version);
  assert.equal(health.projectRoot, 'C:\\Omniscience');
});

test('serves local app pages without bypassing the extension content-script runtime', async () => {
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
    const { server, baseUrl } = await startFileServer(dist);
    try {
      const settings = await handleRequest({
        method: 'set-theme',
        payload: { ...DEFAULT_THEME_SETTINGS, maxR: 80, shadowColor: '#123abc' },
      }, context);
      assert.equal(settings.maxR, 80);
      assert.deepEqual(await handleRequest({ method: 'get-theme' }, context), settings);

      const page = await fetch(`${baseUrl}/webapps/music/index.html`);
      const html = await page.text();
      assert.match(html, /<title>Music<\/title>/);
      assert.doesNotMatch(html, /__omniscience\/theme/);
      assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');

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

test('returns cached Windows shell icons for desktop files and folders', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-desktop-icons-'));
  const filePath = path.join(root, 'sample.txt');
  const directoryPath = path.join(root, 'folder');
  const iconRequests = [];
  const context = {
    projectRoot: root,
    platform: 'win32',
    async extractWindowsAppIcons(requests) {
      iconRequests.push(requests);
      return new Map(requests.map((request) => [
        request.id,
        { dataUrl: `data:image/png;base64,${Buffer.from(path.basename(request.path)).toString('base64')}` },
      ]));
    },
  };
  try {
    await writeFile(filePath, 'content');
    await mkdir(directoryPath);
    const [fileIcon, folderIcon] = await Promise.all([
      handleRequest({ method: 'get-file-icon', payload: { path: filePath } }, context),
      handleRequest({ method: 'get-file-icon', payload: { path: directoryPath } }, context),
    ]);

    assert.deepEqual(fileIcon, {
      success: true,
      fileUrl: `data:image/png;base64,${Buffer.from('sample.txt').toString('base64')}`,
    });

    test('extracts icons for a directory in one background-friendly batch', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'omni-desktop-icon-batch-'));
      const paths = [path.join(root, 'one.txt'), path.join(root, 'two.txt')];
      const calls = [];
      const context = {
        projectRoot: root,
        platform: 'win32',
        async extractWindowsAppIcons(requests) {
          calls.push(requests);
          return new Map(requests.map((request) => [
            request.id,
            { dataUrl: `data:image/png;base64,${Buffer.from(path.basename(request.path)).toString('base64')}` },
          ]));
        },
      };
      try {
        await Promise.all(paths.map((filePath) => writeFile(filePath, 'content')));
        const icons = await handleRequest({ method: 'get-file-icons', payload: { paths } }, context);
        assert.deepEqual(icons, Object.fromEntries(paths.map((filePath) => [
          filePath,
          `data:image/png;base64,${Buffer.from(path.basename(filePath)).toString('base64')}`,
        ])));
        assert.equal(calls.length, 1);
        assert.equal(calls[0].length, paths.length);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    assert.deepEqual(folderIcon, {
      success: true,
      fileUrl: `data:image/png;base64,${Buffer.from('folder').toString('base64')}`,
    });
    assert.equal(iconRequests.length, 1);
    assert.equal(iconRequests[0].length, 2);
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
    async extractWindowsAppIcons(requests) {
      return new Map(requests.map((request) => [
        request.id,
        { dataUrl: 'data:image/png;base64,hidden-window' },
      ]));
    },
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
    icon: 'data:image/png;base64,hidden-window',
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
    async extractWindowsAppIcons(requests) {
      return new Map(requests.map((request) => [
        request.id,
        { dataUrl: 'data:image/png;base64,visible-window' },
      ]));
    },
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
  assert.equal(windows[0].icon, 'data:image/png;base64,visible-window');

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

test('does not prepare drags for native windows hidden from the panel', async () => {
  const requests = [];
  const context = {
    projectRoot: 'C:\\Omniscience',
    platform: 'win32',
    nativeWindowHost: {
      async request(action, payload) {
        requests.push({ action, payload });
        if (action === 'list') {
          return [{
            id: '301',
            title: 'Hidden app',
            visible: true,
            taskbarHidden: true,
            focused: false,
          }];
        }
        if (action === 'prepare-drag') {
          return {
            x: 100,
            y: 120,
            width: 800,
            height: 600,
            cursorX: 899,
            cursorY: 719,
            nativeDrag: true,
          };
        }
        return true;
      },
    },
  };

  const drag = await handleRequest({
    method: 'prepare-native-window-drag',
    payload: { id: '301', mode: 'resize', direction: 'se' },
  }, context);
  assert.deepEqual(drag, { ok: false, abort: true });
  assert.deepEqual(requests, [{ action: 'list', payload: { ownPid: process.pid } }]);
});

test('prepares drags for visible native windows at their matching cursor positions', async () => {
  const requests = [];
  const context = {
    projectRoot: 'C:\\Omniscience',
    platform: 'win32',
    nativeWindowHost: {
      async request(action, payload) {
        requests.push({ action, payload });
        if (action === 'list') {
          return [{
            id: '302',
            title: 'Visible app',
            visible: true,
            taskbarHidden: false,
            focused: false,
          }];
        }
        if (action === 'prepare-drag') {
          return {
            x: 100,
            y: 120,
            width: 800,
            height: 600,
            cursorX: 899,
            cursorY: 719,
            nativeDrag: true,
          };
        }
        return true;
      },
    },
  };

  const drag = await handleRequest({
    method: 'prepare-native-window-drag',
    payload: { id: '302', mode: 'resize', direction: 'se' },
  }, context);
  assert.equal(drag.ok, true);
  assert.deepEqual(drag.cursor, { x: 899, y: 719 });
  assert.equal(drag.nativeDrag, true);
  assert.deepEqual(requests.at(-1), {
    action: 'prepare-drag',
    payload: { hwnd: '302', mode: 'resize', direction: 'se' },
  });

  await handleRequest({
    method: 'set-cursor-position',
    payload: { x: -40, y: 210 },
  }, context);
  assert.deepEqual(requests.at(-1), {
    action: 'cursor',
    payload: { x: -40, y: 210 },
  });
  await assert.rejects(
    handleRequest({
      method: 'set-cursor-position',
      payload: { x: 1.5, y: 210 },
    }, context),
    /32-bit integers/,
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

test('opens built componentapps in trusted Tauri asset windows', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-tauri-'));
  const context = {
    projectRoot: root,
    fileServerUrl: 'http://127.0.0.1:1234',
    themeSettings: { ...DEFAULT_THEME_SETTINGS },
    platform: 'win32',
  };
  try {
    for (const appName of ['create-item', 'power-menu', 'rename', 'settings', 'windows-settings']) {
      await mkdir(path.join(root, 'componentapps', appName), { recursive: true });
      await writeFile(path.join(root, 'componentapps', appName, 'index.html'), '<html></html>');
    }
    for (const appName of ['create-item', 'power-menu', 'rename', 'windows-settings']) {
      await mkdir(path.join(root, 'dist', 'componentapps', appName), { recursive: true });
      await writeFile(path.join(root, 'dist', 'componentapps', appName, 'index.html'), '<html></html>');
    }

    const programs = await handleRequest({ method: 'list-programs' }, context);
    assert.equal(programs.find(({ id }) => id === 'componentapps:create-item').launchable, true);
    assert.equal(programs.find(({ id }) => id === 'componentapps:power-menu').launchable, true);
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
      icon: null,
      appPath: 'omniscience/componentapps/create-item/index.html',
      themeSettings: context.themeSettings,
    });

    const powerMenuProgram = await handleRequest({
      method: 'open-program',
      payload: { programId: 'componentapps:power-menu' },
    }, context);
    assert.deepEqual(powerMenuProgram, {
      kind: 'componentapp',
      name: 'power-menu',
      icon: null,
      appPath: 'omniscience/componentapps/power-menu/index.html',
      themeSettings: context.themeSettings,
    });

    const settingsProgram = await handleRequest({
      method: 'open-program',
      payload: { programId: 'componentapps:windows-settings' },
    }, context);
    assert.deepEqual(settingsProgram, {
      kind: 'componentapp',
      name: 'windows-settings',
      icon: null,
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
