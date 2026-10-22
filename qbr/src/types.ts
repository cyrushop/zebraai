export interface Row {
  bu: string;
  product_line: string;
  sub_product_line: string;
  value: number;
  quota: number | null;
  q_to_quota_pct: number | null;
  same_q_last_year: number;
  prior_q: number;
  qoq_pct: number | null;
  yoy_pct: number | null;
}
export interface Header { A1: string; B1: number; A2: string; B2: number | null; A3: string; B3: number | null }
export interface Deal { deal: string; account: string; partner?: string; amount: number; quarter?: string; stage?: string }
export interface QuarterBlock { header: Header; table: Row[]; total: Row }
