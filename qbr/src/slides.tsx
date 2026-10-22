import type { ReactNode } from 'react';
import qbr from './data/qbr.json';
import { config } from './config';
import type { Deal, QuarterBlock } from './types';
import { compact, money, pct, quarterLabels } from './format';
import { Card, DealPanel, KpiRow, ListTable, QuarterTable, Slide, labelled, section } from './components/ui';

const unit = qbr.meta.currency;
const q3 = qbr.q3 as QuarterBlock & typeof qbr.q3;
const q4 = qbr.q4 as QuarterBlock & typeof qbr.q4;
const q1 = qbr.q1_fy27 as QuarterBlock & typeof qbr.q1_fy27;

const reportMonth = new Date(`${qbr.meta.pos_report}T00:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' });
const modelNote =
  'Product-line split is a model — run-rate lines (Card Printers, Supplies, Aftermarket, RFID DCS) at the FY26 Q1–Q3 quarterly average; project lines split by Closed-Won + Secure + real Validate pipeline, scaled so the total equals the forecast.';

export interface SlideDef { id: string; title: string; notes?: string; cover?: boolean; render: () => ReactNode }

// ---------- Small visual pieces used by single slides ----------

function Bars({ rows, max }: { rows: { label: string; segs: { v: number; cls: string; tag?: string }[]; value: string; sub?: string }[]; max: number }) {
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div className="bar-row" key={i}>
          <div className="bar-label">{r.label}{r.sub && <span className="bar-sub">{r.sub}</span>}</div>
          <div className="bar-track">
            {r.segs.map((s, j) => (
              <div key={j} className={`bar-seg ${s.cls}`} style={{ width: `${(s.v / max) * 100}%` }}>
                {s.tag && <span>{s.tag}</span>}
              </div>
            ))}
          </div>
          <div className="bar-value">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, tone = '', sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const commitCards = (match: string) =>
  section(match).bullets.map((b) => labelled(b)).map((c, i) => <Card key={i} title={c.title} items={c.items} />);

const withQuarter = (d: Deal) => `${d.account} · ${d.quarter}`;

// "FY27 Q1 — <Customer> base effect" (data file) → "FY27 Q1 — The <Customer> Base Effect"
const baseEffect = section('base effect');
const baseEffectTopic = baseEffect.heading.replace(/^.*—\s*/, '');
const baseEffectTitle = `FY27 Q1 — The ${baseEffectTopic.replace(/\b[a-z]/g, (c) => c.toUpperCase())}`;
const rolloutTag = `${baseEffectTopic.split(' ')[0]} rollout`;

// ---------- Slide list (spec §5) ----------

export const slides: SlideDef[] = [
  {
    id: 'cover',
    title: 'Cover',
    cover: true,
    render: () => (
      <div className="slide cover">
        <img className="logo" src={config.logo} alt="Zebra Technologies" onError={(e) => e.currentTarget.classList.add('missing')} />
        <div className="logo-fallback">ZEBRA</div>
        <div className="cover-body">
          <div className="kicker">Zebra Technologies · Hong Kong</div>
          <h1 className="cover-title">{config.edition}</h1>
          <div className="cover-sub">{config.subtitle}</div>
          <div className="cover-meta">
            <div><strong>{config.presenter}</strong> · {config.presenterRole}</div>
            <div>{reportMonth}</div>
          </div>
        </div>
        <div className="cover-source">
          POS report {qbr.meta.pos_report} (Week {qbr.meta.pos_latest_week}) · SFDC export {qbr.meta.sfdc_export} · {qbr.meta.metric} · Service revenue excluded
        </div>
      </div>
    ),
  },
  {
    id: 'agenda',
    title: 'Agenda',
    render: () => (
      <Slide title="Agenda">
        <ol className="agenda">
          {[
            ['Q3 FY26 Performance', 'what worked and what needs work'],
            ['Q4 FY26 Forecast', 'by product line, and how we secure the commit'],
            ['FY27 Q1 Forecast', 'by product line, and how we secure the commit'],
            ['EMC', 'recovering lost deals'],
            ['RFID', 'building big deals'],
            ['MV', 'expansion'],
            ['ISV / SI', 'solution partner expansion'],
            ['Out-of-MPL Partners', 'new partner expansion'],
            ['Software', 'WorkCloud Sync, Nucleus, ZebraDesigner Pro'],
          ].map(([h, d], i) => (
            <li key={i}>
              <span className="agenda-n">{String(i + 1).padStart(2, '0')}</span>
              <span className="agenda-h">{h}</span>
              <span className="agenda-d">— {d}</span>
            </li>
          ))}
        </ol>
      </Slide>
    ),
  },
  {
    id: 'q3-performance',
    title: 'Q3 FY26 Performance',
    render: () => (
      <Slide title="Q3 FY26 Performance">
        <KpiRow header={q3.header} unit={unit} />
        <QuarterTable block={q3} />
      </Slide>
    ),
  },
  {
    id: 'q3-review',
    title: 'Q3 FY26 — What worked, what needs work',
    render: () => {
      const a = qbr.fy26_actuals;
      const qs = (['Q1', 'Q2', 'Q3'] as const).map((q, i) => ({ q, v: a[q], quota: a.quota[i] }));
      return (
        <Slide title="Q3 FY26 — What worked, what needs work">
          <div className="stats">
            {qs.map((x) => {
              const att = (x.v / x.quota) * 100;
              return <Stat key={x.q} label={`FY26 ${x.q}`} value={money(x.v)} tone="" sub={`${pct(att)} of ${money(x.quota)} quota`} />;
            })}
            <Stat label="Q3 Y/Y" value={pct(q3.total.yoy_pct, true)} tone={q3.total.yoy_pct! >= 0 ? 'pos' : 'neg'} sub={`vs ${money(q3.total.same_q_last_year)} in ${quarterLabels(q3.header.A1).lastYear}`} />
          </div>
          <div className="cols-2">
            <Card title="What worked" tone="pos" items={section('What worked').bullets} />
            <Card title="Needs work" tone="neg" items={section('Needs work').bullets} />
          </div>
        </Slide>
      );
    },
  },
  {
    id: 'q3-deals',
    title: 'Q3 FY26 — Top Won and Top Losses',
    render: () => (
      <Slide title="Q3 FY26 — Top Won and Top Losses">
        <div className="cols-2">
          <DealPanel title="Top 5 Won" tone="pos" deals={q3.top5_won} />
          <DealPanel title="Top 3 Losses" tone="neg" deals={q3.top3_lost} />
        </div>
      </Slide>
    ),
  },
  {
    id: 'q4-forecast',
    title: 'Q4 FY26 Forecast',
    notes: modelNote,
    render: () => (
      <Slide title="Q4 FY26 Forecast">
        <KpiRow header={q4.header} unit={unit} />
        <QuarterTable block={q4} />
        <p className="footnote">Note: {section('Footnote').text}</p>
      </Slide>
    ),
  },
  {
    id: 'q4-deals',
    title: 'Q4 FY26 — Top Pipeline',
    render: () => (
      <Slide title="Q4 FY26 — Top Pipeline">
        <div className="cols-2">
          <DealPanel title="Top 5 Secure" tone="accent" deals={q4.top5_secure} />
          <DealPanel title="Top 5 Validate" tone="accent" deals={q4.top5_validate} />
        </div>
      </Slide>
    ),
  },
  {
    id: 'q4-commit',
    title: 'Q4 FY26 — How We Secure the Commit',
    render: () => {
      const t = qbr.q4_tracking;
      const fc = q4.header.B1;
      const done = (t.qtd_pos / fc) * 100;
      const time = (t.weeks_elapsed / t.weeks_in_quarter) * 100;
      return (
        <Slide title="Q4 FY26 — How We Secure the Commit">
          <div className="tracker">
            <div className="tracker-stats">
              <Stat label={`Q4 to date (Week ${qbr.meta.pos_latest_week})`} value={money(t.qtd_pos)} tone={t.qtd_pos >= t.pace_per_week * t.weeks_elapsed ? 'pos' : 'neg'} sub={`vs pace of ${money(t.pace_per_week)} per week`} />
              <Stat label="Remaining to forecast" value={money(t.remaining_to_forecast)} sub={`to reach ${money(fc)}`} />
              <Stat label="Required per remaining week" value={money(t.required_per_remaining_week)} sub={`${t.weeks_in_quarter - t.weeks_elapsed} of ${t.weeks_in_quarter} weeks left`} />
            </div>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${done}%` }} />
              <div className="progress-mark" style={{ left: `${time}%` }} />
            </div>
            <div className="progress-legend">
              <span><i className="sw fill" /> POS to date: {pct(done)} of forecast</span>
              <span><i className="sw mark" /> Quarter elapsed: {pct(time)}</span>
            </div>
          </div>
          <div className="cols-3">{commitCards('Q4 FY26 — How we secure')}</div>
        </Slide>
      );
    },
  },
  {
    id: 'q1-forecast',
    title: 'FY27 Q1 Forecast',
    notes: modelNote,
    render: () => (
      <Slide title="FY27 Q1 Forecast">
        <KpiRow header={q1.header} unit={unit} />
        <QuarterTable block={q1} />
      </Slide>
    ),
  },
  {
    id: 'q1-dhl',
    title: baseEffectTitle,
    render: () => {
      const d = qbr.dhl_base_effect;
      return (
        <Slide title={baseEffectTitle}>
          <div className="cols-2 wide-left">
            <section className="panel">
              <h2 className="panel-title accent">Q1 comparison ({unit})</h2>
              <Bars
                max={d.q1_fy26_actual}
                rows={[
                  { label: 'Q1 FY26 reported', segs: [{ v: d.q1_fy26_excl_rollout, cls: 'base' }, { v: d.dhl_one_time_rollout, cls: 'oneoff', tag: rolloutTag }], value: money(d.q1_fy26_actual) },
                  { label: 'Q1 FY26 underlying', sub: `excl. ${rolloutTag}`, segs: [{ v: d.q1_fy26_excl_rollout, cls: 'base' }], value: money(d.q1_fy26_excl_rollout) },
                  { label: 'FY27 Q1 forecast', segs: [{ v: d.q1_fy27_forecast, cls: 'fc' }], value: money(d.q1_fy27_forecast) },
                ]}
              />
              <div className="stats two">
                <Stat label="vs underlying Q1 FY26" value={pct(d.growth_vs_underlying_pct, true)} tone="pos" />
                <Stat label="Reported Y/Y" value={pct(q1.total.yoy_pct, true)} tone={q1.total.yoy_pct! >= 0 ? 'pos' : 'neg'} />
              </div>
            </section>
            <Card title="Why reported Y/Y reads negative" items={baseEffect.bullets} />
          </div>
        </Slide>
      );
    },
  },
  {
    id: 'q1-deals',
    title: 'FY27 Q1 — Top Pipeline',
    render: () => (
      <Slide title="FY27 Q1 — Top Pipeline">
        <div className="cols-2">
          <DealPanel title="Top 5 Secure" tone="accent" deals={q1.top5_secure} />
          <DealPanel title="Top 5 Validate" tone="accent" deals={q1.top5_validate} />
        </div>
      </Slide>
    ),
  },
  {
    id: 'q1-commit',
    title: 'FY27 Q1 — How We Secure the Commit',
    render: () => (
      <Slide title="FY27 Q1 — How We Secure the Commit">
        <div className="cols-3 tall">{commitCards('FY27 Q1 — How we secure')}</div>
      </Slide>
    ),
  },
  {
    id: 'emc',
    title: 'EMC — Recovering Lost Deals',
    render: () => {
      const e = qbr.emc;
      const lost = Object.entries(e.mc_lost_by_quarter);
      const max = Math.max(...lost.map(([, v]) => v));
      return (
        <Slide title="EMC — Recovering Lost Deals">
          <div className="cols-2">
            <div className="stack">
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title neg">Mobile Computing lost in SFDC</h2>
                  <span className="panel-sum">YTD {money(e.ytd_lost)}</span>
                </div>
                <Bars max={max} rows={lost.map(([q, v]) => ({ label: `FY26 ${q}`, segs: [{ v, cls: 'lost' }], value: money(v) }))} />
              </section>
              <DealPanel title="Top Q3 Mobile Computing losses" tone="neg" deals={e.top_q3_mc_losses} />
            </div>
            <Card title="Recovery plan" items={section('EMC').bullets} />
          </div>
        </Slide>
      );
    },
  },
  {
    id: 'rfid',
    title: 'RFID — Building Big Deals',
    render: () => (
      <Slide title="RFID — Building Big Deals">
        <div className="cols-2">
          <DealPanel title="Top RFID pursuits" tone="accent" deals={qbr.rfid_pursuits} meta={withQuarter} />
          <Card title="Big-deal playbook" items={section('RFID').bullets} />
        </div>
      </Slide>
    ),
  },
  {
    id: 'mv',
    title: 'MV Expansion',
    render: () => (
      <Slide title="MV Expansion">
        <div className="placeholder">
          <div className="placeholder-title">Content to be supplied</div>
          <div className="placeholder-sub">No MV pipeline in SFDC yet.</div>
        </div>
      </Slide>
    ),
  },
  {
    id: 'isv-si',
    title: 'ISV / SI Expansion',
    render: () => (
      <Slide title="ISV / SI Expansion">
        <div className="cols-2 wide-left">
          <section className="panel">
            <h2 className="panel-title accent">Solution partners — Q4 + Q1 pipeline ({unit})</h2>
            <ListTable
              head={['Partner', 'Role', 'Pipeline']}
              numCols={[2]}
              rows={qbr.isv_si_partners.map((p) => [<strong>{p.partner}</strong>, <span className="muted">{p.role}</span>, money(p.pipeline_q4_q1)])}
            />
          </section>
          <Card title="Plan" items={section('ISV / SI').bullets} />
        </div>
      </Slide>
    ),
  },
  {
    id: 'oompl',
    title: 'Out-of-MPL Partner Expansion',
    render: () => (
      <Slide title="Out-of-MPL Partner Expansion">
        <div className="cols-2 wide-left">
          <section className="panel">
            <h2 className="panel-title accent">Out-of-MPL partners ({unit})</h2>
            <ListTable
              head={['Partner', 'Basis', 'Amount']}
              numCols={[2]}
              rows={qbr.oompl_partners.map((p) => [<strong>{p.partner}</strong>, <span className="muted">{p.note}</span>, money(p.amount)])}
            />
          </section>
          <Card title="Plan" items={section('Out-of-MPL').bullets} />
        </div>
      </Slide>
    ),
  },
  {
    id: 'software',
    title: 'Software — WCS, Nucleus, ZebraDesigner Pro',
    render: () => {
      const w = qbr.wcs_pipeline;
      return (
        <Slide title="Software — WCS, Nucleus, ZebraDesigner Pro">
          <div className="cols-2 wide-left">
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title accent">WorkCloud Sync pipeline ({unit})</h2>
                <span className="panel-sum">{compact(w.reduce((a, d) => a + d.amount, 0))}</span>
              </div>
              <ListTable
                head={['Opportunity', 'Partner', 'Quarter', 'Amount']}
                numCols={[3]}
                rows={w.map((d) => [<strong>{d.deal}</strong>, <span className="muted">{d.partner}</span>, <span className="nowrap">{d.quarter}</span>, money(d.amount)])}
              />
            </section>
            <Card title="Plan" items={section('Software').bullets} />
          </div>
        </Slide>
      );
    },
  },
];

