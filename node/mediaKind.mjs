import path from 'node:path';

export default function (name) {
  const extension = path.extname(name).slice(1).toLowerCase();
  if (['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'].includes(extension)) {
    return 'image';
  }
  if (['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'ogv', 'flv', 'wmv', 'mpg', 'mpeg'].includes(extension)) {
    return 'video';
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'alac'].includes(extension)) {
    return 'audio';
  }
  return null;
}