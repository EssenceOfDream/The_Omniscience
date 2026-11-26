import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { enumeratePaths } from '../componentapps/omni-archiver/enumerate.js';
import { readClipboard } from '../componentapps/omni-archiver/clipboard.js';
import { runPipeline } from '../componentapps/omni-archiver/pipeline.js';
import {
  extractFilesFromVhd,
  extractVhdFromFragments,
} from '../componentapps/omni-archiver/unpack.js';
import resolveArchiverOutputPath from './resolveArchiverOutputPath.mjs';
import startArchiverJob from './startArchiverJob.mjs';
import { state } from './state.mjs';

export default async function (instanceId, channel, args) {
  if (channel === 'resolve-output-path') return resolveArchiverOutputPath(args[0]);
  if (channel === 'read-clipboard') {
    const tempDir = path.join(os.tmpdir(), `omni-archiver-${process.pid}`);
    await mkdir(tempDir, { recursive: true });
    try {
      return { ok: true, data: await readClipboard(tempDir) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (channel === 'save-text-to-temp') {
    if (typeof args[0] !== 'string') return { ok: false, error: 'Ожидался текст' };
    const tempDir = path.join(os.tmpdir(), `omni-archiver-${process.pid}`);
    await mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `clip-${randomUUID()}.txt`);
    await writeFile(filePath, args[0], 'utf8');
    return { ok: true, path: filePath };
  }
  if (channel === 'enumerate') {
    try {
      return { ok: true, ...(await enumeratePaths(args[0])) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (channel === 'start') {
    return startArchiverJob(instanceId, (send, signal) =>
      runPipeline(args[0], send, signal));
  }
  if (channel === 'unpack-fragments') {
    const { firstFragment, outputVhd } = args[0] || {};
    return startArchiverJob(instanceId, async (send, signal) => {
      await extractVhdFromFragments(firstFragment, outputVhd, send, signal);
    });
  }
  if (channel === 'unpack-vhd') {
    const { vhdPath, outputDir } = args[0] || {};
    return startArchiverJob(instanceId, async (send, signal) => {
      await extractFilesFromVhd(vhdPath, outputDir, send, signal);
    });
  }
  if (channel === 'poll') {
    const job = state.activeArchiverJob;
    if (!job || job.id !== args[0] || job.instanceId !== instanceId) {
      return { ok: false, error: 'Задача не найдена' };
    }
    const result = {
      ok: true,
      progress: job.progress.splice(0),
      done: job.done,
      result: job.done ? job.result : null,
    };
    if (job.done) state.activeArchiverJob = null;
    return result;
  }
  if (channel === 'cancel') {
    const job = state.activeArchiverJob;
    if (!job || job.id !== args[0] || job.instanceId !== instanceId) {
      return { ok: false, error: 'Задача не найдена' };
    }
    job.controller.abort();
    return { ok: true };
  }
  throw new Error(`Unsupported Omni Archiver channel ${channel}`);
}