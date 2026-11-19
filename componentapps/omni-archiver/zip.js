import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import { once } from 'events';
import archiver from 'archiver';

class FragmentWriter extends Writable {
  constructor(limit, getFilename, onFragment) {
    super();
    this.limit = limit;
    this.getFilename = getFilename;
    this.onFragment = onFragment;
    this.index = 0;
    this.currentStream = null;
    this.currentSize = 0;
    this.currentFilename = null;
  }

  _open() {
    this.index++;
    this.currentFilename = this.getFilename(this.index);
    this.currentStream = fs.createWriteStream(this.currentFilename);
    this.currentSize = 0;
  }

  async _write(chunk, _enc, cb) {
    try {
      let offset = 0;
      while (offset < chunk.length) {
        if (!this.currentStream) this._open();
        // Оставляем 1 байт «в запасе», чтобы фрагмент был строго < limit
        const room = this.limit - this.currentSize - 1;
        const take = Math.min(room, chunk.length - offset);
        const slice = chunk.subarray(offset, offset + take);
        if (!this.currentStream.write(slice)) await once(this.currentStream, 'drain');
        this.currentSize += take;
        offset += take;
        if (this.currentSize >= this.limit - 1) {
          this.currentStream.end();
          await once(this.currentStream, 'close');
          this.onFragment(this.currentFilename, this.currentSize);
          this.currentStream = null;
          this.currentSize = 0;
        }
      }
      cb();
    } catch (e) { cb(e); }
  }

  async _final(cb) {
    try {
      if (this.currentStream) {
        this.currentStream.end();
        await once(this.currentStream, 'close');
        this.onFragment(this.currentFilename, this.currentSize);
        this.currentStream = null;
      }
      cb();
    } catch (e) { cb(e); }
  }
}

export async function zipAndSplit({
  vhdPath, outputDir, baseName, maxSizeBytes, renameToTxt,
  onProgress, signal,
}) {
  const vhdSize = fs.statSync(vhdPath).size;

  const getFilename = (i) => {
    const num = String(i).padStart(3, '0');
    const base = path.join(outputDir, `${baseName}.vhd.zip.${num}`);
    return renameToTxt ? `${base}.txt` : base;
  };

  const fragments = [];
  const onFragment = (p, size) => {
    fragments.push({ path: p, size });
    onProgress({ progress: null, fragment: p, fragmentSize: size, fragmentCount: fragments.length });
  };

  const writer = new FragmentWriter(maxSizeBytes, getFilename, onFragment);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (e) => { if (e.code !== 'ENOENT') throw e; });

  let read = 0;
  const vhdStream = fs.createReadStream(vhdPath);
  vhdStream.on('data', (c) => {
    read += c.length;
    onProgress({ progress: Math.round(read * 100 / vhdSize) });
    if (signal.aborted) vhdStream.destroy(new Error('Отменено'));
  });

  archive.append(vhdStream, { name: `${baseName}.vhd` });
  archive.pipe(writer);

  const done = new Promise((resolve, reject) => {
    archive.on('error', reject);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  archive.finalize();
  await done;

  return { fragments, totalSize: fragments.reduce((s, f) => s + f.size, 0), count: fragments.length };
}