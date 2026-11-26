import path from 'node:path';
import getUserDirectories from './getUserDirectories.mjs';

export default async function (projectRoot, platform) {
  const dirs = await getUserDirectories();
  const folders = [
    { id: 'project', name: 'The Omniscience', path: projectRoot },
    { id: 'home', name: 'Домашняя папка', path: dirs.home },
    { id: 'downloads', name: 'Загрузки', path: dirs.download },
    { id: 'pictures', name: 'Картинки', path: dirs.pictures },
    { id: 'documents', name: 'Документы', path: dirs.documents },
    { id: 'music', name: 'Музыка', path: dirs.music },
    { id: 'videos', name: 'Видео', path: dirs.videos },
  ];
  folders.unshift(platform === 'win32'
    ? { id: 'c_root', name: 'Диск C:', path: path.parse(projectRoot).root || 'C:\\' }
    : { id: 'root', name: 'Корень ФС', path: path.parse(projectRoot).root || '/' });
  return folders;
}