import os from 'node:os';
import path from 'node:path';

export default function(context, extensionId) {
  const defaultDirectory = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'The_Omniscience', 'extensions')
    : path.join(os.homedir(), '.the-omniscience', 'extensions');
  return path.join(
    context.extensionStoragePath ?? defaultDirectory,
    `${extensionId}.json`,
  );
}