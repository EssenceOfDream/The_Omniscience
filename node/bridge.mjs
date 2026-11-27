export { default as DEFAULT_THEME_SETTINGS } from './DEFAULT_THEME_SETTINGS.mjs';

export { default as openWindowsSettingsCategory } from './openWindowsSettingsCategory.mjs';
export { default as startFileServer } from './startFileServer.mjs';
export { default as listPrograms } from './listPrograms.mjs';
export { default as handleRequest } from './handleRequest.mjs';

import { pathToFileURL } from 'node:url';
import main from './main.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[tauri-node-sidecar]', error);
    process.exitCode = 1;
  });
}