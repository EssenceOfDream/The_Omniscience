import absoluteFilePath from './absoluteFilePath.mjs';
import getFileIcons from './getFileIcons.mjs';

export default async function (payload, context) {
  const filePath = absoluteFilePath(payload?.path);
  const icons = await getFileIcons({ paths: [filePath] }, context);
  const fileUrl = icons[filePath] || null;
  return { success: Boolean(fileUrl), fileUrl };
}