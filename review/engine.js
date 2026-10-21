// ---- Pipeline engine: pure functions, no DOM ----
const ENG = (() => {
  const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const num = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v ?? '').replace(/[,$\s]/g, '')); return isNaN(n) ? 0 : n; };
  const idnum = v => { const n = num(v); return n ? String(Math.round(n)) : ''; };
  const str = v => String(v ?? '').trim();

  // Find column indexes by header name; first alias that matches wins.
  function pick(header, spec) {
    const h = header.map(norm), out = {}, missing = [];
    for (const [key, aliases, required] of spec) {
      let i = -1;
      for (const a of aliases) { i = h.indexOf(norm(a)); if (i >= 0) break; }
      if (i < 0) for (const a of aliases) { i = h.findIndex(x => x.startsWith(norm(a))); if (i >= 0) break; }
      out[key] = i;
      if (i < 0 && required) missing.push(aliases[0]);
    }
    return { idx: out, missing };
  }

  const PIPE_SPEC = [
    ['q', ['First Ship Fiscal Quarter New', 'First Ship Fiscal Quarter', 'Fiscal Quarter'], true],
    ['opp', ['Opportunity Number'], false],
    ['name', ['Opportunity Name'], true],
    ['stage', ['Sales Stage', 'Stage'], true],
    ['pl', ['Product Line'], true],
    ['psl', ['Product Sub Line'], false],
    ['fam', ['Named Product Family'], false],
    ['prod', ['Product Name'], false],
    ['amt', ['Schedule Amount (converted)', 'Schedule Amount', 'Amount (converted)', 'Amount'], true],
    ['dist', ['Primary Distributor'], false],
    ['partner', ['Primary Channel Partner'], false],
    ['pid', ['Channel Partner Siebel Account Number'], false],
    ['acct', ['Account Name'], true],
    ['sid', ['Siebel Account Number'], false],
    ['commit', ['Commit Category'], false],
    ['vert', ['Application Vertical'], false],
  ];
  const POS_SPEC = [
    ['q', ['Invoice Fiscal Quarter'], true],
    ['wk', ['Invoice Fiscal Week'], true],
    ['euSub', ['POS End User Name - Submitted', 'End User Name - Raw'], true],
    ['nvl', ['NVL End User'], false],
    ['amt', ['POS Extended Cost (Net) (USD @ Planned Rate)'], true],
  ];
  const ACCT_SPEC = [
    ['type', ['Type'], true], ['name', ['Account Name'], true],
    ['id', ['Account ID USD', 'Account ID'], false], ['region', ['Region', 'Team'], false],
    ['rad', ['FY27 RAD', 'FY26 RAD', 'RAD'], false], ['proj', ['FY27 Projection'], false],
  ];

  // Locate the header row (first row that satisfies the required columns) and map rows.
  function table(rows, spec, mapRow) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const { idx, missing } = pick(rows[r] || [], spec);
      if (!missing.length) {
        const out = [];
        for (let i = r + 1; i < rows.length; i++) { const x = rows[i]; if (!x || !x.length) continue; const o = mapRow(x, idx); if (o) out.push(o); }
        return { rows: out, headerRow: r };
      }
    }
    const { missing } = pick(rows[0] || [], spec);
    throw new Error('Missing column(s): ' + missing.join(', '));
  }
  const g = (x, i) => (i >= 0 ? x[i] : '');

  const parsePipeline = rows => table(rows, PIPE_SPEC, (x, i) => {
    const q = str(g(x, i.q)); if (!/^\d{4} Q[1-4]$/.test(q)) return null;
    return { q, opp: str(g(x, i.opp)) || str(g(x, i.name)), name: str(g(x, i.name)), stage: str(g(x, i.stage)),
      pl: str(g(x, i.pl)) || '(blank)', psl: str(g(x, i.psl)), fam: str(g(x, i.fam)), prod: str(g(x, i.prod)),
      amt: num(g(x, i.amt)), dist: str(g(x, i.dist)), partner: str(g(x, i.partner)), pid: idnum(g(x, i.pid)),
      acct: str(g(x, i.acct)) || '(blank)', sid: idnum(g(x, i.sid)), commit: str(g(x, i.commit)), vert: str(g(x, i.vert)) };
  }).rows;

  const parsePOS = rows => table(rows, POS_SPEC, (x, i) => {
    const q = str(g(x, i.q)); if (!q) return null;
    const m = str(g(x, i.wk)).match(/(\d{1,2})\s*$/);
    const nvl = str(g(x, i.nvl));
    return { q, wk: m ? +m[1] : null, eu: (nvl || str(g(x, i.euSub))).toUpperCase(), amt: num(g(x, i.amt)) };
  }).rows;

  const parseAccounts = rows => table(rows, ACCT_SPEC, (x, i) => {
    const type = str(g(x, i.type)).toUpperCase(); if (type !== 'NAL' && type !== 'MPL') return null;
    return { type, name: str(g(x, i.name)), id: idnum(g(x, i.id)), region: str(g(x, i.region)), rad: str(g(x, i.rad)).toUpperCase(), proj: num(g(x, i.proj)) };
  }).rows;

  // ---- quarters ----
  const qParse = q => { const m = /^(\d{4}) Q([1-4])$/.exec(q); return m ? [+m[1], +m[2]] : null; };
  const qAdd = (q, n) => { const [y, k] = qParse(q); const t = y * 4 + (k - 1) + n; return `${Math.floor(t / 4)} Q${(t % 4) + 1}`; };
  const qFromDate = d => `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
  const qCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const firstWeekOf = q => (qParse(q)[1] - 1) * 13 + 1;

  // ---- stages / tags ----
  const STAGES = ['Closed - Won', 'Secure', 'Validate', 'Qualify', 'Identify', 'Closed - Lost', 'Closed - Other'];
  const tagOf = name => { const m = /-([FPR])\s*$/i.exec(name); return m ? m[1].toUpperCase() : 'Real'; };
  const PRIORITY = { 'Closed - Won': { Real: 0, P: 0, R: 0, F: 0 }, Secure: { Real: 1, P: 2, R: 3, F: 4 }, Validate: { Real: 5, P: 6, R: 7, F: 8 } };

  const STOP = new Set(['LIMITED', 'LTD', 'CO', 'COMPANY', 'HK', 'HONG', 'KONG', 'HONGKONG', 'GROUP', 'THE', 'CORPORATION', 'CORP', 'INC', 'PTE', 'ASIA', 'PACIFIC', 'FAR', 'EAST', 'H', 'K', 'OF', 'AND', 'INTERNATIONAL', 'HOLDINGS']);
  function autoKey(acct) {
    const w = acct.toUpperCase().replace(/\(.*?\)/g, ' ').replace(/[^A-Z0-9& ]+/g, ' ').split(/\s+/).filter(x => x && !STOP.has(x));
    return (w.slice(0, 2).join(' ') || acct.toUpperCase()).trim();
  }

  // ---- 1. Week dashboard (mirrors HK_FY26Q4_Weekly_Tracker › Dashboard) ----
  function weekDashboard(pipe, pos, o) {
    const { curQ, target, weeks = 13, keys = {} } = o;
    const firstWk = o.firstWeek || firstWeekOf(curQ);
    const opps = new Map();
    for (const r of pipe) {
      if (r.q !== curQ || !PRIORITY[r.stage]) continue;
      const k = r.opp + '|' + r.stage;
      const x = opps.get(k) || { opp: r.opp, name: r.name, acct: r.acct, partner: r.partner, stage: r.stage, amt: 0 };
      x.amt += r.amt; opps.set(k, x);
    }
    const posQ = pos.filter(p => p.q === curQ);
    const posQtd = posQ.reduce((s, p) => s + p.amt, 0);
    const rows = [...opps.values()].map(x => {
      const tag = tagOf(x.name);
      return { ...x, tag, pri: PRIORITY[x.stage][tag], key: (keys[x.acct] || autoKey(x.acct)).toUpperCase(), keyAuto: !keys[x.acct] };
    });
    rows.sort((a, b) => qCmp(a.key, b.key) || a.pri - b.pri || b.amt - a.amt);
    const keyPos = new Map(), used = new Map();
    for (const r of rows) {
      if (!keyPos.has(r.key)) keyPos.set(r.key, posQ.reduce((s, p) => s + (p.eu.includes(r.key) ? p.amt : 0), 0));
      r.acctPos = keyPos.get(r.key);
      const u = used.get(r.key) || 0;
      r.alloc = Math.max(0, Math.min(r.amt, r.acctPos - u));
      used.set(r.key, u + r.alloc);
      r.open = r.amt - r.alloc;
      r.pct = r.amt ? r.alloc / r.amt : null;
      r.status = r.alloc < Math.max(10, r.amt * 0.02) ? '未出貨' : r.tag === 'F' ? '-F 已轉真' : r.alloc >= r.amt * 0.95 ? '已出貨' : '部分出貨';
    }
    const sum = (f, v) => rows.filter(f).reduce((s, r) => s + r[v], 0);
    const status = ['已出貨', '部分出貨', '未出貨', '-F 已轉真'].map(st => ({ status: st, n: rows.filter(r => r.status === st).length,
      amt: sum(r => r.status === st, 'amt'), alloc: sum(r => r.status === st, 'alloc'), open: sum(r => r.status === st, 'open') }));
    const cw = r => r.stage === 'Closed - Won';
    status.push({ status: 'SFDC Closed-Won', n: rows.filter(cw).length, amt: sum(cw, 'amt'), alloc: sum(cw, 'alloc'), open: sum(cw, 'open') });

    const wkVals = posQ.map(p => p.wk).filter(w => w != null);
    const latestWk = wkVals.length ? Math.max(...wkVals) : 0;
    const elapsed = latestWk ? latestWk - firstWk + 1 : 0;
    const matched = rows.reduce((s, r) => s + r.alloc, 0);
    const remaining = target - posQtd;
    const openSecure = sum(r => r.stage === 'Secure' && r.tag !== 'F', 'open');
    const openSecureF = sum(r => r.stage === 'Secure' && r.tag === 'F', 'open');
    const openValidate = sum(r => r.stage === 'Validate' && r.tag !== 'F', 'open');
    const openValidateF = sum(r => r.stage === 'Validate' && r.tag === 'F', 'open');
    const fConverted = sum(r => r.tag === 'F', 'alloc');
    const realGap = remaining - openSecure;
    const weekly = []; let cum = 0;
    for (let i = 0; i < weeks; i++) {
      const wk = firstWk + i, has = wk <= latestWk && latestWk > 0;
      const v = has ? posQ.filter(p => p.wk === wk).reduce((s, p) => s + p.amt, 0) : null;
      if (has) cum += v;
      const pace = target / weeks * (i + 1);
      weekly.push({ wk, pos: v, cum: has ? cum : null, pace, diff: has ? cum - pace : null });
    }
    const upside = new Map();
    for (const p of posQ) {
      if ([...keyPos.keys()].some(k => p.eu.includes(k))) continue;
      upside.set(p.eu, (upside.get(p.eu) || 0) + p.amt);
    }
    return { curQ, target, firstWk, weeks, latestWk, elapsed, weeksLeft: weeks - elapsed, posQtd, matched, notMatched: posQtd - matched,
      remaining, perWeek: weeks - elapsed > 0 ? remaining / (weeks - elapsed) : null,
      openSecure, openSecureF, openValidate, openValidateF, fConverted, realGap,
      coverage: realGap <= 0 ? 'Covered' : openValidate / realGap,
      projected: posQtd + openSecure, projectedPct: target ? (posQtd + openSecure) / target : null,
      status, rows, weekly, hasPos: posQ.length > 0,
      upside: [...upside.entries()].map(([eu, amt]) => ({ eu, amt })).sort((a, b) => b.amt - a.amt) };
  }

  // ---- generic grouping ----
  function group(rows, keyFn, subFn) {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r); if (k == null) continue;
      let x = m.get(k); if (!x) { x = { key: k, amt: 0, opps: new Set(), sub: new Map() }; m.set(k, x); }
      x.amt += r.amt; x.opps.add(r.opp);
      if (subFn) { const s = subFn(r); x.sub.set(s, (x.sub.get(s) || 0) + r.amt); }
    }
    return [...m.values()].map(x => ({ key: x.key, amt: x.amt, n: x.opps.size, sub: x.sub })).sort((a, b) => b.amt - a.amt);
  }
  const total = rows => rows.reduce((s, r) => s + r.amt, 0);

  const isSoftware = r => /software/i.test(r.pl) || /software/i.test(r.psl);
  const distOf = r => /chinetek/i.test(r.dist) ? 'Chinetek' : /vstecs|\bvst\b/i.test(r.dist) ? 'VST' : r.dist ? 'Other disti' : 'No distributor';

  // Account list match: by Siebel ID first, then by upper-cased name.
  function accountIndex(accts, type) {
    const byId = new Map(), byName = new Map();
    for (const a of accts) if (a.type === type) { if (a.id) byId.set(a.id, a); byName.set(a.name.toUpperCase(), a); }
    return { size: byName.size, list: accts.filter(a => a.type === type),
      find: (id, name) => (id && byId.get(id)) || byName.get(String(name).toUpperCase()) || null };
  }

  return { parsePipeline, parsePOS, parseAccounts, qAdd, qParse, qFromDate, qCmp, firstWeekOf, STAGES, tagOf, autoKey,
    weekDashboard, group, total, isSoftware, distOf, accountIndex };
})();
if (typeof module !== 'undefined') module.exports = ENG;
