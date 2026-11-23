import { build } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { findComponentAppEntry, listComponentAppSources } from './componentapps.js';

function getBuildFingerprint(rootDir, inputDirs) {
  const files = [
    path.join(rootDir, 'main', 'vite_build.js'),
    path.join(rootDir, 'main', 'componentapps.js'),
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
    if (!fs.existsSync(filePath)) continue;
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

function copyAppSource(sourceDir, destinationDir, includeHtml = true) {
  fs.cpSync(sourceDir, destinationDir, {
    recursive: true,
    force: true,
    filter(sourcePath) {
      const relativePath = path.relative(sourceDir, sourcePath);
      if (!relativePath) return true;
      if (!includeHtml && relativePath === 'index.html') return false;
      return !relativePath.split(path.sep).some((part) =>
        part === 'node_modules' || part === '.git');
    },
  });
}

function prepareComponentApps(apps, rootDir) {
  const rootComponentappsDir = path.join(rootDir, 'componentapps');
  const prepared = [];

  for (const app of apps) {
    const currentSource = app.sources.find(({ priority }) => priority === 1);
    const appDir = currentSource
      ? currentSource.directory
      : path.join(rootComponentappsDir, app.name);
    const cleanupDirectory = !currentSource;

    if (cleanupDirectory) {
      fs.mkdirSync(appDir, { recursive: true });
      for (const source of app.sources) copyAppSource(source.directory, appDir);
    }

    const htmlPath = path.join(appDir, 'index.html');
    let cleanupHtml = false;
    if (!fs.existsSync(htmlPath)) {
      const entry = findComponentAppEntry(app);
      if (entry) {
        const source = app.sources.find(({ directory }) =>
          entry === directory || entry.startsWith(`${directory}${path.sep}`));
        const relativeEntry = path.relative(source.directory, entry);
        const scriptPath = path.relative(appDir, path.join(appDir, relativeEntry))
          .split(path.sep)
          .join('/');
        const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${app.name}</title>
</head>
<body>
  <div id="root"></div>
  <script>window.__APP_WINDOW_ID__ = new URLSearchParams(window.location.search).get('windowId') || '';</script>
  <script type="module" src="${scriptPath}"></script>
</body>
</html>`;
        fs.writeFileSync(htmlPath, html, 'utf-8');
        cleanupHtml = true;
      }
    }

    prepared.push({ name: app.name, appDir, htmlPath, cleanupHtml, cleanupDirectory });
  }
  return prepared;
}

function copyComponentappResources(apps, distDir) {
  for (const app of apps) {
    const destDir = path.join(distDir, 'componentapps', app.name);
    for (const source of app.sources) {
      copyAppSource(source.directory, destDir, false);
    }
  }
}

function findModuleFile(candidate) {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  for (const extension of ['.js', '.jsx', '.ts', '.tsx', '.json', '.css']) {
    if (fs.existsSync(`${candidate}${extension}`)) return `${candidate}${extension}`;
  }
  for (const name of ['index.js', 'index.jsx', 'index.ts', 'index.tsx']) {
    const indexPath = path.join(candidate, name);
    if (fs.existsSync(indexPath)) return indexPath;
  }
  return null;
}

function resolveLegacyComponentappImport(source, importer, rootDir) {
  if (!importer || !source.startsWith('.')) return null;
  const currentAppsDir = path.join(rootDir, 'componentapps');
  const relativeImporter = path.relative(currentAppsDir, importer);
  if (relativeImporter.startsWith('..') || path.isAbsolute(relativeImporter)) return null;

  const legacyImporter = path.join(rootDir, 'legacy', 'componentapps', relativeImporter);
  const legacyCandidate = findModuleFile(path.resolve(path.dirname(legacyImporter), source));
  const currentCandidate = findModuleFile(path.resolve(path.dirname(importer), source));
  const appName = relativeImporter.split(path.sep)[0];
  const legacyOnly = !fs.existsSync(path.join(currentAppsDir, appName));

  if (legacyOnly && legacyCandidate) return legacyCandidate;
  if (currentCandidate) return null;
  return legacyCandidate;
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
  const componentApps = listComponentAppSources(rootDir);

  const fingerprint = getBuildFingerprint(rootDir, [
    srcDir,
    publicDir,
    path.join(rootDir, 'themes'),
    path.join(rootDir, 'webapps'),
    path.join(rootDir, 'legacy', 'componentapps'),
    componentappsDir,
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

  const preparedApps = prepareComponentApps(componentApps, rootDir);
  const input = {};
  for (const app of preparedApps) {
    if (fs.existsSync(app.htmlPath)) {
      input[`componentapps/${app.name}/index.html`] = app.htmlPath;
    }
  }

  try {
    await build({
      configFile: false,
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
        rollupOptions: {
          input,
          plugins: [{
            name: 'resolve-legacy-componentapp-imports',
            resolveId(source, importer) {
              return resolveLegacyComponentappImport(source, importer, rootDir);
            },
          }],
        },
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
            copyComponentappResources(componentApps, distDir);
          },
        },
      ],
    });

    fs.writeFileSync(cachePath, JSON.stringify({
      fingerprint,
      outputs: collectOutputFiles(distDir),
    }));
  } finally {
    for (const app of preparedApps) {
      if (app.cleanupHtml) fs.rmSync(app.htmlPath, { force: true });
      if (app.cleanupDirectory) fs.rmSync(app.appDir, { recursive: true, force: true });
    }
  }
}