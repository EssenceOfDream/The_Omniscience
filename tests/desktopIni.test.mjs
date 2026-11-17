import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDesktopIni, parseDesktopIni } from '../main/desktopIni.js';

test('parses shell class metadata without interpreting other sections', () => {
  const metadata = parseDesktopIni(`
[.ShellClassInfo]
LocalizedResourceName=Projects
InfoTip=My files
IconResource="C:\\\\Windows\\\\folder.ico,0"
[Other]
LocalizedResourceName=Ignored
`, 'C:\\Users\\User\\Desktop\\Projects');

  assert.deepEqual(metadata, {
    localizedName: 'Projects',
    infoTip: 'My files',
    iconPath: 'C:\\Windows\\folder.ico',
  });
});

test('resolves quoted absolute icon paths and environment variables', () => {
  const metadata = parseDesktopIni(
    '[.ShellClassInfo]\nIconFile="%SystemRoot%\\\\folder.ico"',
    'C:\\Users\\User\\Desktop\\Folder',
    { SystemRoot: 'C:\\Windows' },
  );

  assert.equal(metadata.iconPath, 'C:\\Windows\\folder.ico');
});

test('does not treat resource libraries as standalone icon files', () => {
  const metadata = parseDesktopIni(
    '[.ShellClassInfo]\nIconResource="%SystemRoot%\\\\shell32.dll,-50"',
    'C:\\Users\\User\\Desktop\\Folder',
    { SystemRoot: 'C:\\Windows' },
  );

  assert.equal(metadata.iconPath, null);
});

test('ignores resource references for names and tips it cannot localize', () => {
  const metadata = parseDesktopIni(
    '[.ShellClassInfo]\nLocalizedResourceName=@%SystemRoot%\\\\shell32.dll,-21769\nInfoTip=@resource',
    'C:\\Users\\User\\Desktop',
  );

  assert.equal(metadata.localizedName, null);
  assert.equal(metadata.infoTip, null);
});

test('decodes UTF-16LE desktop.ini content with a BOM', () => {
  const content = '[.ShellClassInfo]\nLocalizedResourceName=Рабочий стол';
  const buffer = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(content, 'utf16le'),
  ]);

  assert.equal(decodeDesktopIni(buffer), content);
});

test('decodes legacy Windows Cyrillic text', () => {
  const buffer = Buffer.concat([
    Buffer.from('[.ShellClassInfo]\r\nLocalizedResourceName='),
    Buffer.from([
      0xd0, 0xe0, 0xe1, 0xee, 0xf7, 0xe8, 0xe9, 0x20,
      0xf1, 0xf2, 0xee, 0xeb,
    ]),
  ]);

  assert.equal(
    parseDesktopIni(decodeDesktopIni(buffer), 'C:\\Users\\User\\Desktop').localizedName,
    'Рабочий стол',
  );
});
