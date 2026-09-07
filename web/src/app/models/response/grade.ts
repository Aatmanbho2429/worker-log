/**
 * A waste grade — a button on the waste screen, a column on the month sheet
 * and a barcode on the scanning sheet.
 *
 * The register ships with grade 3 and grade 4; screens read the list rather
 * than assuming those two, so a third appears everywhere without further
 * change.
 */
export interface Grade {
  id: number;
  name: string;
  createdDate: string;
  modifiedDate: string;
  /** Waste entries logged against it, used to explain why a delete is blocked. */
  entryCount: number;
}
