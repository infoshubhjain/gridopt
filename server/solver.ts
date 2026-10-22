import { Worker } from 'node:worker_threads';
import type { Scenario } from './model.js';
import type { optimizeDispatch } from './optimizer.js';

export function solveDispatch(scenario: Scenario): Promise<Awaited<ReturnType<typeof optimizeDispatch>>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./solver-worker.ts', import.meta.url), { workerData: scenario });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Optimizer timed out. Try a shorter scenario.')); }, 15_000);
    worker.once('message', result => { clearTimeout(timer); resolve(result); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { if (code !== 0) { clearTimeout(timer); reject(new Error(`Optimizer worker exited with code ${code}.`)); } });
  });
}
