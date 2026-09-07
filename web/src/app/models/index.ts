// Domain models, split by direction per `.claude/rules/models.md`: anything
// the front end sends is a request, anything it receives is a response. Every
// type is re-exported flatly here so the rest of the app keeps writing
// `import { Grade } from '../../models'` rather than reaching into
// `models/response`.

export * from './request';
export * from './response';

import { Worker } from './response/worker';

export function workerFullName(worker: Worker): string {
  return `${worker.firstName} ${worker.lastName}`.trim();
}

/** Sums a row of per-grade counts. */
export function sumCounts(counts: readonly number[]): number {
  return counts.reduce((total, count) => total + count, 0);
}
