export function flagEmoji(cc: string): string {
  const code = (cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function uniqueCountryCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of codes) {
    const cc = (raw || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc) || seen.has(cc)) continue;
    seen.add(cc);
    out.push(cc);
  }
  return out;
}
