declare module 'bplist-parser' {
  /** Parses a binary plist buffer; returns the decoded top-level object(s). */
  export function parseBuffer(buffer: Buffer): unknown[];
  const _default: { parseBuffer: typeof parseBuffer };
  export default _default;
}

declare module 'coordinate_to_country' {
  interface Options {
    format?: 'alpha2' | 'alpha3' | 'numeric';
  }
  /** Offline point-in-polygon country lookup. Returns matching ISO codes. */
  export default function coordinateToCountry(
    lat: number,
    lng: number,
    options?: Options
  ): string[];
}
