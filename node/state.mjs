import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);

export const state = {
  desktopClipboardPaths: [],
  desktopCutPaths: [],
  activeArchiverJob: null,
  minServers: new Map(),
};