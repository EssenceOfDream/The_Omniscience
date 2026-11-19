import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import unzipper from 'unzipper';

export async function extractVhdFromFragments(firstFragmentPath, outputVhdPath, send, signal) {
  const dir = path.dirname(firstFragmentPath);
  const base = path.basename(firstFragmentPath).replace(/\.vhd\.zip\.001(\.txt)?$/i, '');

  const allFiles = await fsp.readdir(dir);
  const parts = allFiles
    .filter(f => f.startsWith(`${base}.vhd.zip.`) && /\.\d{3}(\.txt)?$/i.test(f))
    .sort();

  if (!parts.length) throw new Error('Фрагменты не найдены');

  send({ stage: 'merge', message: `Найдено ${parts.length} фрагментов. Склеиваю...`, progress: 0 });

  // 1. Склеиваем фрагменты в один временный ZIP-файл
  const tempZipPath = path.join(dir, `.${base}.merged.zip`);
  const writeStream = fs.createWriteStream(tempZipPath);

  try {
    for (const part of parts) {
      if (signal.aborted) throw new Error('Отменено');

      const readStream = fs.createReadStream(path.join(dir, part));
      // Ждём окончания чтения текущего фрагмента, не закрывая writeStream
      await new Promise((resolve, reject) => {
        readStream.on('error', reject);
        writeStream.on('error', reject);
        readStream.on('end', resolve);
        readStream.pipe(writeStream, { end: false });
      });
    }

    // Завершаем запись временного ZIP
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      writeStream.end();
    });
  } catch (err) {
    writeStream.destroy();
    await fsp.unlink(tempZipPath).catch(() => { });
    throw err;
  }

  send({ stage: 'unzip', message: 'Распаковываю VHD...', progress: 50 });

  // 2. Открываем склеенный ZIP через надёжный Open.file
  try {
    const directory = await unzipper.Open.file(tempZipPath);
    const vhdEntry = directory.files.find(f => f.path.toLowerCase().endsWith('.vhd'));

    if (!vhdEntry) throw new Error('В архиве не найден файл .vhd');

    await fsp.mkdir(path.dirname(outputVhdPath), { recursive: true });
    await new Promise((resolve, reject) => {
      vhdEntry.stream()
        .pipe(fs.createWriteStream(outputVhdPath))
        .on('finish', resolve)
        .on('error', reject);
    });
  } finally {
    // 3. Удаляем временный ZIP в любом случае (успех или ошибка)
    await fsp.unlink(tempZipPath).catch(() => { });
  }

  send({ stage: 'done', message: 'VHD успешно извлечён', progress: 100 });
  return outputVhdPath;
}

export async function extractFilesFromVhd(vhdPath, outputDir, send, signal) {
  const tempDir = await fsp.mkdtemp(path.join(process.env.TEMP || '/tmp', 'omni-unvhd-'));
  const statusFile = path.join(tempDir, 'status.json');
  const scriptFile = path.join(tempDir, 'unvhd.ps1');
  const logFile = path.join(tempDir, 'elevated.log');
  const exitFile = path.join(tempDir, 'elevated.exit');
  const bootFile = `${statusFile}.boot`;

  const scriptSrc = fileURLToPath(new URL('./unvhd.ps1', import.meta.url));

  await fsp.writeFile(statusFile, JSON.stringify({ stage: 'pending' }), 'utf8');
  await fsp.copyFile(scriptSrc, scriptFile);
  await fsp.mkdir(outputDir, { recursive: true });

  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

  const innerCmd =
    `$ErrorActionPreference = 'Continue'; ` +
    `& ${q(scriptFile)} -VhdPath ${q(vhdPath)} -OutputDir ${q(outputDir)} -StatusFile ${q(statusFile)} *> ${q(logFile)}; ` +
    `$code = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }; ` +
    `$code | Out-File -FilePath ${q(exitFile)} -Encoding ASCII -Force`;

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

  const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', outerCmd], { windowsHide: true });

  send({ stage: 'mount', message: 'Запрашиваю права администратора для монтирования VHD...', progress: 0 });

  let exited = false;
  proc.on('close', () => { exited = true; });
  const startedAt = Date.now();

  while (!exited) {
    if (signal.aborted) { try { proc.kill(); } catch { } throw new Error('Отменено'); }
    await new Promise((r) => setTimeout(r, 300));
    try {
      let raw = await fsp.readFile(statusFile, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      const s = JSON.parse(raw);
      if (s.stage && s.stage !== 'pending' && s.stage !== 'error') {
        send({ stage: s.stage, message: s.message || '', progress: s.progress ?? 0 });
      }
      if (s.stage === 'done') break;
    } catch { }
    if (Date.now() - startedAt > 30 * 60 * 1000) { try { proc.kill(); } catch { } throw new Error('Таймаут'); }
  }
  if (!exited) await new Promise((r) => proc.on('close', r));

  let logContent = '';
  for (const f of [logFile, `${statusFile}.log`]) {
    try {
      let raw = await fsp.readFile(f, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      if (raw.trim()) logContent += `--- ${path.basename(f)} ---\n${raw}\n`;
    } catch { }
  }

  const bootExists = await fsp.access(bootFile).then(() => true).catch(() => false);
  if (!bootExists) {
    let exitRaw = '';
    try { exitRaw = (await fsp.readFile(exitFile, 'utf8')).replace(/^\uFEFF/, '').trim(); } catch { }

    let msg = 'UAC-скрипт не запустился (возможно, отменён запрос прав или ошибка в PowerShell)';
    if (exitRaw.startsWith('ELEVATION_ERROR')) {
      msg = `Ошибка UAC: ${exitRaw.replace('ELEVATION_ERROR: ', '')}`;
    }
    if (logContent) {
      msg += `\n\nЛог выполнения:\n${logContent}`;
    }
    throw new Error(msg);
  }

  let final = null;
  try { final = JSON.parse((await fsp.readFile(statusFile, 'utf8')).replace(/^\uFEFF/, '')); } catch { }

  if (final?.stage !== 'done') {
    throw new Error(`Не удалось распаковать VHD: ${final?.message || 'ошибка'}\n\nЛог:\n${logContent.split('\n').slice(-15).join('\n')}`);
  }

  try { await fsp.rm(tempDir, { recursive: true, force: true }); } catch { }
  send({ stage: 'done', message: 'Файлы успешно скопированы!', progress: 100 });
}