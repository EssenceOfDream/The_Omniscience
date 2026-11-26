import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../main/windowsUwpHost.ps1',
);