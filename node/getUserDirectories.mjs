import os from 'node:os';
import path from 'node:path';
import isDirectory from './isDirectory.mjs';

export default async function () {
  const home = os.homedir();
  const desktop = path.join(home, 'Desktop');
  const oneDriveDesktop = process.env.OneDrive
    ? path.join(process.env.OneDrive, 'Desktop')
    : null;
  const desktopPath = await isDirectory(desktop)
    ? desktop
    : oneDriveDesktop && await isDirectory(oneDriveDesktop)
      ? oneDriveDesktop
      : desktop;
  return {
    home,
    desktop: desktopPath,
    download: path.join(home, 'Downloads'),
    documents: path.join(home, 'Documents'),
    pictures: path.join(home, 'Pictures'),
    music: path.join(home, 'Music'),
    videos: path.join(home, 'Videos'),
  };
}