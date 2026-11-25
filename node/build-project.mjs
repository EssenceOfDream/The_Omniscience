import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const buildDir = path.join(projectRoot, 'node_modules', '.cache', 'project-assets');

global.paths = {
  projectRoot,
  srcDir: path.join(projectRoot, 'src'),
  publicDir: path.join(projectRoot, 'public'),
  distDir: buildDir,
  componentappsDir: path.join(projectRoot, 'componentapps'),
  webappsDir: path.join(projectRoot, 'webapps'),
};

const buildModule = await import(pathToFileURL(path.join(projectRoot, 'main', 'vite_build.js')));
await buildModule.default();

await cp(path.join(projectRoot, 'extensions'), path.join(buildDir, 'extensions'), {
  recursive: true,
  force: true,
});

const publicAssets = path.join(projectRoot, 'public', 'omniscience');
const bundledAssets = path.join(projectRoot, 'dist', 'omniscience');
await Promise.all([
  mkdir(publicAssets, { recursive: true }),
  mkdir(bundledAssets, { recursive: true }),
]);
for (const directory of ['assets', 'componentapps', 'webapps', 'extensions', 'images', 'libs', 'styles']) {
  const source = path.join(buildDir, directory);
  if (!existsSync(source)) continue;
  await Promise.all([
    cp(source, path.join(publicAssets, directory), { recursive: true, force: true }),
    cp(source, path.join(bundledAssets, directory), { recursive: true, force: true }),
  ]);
}
