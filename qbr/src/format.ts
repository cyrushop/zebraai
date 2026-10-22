// Spec §2: thousands separators, no decimals for revenue, one decimal for %, null → "—".
export const DASH = '—';
export const money = (v: number | null | undefined) =>
  v == null ? DASH : Math.round(v).toLocaleString('en-US');
export const pct = (v: number | null | undefined, signed = false) =>
  v == null ? DASH : `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%`;
export const compact = (v: number) => `${(v / 1000).toFixed(1)}K`;

// Colour class: quota % against 100, growth against 0. Null stays muted.
export const tone = (v: number | null | undefined, target: number) =>
  v == null ? 'muted' : v >= target ? 'pos' : 'neg';

/** "FY26 Q4" → labels for this quarter, same quarter last year and prior quarter. */
export function quarterLabels(a1: string) {
  const m = a1.match(/FY(\d{2})\s*Q([1-4])/);
  if (!m) return { cur: a1, lastYear: 'Same Q LY', prior: 'Prior Q' };
  const fy = +m[1];
  const q = +m[2];
  const pq = q === 1 ? 4 : q - 1;
  const pfy = q === 1 ? fy - 1 : fy;
  return { cur: `Q${q} FY${fy}`, lastYear: `Q${q} FY${fy - 1}`, prior: `Q${pq} FY${pfy}` };
}
