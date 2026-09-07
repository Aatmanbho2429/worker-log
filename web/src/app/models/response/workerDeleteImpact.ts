import { Worker } from './worker';

export interface WorkerDeleteImpact {
  worker: Worker;
  loggedEntries: number;
}
