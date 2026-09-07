import { WorkerLog } from './workerLog';

/** What the backend recorded for a scan, echoed back for confirmation. */
export interface ScanReceipt {
  entry: WorkerLog;
}
