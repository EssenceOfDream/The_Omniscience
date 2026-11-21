import { build } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

function getBuildFingerprint(rootDir, inputDirs) {
  const files = [
    path.join(rootDir, 'main', 'vite_build.js'),
    path.join(rootDir, 'package.json'),
    path.join(rootDir, 'package-lock.json'),
  ];

  function collectFiles(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) collectFiles(filePath);
      else if (entry.isFile()) files.push(filePath);
    }
  }

  for (const dir of inputDirs) collectFiles(dir);

  const hash = crypto.createHash('sha256');
  for (const filePath of files.sort()) {
    const { size, mtimeMs } = fs.statSync(filePath);
    hash.update(`${path.relative(rootDir, filePath)}\0${size}\0${mtimeMs}\n`);
  }
  return hash.digest('hex');
}

function collectOutputFiles(dir, rootDir = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectOutputFiles(filePath, rootDir));
    } else if (entry.isFile() && filePath !== path.join(rootDir, '.vite-build-cache.json')) {
      files.push(path.relative(rootDir, filePath));
    }
  }
  return files;
}

function isBuildCacheValid(cache, fingerprint, distDir) {
  return cache?.fingerprint === fingerprint
    && Array.isArray(cache.outputs)
    && cache.outputs.length > 0
    && cache.outputs.every((file) => typeof file === 'string'
      && !path.isAbsolute(file)
      && fs.existsSync(path.join(distDir, file)));
}

export default async function () {
  const rootDir = global.paths.projectRoot;
  const srcDir = global.paths.srcDir;
  const publicDir = global.paths.publicDir;
  const distDir = global.paths.distDir;
  const componentappsDir = global.paths.componentappsDir;

  const input = {};

  const componentInputs = [];
  if (fs.existsSync(componentappsDir)) {
    const entries = fs.readdirSync(componentappsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const appDir = path.join(componentappsDir, entry.name);
      const componentFile = path.join(appDir, 'Index.jsx');
      if (!fs.existsSync(componentFile)) continue;

      const htmlPath = path.join(appDir, 'index.html');
      if (!fs.existsSync(htmlPath)) {
        const htmlContent = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${entry.name}</title>
</head>
<body>
  <div id="root"></div>
  <script>
    window.__APP_WINDOW_ID__ = new URLSearchParams(window.location.search).get('windowId') || '';
  </script>
  <script type="module" src="./Index.jsx"></script>
</body>
</html>`;
        fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
      }

      const mainJsxPath = path.join(appDir, 'Index.jsx');
      if (!fs.existsSync(mainJsxPath)) {
        const mainContent = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App windowId={window.__APP_WINDOW_ID__} />
  </React.StrictMode>
);`;
        fs.writeFileSync(mainJsxPath, mainContent, 'utf-8');
      }

      input[`componentapps/${entry.name}/index.html`] = htmlPath;
      componentInputs.push(appDir);
    }
  }

  const fingerprint = getBuildFingerprint(rootDir, [
    srcDir,
    publicDir,
    path.join(rootDir, 'themes'),
    path.join(rootDir, 'webapps'),
    ...componentInputs,
  ]);
  const cachePath = path.join(distDir, '.vite-build-cache.json');
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (isBuildCacheValid(cache, fingerprint, distDir)) {
        console.log('[vite] Build is up to date; reusing dist.');
        return;
      }
    } catch (error) {
      console.warn('[vite] Build cache is unreadable; rebuilding.', error);
    }
  }

  await build({
    root: rootDir,
    base: './',
    resolve: {
      alias: {
        '@src': srcDir,
        '@public': publicDir,
        '@viewRuntime': path.join(srcDir, 'viewRuntime', 'index.js'),
        '@themes': path.join(rootDir, 'themes'),
      },
    },
    build: {
      outDir: distDir,
      emptyOutDir: true,
      sourcemap: true,
      chunkSizeWarningLimit: Infinity,
      rollupOptions: { input },
    },
    publicDir: path.join(rootDir, 'public'),
    plugins: [
      {
        name: 'copy-webapps',
        async writeBundle() {
          const webappsDir = global.paths.webappsDir;
          if (fs.existsSync(webappsDir)) {
            const dest = path.join(distDir, 'webapps');
            fs.cpSync(webappsDir, dest, { recursive: true });
          }
        },
      },
    ],
  });

  fs.writeFileSync(cachePath, JSON.stringify({
    fingerprint,
    outputs: collectOutputFiles(distDir),
  }));
}