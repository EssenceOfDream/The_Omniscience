import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const exec = promisify(execFile);

async function ps(cmd) {
  const { stdout } = await exec('powershell.exe',
    ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd],
    { maxBuffer: 50 * 1024 * 1024, windowsHide: true });
  return stdout;
}

export async function readClipboard(tempDir) {
  // 1. Файлы
  try {
    const out = await ps(
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$list = [System.Windows.Forms.Clipboard]::GetFileDropList(); ' +
      'if ($list.Count -gt 0) { $list | ForEach-Object { $_ } }'
    );
    const paths = out.trim().split(/\r?\n/).filter(Boolean);
    if (paths.length) return { type: 'files', paths };
  } catch {}

  // 2. Изображение → temp PNG
  try {
    const has = await ps(
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      'if ([System.Windows.Forms.Clipboard]::ContainsImage()) { "yes" }'
    );
    if (has.trim() === 'yes') {
      const file = path.join(tempDir, `clip-${Date.now()}.png`);
      const escaped = file.replace(/\\/g, '\\\\');
      await ps(
        'Add-Type -AssemblyName System.Windows.Forms; ' +
        'Add-Type -AssemblyName System.Drawing; ' +
        `$img = [System.Windows.Forms.Clipboard]::GetImage(); $img.Save("${escaped}", [System.Drawing.Imaging.ImageFormat]::Png)`
      );
      return { type: 'files', paths: [file] };
    }
  } catch {}

  // 3. Текст
  try {
    const text = await ps('Get-Clipboard -Raw');
    const trimmed = text.replace(/\r?\n$/, '');
    if (trimmed) return { type: 'text', text: trimmed };
  } catch {}

  // 4. HTML
  try {
    const html = await ps('Get-Clipboard -Format Html -ErrorAction SilentlyContinue');
    if (html.trim()) return { type: 'html', html };
  } catch {}

  // 5. RTF
  try {
    const rtf = await ps('Get-Clipboard -Format Rtf -ErrorAction SilentlyContinue');
    if (rtf.trim()) return { type: 'rtf', rtf };
  } catch {}

  throw new Error('Буфер обмена пуст или содержит неподдерживаемый формат');
}