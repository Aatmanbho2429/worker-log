/** The bars of one Code 128 symbol, as widths in modules. */
export interface BarcodeSymbol {
  /** The digits encoded, printed under the bars. */
  code: string;
  /** Alternating bar, space, bar, space … starting with a bar. */
  modules: number[];
  /** Total width including both quiet zones, so callers can scale to fit. */
  moduleCount: number;
}
