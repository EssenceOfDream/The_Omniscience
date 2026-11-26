import { randomUUID } from 'node:crypto';
import { state } from './state.mjs';

export default function (instanceId, operation) {
  if (state.activeArchiverJob && !state.activeArchiverJob.done) {
    return { ok: false, error: 'Уже выполняется другая задача' };
  }
  const job = {
    id: randomUUID(),
    instanceId,
    controller: new AbortController(),
    progress: [],
    done: false,
    result: null,
  };
  state.activeArchiverJob = job;
  const send = (progress) => {
    job.progress.push(progress);
    if (job.progress.length > 512) job.progress.shift();
  };
  void Promise.resolve()
    .then(() => operation(send, job.controller.signal))
    .then((result) => { job.result = { ok: true, result }; })
    .catch((error) => {
      job.result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    })
    .finally(() => { job.done = true; });
  return { ok: true, jobId: job.id };
}