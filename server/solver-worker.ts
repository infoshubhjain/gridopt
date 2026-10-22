import { parentPort, workerData } from 'node:worker_threads';
import { optimizeDispatch } from './optimizer.js';
import type { Scenario } from './model.js';

parentPort!.postMessage(await optimizeDispatch(workerData as Scenario));
