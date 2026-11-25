import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDependencies = [
  '@lydell/node-pty',
  'archiver',
  'iconv-lite',
  'node-wifi',
  'unzipper',
  'ws',
];
const bundlePath = path.join(projectRoot, 'src-tauri', 'target', 'runtime-bundle.zip');
const hashPath = path.join(projectRoot, 'src-tauri', 'target', 'runtime-bundle.sha256');
const temporaryBundlePath = `${bundlePath}.tmp`;
const temporaryHashPath = `${hashPath}.tmp`;

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Standalone runtime packaging currently supports Windows x64 only.');
}

function resolvePackageDirectory(name, importerDirectory) {
  const packageSegments = name.split('/');
  let directory = importerDirectory;
  while (true) {
    const candidate = path.join(directory, 'node_modules', ...packageSegments);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

const packagedPackages = new Set();
const packageQueue = runtimeDependencies.map((name) => ({
  name,
  importerDirectory: projectRoot,
  required: true,
}));

while (packageQueue.length > 0) {
  const { name, importerDirectory, required } = packageQueue.shift();
  const packageDirectory = resolvePackageDirectory(name, importerDirectory);
  if (!packageDirectory) {
    if (required) throw new Error(`Required Node runtime package is missing: ${name}`);
    continue;
  }
  const relativeDirectory = path.relative(projectRoot, packageDirectory);
  if (packagedPackages.has(relativeDirectory)) continue;
  packagedPackages.add(relativeDirectory);

  const manifest = JSON.parse(
    await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
  );
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    packageQueue.push({
      name: dependency,
      importerDirectory: packageDirectory,
      required: true,
    });
  }
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
    packageQueue.push({
      name: dependency,
      importerDirectory: packageDirectory,
      required: false,
    });
  }
  for (const dependency of Object.keys(manifest.peerDependencies ?? {})) {
    packageQueue.push({
      name: dependency,
      importerDirectory: packageDirectory,
      required: false,
    });
  }
}

const runtimeDirectories = [
  ['node', 'node'],
  ['main', 'main'],
  ['componentapps', 'componentapps'],
  ['webapps', 'webapps'],
  ['extensions', 'extensions'],
  ['public/omniscience', 'public/omniscience'],
];
for (const [source, archivePath] of runtimeDirectories) {
  if (!existsSync(path.join(projectRoot, source))) {
    throw new Error(`Required sidecar runtime directory is missing: ${source}`);
  }
}

await mkdir(path.dirname(bundlePath), { recursive: true });
await rm(temporaryBundlePath, { force: true });
await rm(temporaryHashPath, { force: true });

const output = createWriteStream(temporaryBundlePath);
const archive = new ZipArchive({ zlib: { level: 6 } });
const completed = new Promise((resolve, reject) => {
  output.once('close', resolve);
  output.once('error', reject);
  archive.once('error', reject);
});
archive.pipe(output);
archive.file(process.execPath, { name: 'node.exe' });
archive.append(JSON.stringify({ type: 'module' }), { name: 'package.json' });

for (const [source, archivePath] of runtimeDirectories) {
  archive.directory(path.join(projectRoot, source), archivePath);
}
const legacyComponentapps = path.join(projectRoot, 'legacy', 'componentapps');
if (existsSync(legacyComponentapps)) {
  archive.directory(legacyComponentapps, 'legacy/componentapps');
}
for (const relativeDirectory of packagedPackages) {
  const archivePath = relativeDirectory.split(path.sep).join('/');
  archive.directory(
    path.join(projectRoot, relativeDirectory),
    archivePath,
    (entry) => {
      const entryPath = entry.name.replaceAll('\\', '/').split('/');
      return entryPath.includes('node_modules') || entry.name.toLowerCase().endsWith('.pdb')
        ? false
        : entry;
    },
  );
}

await archive.finalize();
await completed;

const hash = createHash('sha256');
for await (const chunk of createReadStream(temporaryBundlePath)) {
  hash.update(chunk);
}
const bundleHash = hash.digest('hex');
await writeFile(temporaryHashPath, `${bundleHash}\n`, 'utf8');

const bundleSize = (await stat(temporaryBundlePath)).size;
await rm(bundlePath, { force: true });
await rename(temporaryBundlePath, bundlePath);
await rm(hashPath, { force: true });
await rename(temporaryHashPath, hashPath);
console.log(
  `[runtime] Packaged ${packagedPackages.size} Node packages (${(bundleSize / 1024 / 1024).toFixed(1)} MiB, SHA-256 ${bundleHash}).`,
);
