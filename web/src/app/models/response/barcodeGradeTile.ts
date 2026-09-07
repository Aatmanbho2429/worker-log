import { BarcodeSymbol } from './barcodeSymbol';

/** One grade's barcode in a worker's row: the button it stands in for. */
export interface BarcodeGradeTile {
  gradeId: number;
  gradeName: string;
  symbol: BarcodeSymbol;
}
