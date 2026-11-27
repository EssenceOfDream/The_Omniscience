import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startWindowsAppIconHost } from './windows-app-icon-host.mjs';

let defaultHost;
const defaultProjectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export default function (context) {
  if (typeof context !== 'string') {
    if (!context.windowsAppIconHost) {
      context.windowsAppIconHost = startWindowsAppIconHost(
        context.projectRoot || defaultProjectRoot,
      );
    }
    return context.windowsAppIconHost;
  }

  if (!defaultHost) defaultHost = startWindowsAppIconHost(context);
  return defaultHost;
}
