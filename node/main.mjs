import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import DEFAULT_THEME_SETTINGS from './DEFAULT_THEME_SETTINGS.mjs';
import startFileServer from './startFileServer.mjs';
import handleRequest from './handleRequest.mjs';

export default async function () {
  const projectRoot = process.argv[2];
  if (!projectRoot) throw new Error('Project root argument is required');

  const context = {
    projectRoot,
    fileServerUrl: null,
    themeSettings: { ...DEFAULT_THEME_SETTINGS },
    platform: process.platform,
    nativeWindowOwnPid: Number.isSafeInteger(Number(process.argv[3]))
      && Number(process.argv[3]) > 0
      ? Number(process.argv[3])
      : process.pid,
  };
  const { server, baseUrl } = await startFileServer(
    path.join(projectRoot, 'public', 'omniscience'),
  );
  context.fileServerUrl = baseUrl;
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of input) {
      let request;
      try {
        request = JSON.parse(line);
        const result = await handleRequest(request, context);
        process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({
          id: request?.id ?? null,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })}\n`);
      }
    }
  } finally {
    context.nativeWindowHost?.close();
    server.close();
  }
}

// Так же, как в оригинале — entry-point срабатывает только при `node main.mjs`.
// Для barrel'а этот блок НЕ нужен: он там в конце barrel-файла.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // в barrel-сценарии main импортируется и вызывается из barrel,
  // поэтому этот блок сработает только если ты запустишь `node main.mjs` напрямую.
}