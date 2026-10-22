import { Fragment, type ReactNode } from 'react';
import { config } from '../config';
import { narrative } from '../data/narrative';
import type { Deal, Header, QuarterBlock } from '../types';
import { DASH, compact, money, pct, quarterLabels, tone } from '../format';

// ---------- Narrative helpers ----------

/** Finds an approved narrative section by a fragment of its heading. */
export function section(match: string) {
  const s = narrative.find((n) => n.heading.toLowerCase().includes(match.toLowerCase()));
  if (!s) throw new Error(`Narrative section "${match}" not found in data file`);
  return s;
}

// Inline-code references to JSON keys read as plain English on a slide.
const codeLabels: Record<string, string> = { wcs_pipeline: 'the WCS pipeline' };

/** Renders **bold** and `code` from the approved markdown wording. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : p.startsWith('`') ? (
          <Fragment key={i}>{codeLabels[p.slice(1, -1)] ?? p.slice(1, -1)}</Fragment>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** "**Label:** a; b; c" → { title: "Label", items: [a, b, c] } */
export function labelled(bullet: string) {
  const m = bullet.match(/^\*\*(.+?):?\*\*:?\s*(.*)$/);
  if (!m) return { title: '', items: [bullet] };
  return { title: m[1].replace(/:$/, ''), items: m[2].split(/;\s+/) };
}

// ---------- Layout ----------

export function Slide({ title, kicker, children, className = '' }: { title: string; kicker?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`slide ${className}`}>
      <header className="slide-head">
        {kicker && <div className="kicker">{kicker}</div>}
        <h1 className="slide-title">{title}</h1>
      </header>
      <div className="slide-body">{children}</div>
    </div>
  );
}

export function Footer({ page }: { page: number }) {
  return (
    <footer className="slide-foot">
      <span>{config.footer}</span>
      <span>{page}</span>
    </footer>
  );
}

// ---------- KPI header (A1:B3) ----------

export function KpiRow({ header, unit }: { header: Header; unit: string }) {
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="kpi-label">{header.A1}</div>
        <div className="kpi-value">{money(header.B1)} <span className="unit">{unit}</span></div>
      </div>
      <div className="kpi">
        <div className="kpi-label">{header.A2}</div>
        <div className={`kpi-value ${header.B2 == null ? 'muted' : ''}`}>
          {header.B2 == null ? DASH : <>{money(header.B2)} <span className="unit">{unit}</span></>}
        </div>
      </div>
      <div className="kpi">
        <div className="kpi-label">{header.A3}</div>
        {/* Spec §7: red below 100% and red "—" when no quota is set. */}
        <div className={`kpi-value ${header.B3 != null && header.B3 >= 100 ? 'pos' : 'neg'}`}>{pct(header.B3)}</div>
      </div>
    </div>
  );
}

// ---------- Standard quarterly table (spec §7) ----------

export function QuarterTable({ block }: { block: QuarterBlock }) {
  const l = quarterLabels(block.header.A1);
  const widths = [80, 220, 230, 150, 140, 190, 150, 150, 170, 184];
  const heads = ['BU', 'Product Line', 'Sub Product Line', l.cur, 'Quota', 'Q to Quota %', l.lastYear, l.prior, 'Q/Q Growth', 'Y/Y Growth'];
  const cells = (r: QuarterBlock['total'], showPl: boolean) => [
    <td key="bu">{r.bu}</td>,
    <td key="pl">{showPl ? r.product_line : ''}</td>,
    <td key="spl">{r.sub_product_line}</td>,
    <td key="v" className="num">{money(r.value)}</td>,
    <td key="q" className={`num ${r.quota == null ? 'muted' : ''}`}>{money(r.quota)}</td>,
    <td key="qq" className={`num ${tone(r.q_to_quota_pct, 100)}`}>{pct(r.q_to_quota_pct)}</td>,
    <td key="ly" className="num">{money(r.same_q_last_year)}</td>,
    <td key="pq" className="num">{money(r.prior_q)}</td>,
    <td key="qoq" className={`num ${tone(r.qoq_pct, 0)}`}>{pct(r.qoq_pct)}</td>,
    <td key="yoy" className={`num ${tone(r.yoy_pct, 0)}`}>{pct(r.yoy_pct)}</td>,
  ];
  return (
    <table className="qtable">
      <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
      <thead>
        <tr>{heads.map((h, i) => <th key={i} className={i >= 3 ? 'num' : ''}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {block.table.map((r, i) => (
          <tr key={i} className={i > 0 && block.table[i - 1].product_line !== r.product_line ? 'group-start' : ''}>
            {cells(r, i === 0 || block.table[i - 1].product_line !== r.product_line)}
          </tr>
        ))}
        {/* Ten separate cells, never colspan (spec §7). */}
        <tr className="total">{cells(block.total, true)}</tr>
      </tbody>
    </table>
  );
}

// ---------- Deal panels (spec §8) ----------

export function DealPanel({ title, tone: t, deals, meta }: { title: string; tone: 'pos' | 'neg' | 'accent'; deals: Deal[]; meta?: (d: Deal) => string }) {
  const sum = deals.reduce((a, d) => a + d.amount, 0);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className={`panel-title ${t}`}>{title}</h2>
        <span className="panel-sum">{compact(sum)}</span>
      </div>
      <ol className="deals">
        {deals.map((d, i) => (
          <li key={i} className="deal">
            <span className="rank">{i + 1}</span>
            <span className="deal-main">
              <span className="deal-name">{d.deal}</span>
              <span className="deal-acct">{meta ? meta(d) : d.account}</span>
            </span>
            <span className="deal-amt">{money(d.amount)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- Narrative cards (spec §9) ----------

export function Card({ title, tone: t = 'accent', items, className = '' }: { title: string; tone?: 'pos' | 'neg' | 'accent'; items: string[]; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <h2 className={`card-title ${t}`}>{title}</h2>
      <ul className="bullets">
        {items.map((b, i) => <li key={i}><Rich text={b} /></li>)}
      </ul>
    </section>
  );
}

/** Simple ranked table used on partner / pipeline slides. */
export function ListTable({ head, rows, numCols = [] }: { head: string[]; rows: ReactNode[][]; numCols?: number[] }) {
  return (
    <table className="ltable">
      <thead><tr>{head.map((h, i) => <th key={i} className={numCols.includes(i) ? 'num' : ''}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className={numCols.includes(j) ? 'num' : ''}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
