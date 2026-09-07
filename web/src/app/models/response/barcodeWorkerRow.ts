import { BarcodeGradeTile } from './barcodeGradeTile';

export interface BarcodeWorkerRow {
  workerId: number;
  name: string;
  seriesName: string;
  tiles: BarcodeGradeTile[];
}
