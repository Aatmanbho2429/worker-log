import { BarcodeReasonSheet } from './barcodeReasonSheet';
import { Grade } from './grade';

export interface BarcodeSheet {
  grades: Grade[];
  reasons: BarcodeReasonSheet[];
  seriesName: string | null;
  generatedAt: string;
}
