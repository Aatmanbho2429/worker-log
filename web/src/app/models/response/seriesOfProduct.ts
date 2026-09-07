export interface SeriesOfProduct {
  id: number;
  name: string;
  createdDate: string;
  modifiedDate: string;
  /** Workers currently assigned, used to explain why a delete is blocked. */
  workerCount: number;
}
