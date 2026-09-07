import { BarcodeWorkerRow } from './barcodeWorkerRow';

export interface BarcodeReasonSheet {
  reasonId: number;
  reasonName: string;
  rows: BarcodeWorkerRow[];
}
