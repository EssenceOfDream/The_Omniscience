import fs from 'fs';
import { promisify } from 'util';
import crypto from 'crypto';

const open = promisify(fs.open);
const close = promisify(fs.close);
const write = promisify(fs.write);
const ftruncate = promisify(fs.ftruncate);

const FOOTER_SIZE = 512;
const COOKIE = Buffer.from('conectix', 'ascii');

function computeChs(totalSectors) {
  const max = 65535 * 16 * 255;
  if (totalSectors > max) totalSectors = max;
  let spt, heads, cyl;
  if (totalSectors >= 65535 * 16 * 63) {
    spt = 255; heads = 16; cyl = Math.floor(totalSectors / (spt * heads));
  } else {
    spt = 17; cyl = Math.floor(totalSectors / spt);
    heads = Math.floor((cyl + 1023) / 1024);
    if (heads < 4) heads = 4;
    if (cyl >= heads * 1024 || heads > 16) {
      spt = 31; heads = 16; cyl = Math.floor(totalSectors / (spt * heads));
    }
    if (cyl >= heads * 1024) {
      spt = 63; heads = 16; cyl = Math.floor(totalSectors / (spt * heads));
    }
  }
  return { cyl, heads, spt };
}

function buildFooter(diskSizeBytes) {
  const b = Buffer.alloc(FOOTER_SIZE);

  // --- Cookie & version ---
  COOKIE.copy(b, 0);
  b.writeUInt32BE(0x00000002, 8);              // features
  b.writeUInt32BE(0x00010000, 12);             // file format version
  b.writeBigUInt64BE(0xFFFFFFFFFFFFFFFFn, 16); // data offset (fixed VHD)

  // --- Time stamp (seconds since 2000-01-01 00:00:00) ---
  const ts = Math.floor(Date.now() / 1000) - Math.floor(Date.UTC(2000, 0, 1) / 1000);
  b.writeUInt32BE(ts >>> 0, 24);

  // --- Creator ---
  b.write('VHDA', 28, 'ascii');
  b.writeUInt32BE(0x00010000, 32);
  b.write('Wi2k', 36, 'ascii');

  // --- Sizes ---
  b.writeBigUInt64BE(BigInt(diskSizeBytes), 40);
  b.writeBigUInt64BE(BigInt(diskSizeBytes), 48);

  // --- Geometry ---
  const g = computeChs(Math.floor(diskSizeBytes / 512));
  b.writeUInt16BE(g.cyl, 56);
  b.writeUInt8(g.heads, 58);
  b.writeUInt8(g.spt, 59);

  // --- Disk type = fixed ---
  b.writeUInt32BE(2, 60);

  // === ВАЖНО: UUID и saved state ДОЛЖНЫ быть записаны ДО подсчёта checksum ===
  const hex = crypto.randomUUID().replace(/-/g, '');
  Buffer.from(hex, 'hex').copy(b, 68);
  b.writeUInt8(0, 84); // saved state

  // === Теперь checksum: one's complement от суммы всех байт, кроме поля 64..67 ===
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += b[i];
  for (let i = 68; i < FOOTER_SIZE; i++) sum += b[i];
  b.writeUInt32BE((~sum) >>> 0, 64);

  return b;
}

export async function createFixedVhd(vhdPath, diskSizeBytes, signal) {
  const diskSize = Math.ceil(diskSizeBytes / 512) * 512;
  const fileSize = diskSize + FOOTER_SIZE;
  const fd = await open(vhdPath, 'w');
  try {
    await ftruncate(fd, fileSize);
    const footer = buildFooter(diskSize);
    await write(fd, footer, 0, FOOTER_SIZE, diskSize);
    if (signal?.aborted) throw new Error('Отменено');
  } finally { await close(fd); }
}