import { Grade } from './grade';

export interface GradeDeleteImpact {
  grade: Grade;
  /** Printed barcodes that would stop working. */
  barcodes: number;
}
