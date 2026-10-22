/* Small d3 chart helpers for the POS page: columns, 100% stacks, ranked
 * horizontal bars, legends and a sortable table. Colours come from the page's
 * CSS tokens (--axis, --grid, --s1…--s8).
 */
(function () {
  const ZC = {};
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  ZC.usd = (v) => (v < 0 ? '-' : '') + '$' + compact.format(Math.abs(v));
  ZC.usdFull = (v) => (v < 0 ? '-$' : '$') + d3.format(',.0f')(Math.abs(v));
  ZC.pct = (v) => (v == null || !isFinite(v) ? 'n/a' : (v > 0 ? '+' : '') + d3.format('.1%')(v));
  ZC.share = d3.format('.1%');
  ZC.num = d3.format(',.0f');

  function tip(box) {
    let t = box.querySelector(':scope > .zc-tip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'zc-tip';
      t.hidden = true;
      box.appendChild(t);
    }
    return {
      show(ev, title, lines) {
        t.replaceChildren();
        const h = document.createElement('div');
        h.className = 'zc-tip-h';
        h.textContent = title;
        t.appendChild(h);
        lines.forEach((l) => {
          const r = document.createElement('div');
          r.className = 'zc-tip-r';
          if (l.color) {
            const s = document.createElement('span');
            s.className = 'zc-sw';
            s.style.background = l.color;
            r.appendChild(s);
          }
          const n = document.createElement('span');
          n.className = 'zc-tip-n';
          n.textContent = l.name;
          r.appendChild(n);
          const v = document.createElement('span');
          v.className = 'zc-tip-v';
          v.textContent = l.value;
          r.appendChild(v);
          t.appendChild(r);
        });
        t.hidden = false;
        const b = box.getBoundingClientRect();
        const tw = t.offsetWidth, th = t.offsetHeight;
        let x = ev.clientX - b.left + 14, y = ev.clientY - b.top + 14;
        if (x + tw > b.width) x = Math.max(0, ev.clientX - b.left - tw - 14);
        if (y + th > b.height) y = Math.max(0, ev.clientY - b.top - th - 14);
        t.style.left = x + 'px';
        t.style.top = y + 'px';
      },
      hide() { t.hidden = true; },
    };
  }

  function measure(svg, texts, cls) {
    const g = svg.append('g');
    let m = 0;
    texts.forEach((s) => {
      const t = g.append('text').attr('class', cls || 'zc-tick').text(s);
      m = Math.max(m, t.node().getComputedTextLength());
    });
    g.remove();
    return m;
  }

  function fresh(el, H) {
    const W = Math.max(280, el.clientWidth || 600);
    d3.select(el).select('svg').remove();
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    return { svg, W };
  }

  ZC.clear = (el) => { d3.select(el).select('svg').remove(); const t = el.querySelector('.zc-tip'); if (t) t.hidden = true; };

  ZC.legend = (el, series) => {
    el.replaceChildren(...series.map((s) => {
      const i = document.createElement('span');
      i.className = 'zc-leg';
      const sw = document.createElement('span');
      sw.className = 'zc-sw';
      sw.style.background = s.color;
      i.appendChild(sw);
      i.appendChild(document.createTextNode(s.name));
      return i;
    }));
  };

  // Vertical columns, optionally grouped by series.
  // o: {groups, series:[{name,color}], value(gi,si), height, labels, groupNote(gi), faded(gi), tipExtra(gi)}
  ZC.columns = (el, o) => {
    const H = o.height || 280;
    const { svg, W } = fresh(el, H);
    const vals = [];
    o.groups.forEach((g, gi) => o.series.forEach((s, si) => vals.push(o.value(gi, si) || 0)));
    const y = d3.scaleLinear([Math.min(0, d3.min(vals)), Math.max(1, d3.max(vals))], [1, 0]).nice(5);
    const fmt = o.fmt || ZC.usd;
    const ticks = y.ticks(5);
    const ml = measure(svg, ticks.map(fmt)) + 10, mr = 6, mt = o.labels ? 20 : 10, mb = o.groupNote ? 40 : 26;
    y.range([H - mb, mt]);
    const x0 = d3.scaleBand(o.groups, [ml, W - mr]).paddingInner(o.series.length > 1 ? 0.22 : 0.3).paddingOuter(0.1);
    const x1 = d3.scaleBand(o.series.map((_, i) => i), [0, x0.bandwidth()]).padding(o.series.length > 1 ? 0.1 : 0);
    const grid = svg.append('g');
    ticks.forEach((t) => {
      grid.append('line').attr('x1', ml).attr('x2', W - mr).attr('y1', y(t)).attr('y2', y(t))
        .attr('stroke', t === 0 ? 'var(--axis)' : 'var(--grid)').attr('stroke-width', 1);
      grid.append('text').attr('class', 'zc-tick').attr('x', ml - 8).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(fmt(t));
    });
    const lw = measure(svg, o.groups) + 8;
    const every = Math.max(1, Math.ceil(lw / x0.step()));
    o.groups.forEach((g, gi) => {
      const cx = x0(g) + x0.bandwidth() / 2;
      if (gi % every === 0) svg.append('text').attr('class', 'zc-tick').attr('x', cx).attr('y', H - mb + 16).attr('text-anchor', 'middle').text(g);
      if (o.groupNote && gi % every === 0) {
        const n = o.groupNote(gi);
        if (n) svg.append('text').attr('class', 'zc-tick zc-note').attr('x', cx).attr('y', H - mb + 31).attr('text-anchor', 'middle').text(n);
      }
    });
    const tp = tip(el);
    const bars = svg.append('g');
    o.groups.forEach((g, gi) => {
      const fade = o.faded && o.faded(gi);
      o.series.forEach((s, si) => {
        const v = o.value(gi, si) || 0;
        const bw = Math.min(x1.bandwidth(), o.series.length > 1 ? 28 : 56);
        const bx = x0(g) + x1(si) + (x1.bandwidth() - bw) / 2;
        bars.append('rect').attr('x', bx).attr('width', bw)
          .attr('y', Math.min(y(v), y(0))).attr('height', Math.max(1, Math.abs(y(v) - y(0))))
          .attr('rx', 3).attr('fill', o.colorOf ? o.colorOf(gi, si) : s.color).attr('fill-opacity', fade ? 0.4 : 1);
        if (o.labels && o.series.length === 1) {
          const label = fmt(v);
          if (measure(svg, [label], 'zc-val') <= x0.step() - 2) {
            bars.append('text').attr('class', 'zc-val').attr('x', bx + bw / 2).attr('y', Math.min(y(v), y(0)) - 6).attr('text-anchor', 'middle').text(label);
          }
        }
      });
      svg.append('rect').attr('class', 'zc-hit').attr('x', x0(g) - (x0.step() - x0.bandwidth()) / 2).attr('width', x0.step())
        .attr('y', mt).attr('height', H - mb - mt).attr('fill', 'transparent')
        .on('mousemove', (ev) => tp.show(ev, o.tipTitle ? o.tipTitle(gi) : g,
          o.series.map((s, si) => ({ color: o.series.length > 1 ? s.color : null, name: s.name, value: (o.tipFmt || ZC.usdFull)(o.value(gi, si) || 0) }))
            .concat(o.tipExtra ? o.tipExtra(gi) : [])))
        .on('mouseleave', () => tp.hide());
    });
  };

  // Horizontal 100% stacked bars, one row per group.
  // o: {groups, series:[{name,color}], value(gi,si)}
  ZC.stack = (el, o) => {
    const rowH = 30, gap = 12, mt = 4, mb = 4;
    const H = mt + mb + o.groups.length * (rowH + gap) - gap;
    const { svg, W } = fresh(el, H);
    const ml = measure(svg, o.groups) + 12, mr = 4;
    const x = d3.scaleLinear([0, 1], [ml, W - mr]);
    const tp = tip(el);
    o.groups.forEach((g, gi) => {
      const yy = mt + gi * (rowH + gap);
      svg.append('text').attr('class', 'zc-tick').attr('x', ml - 10).attr('y', yy + rowH / 2).attr('dy', '0.32em').attr('text-anchor', 'end').text(g);
      const vals = o.series.map((s, si) => Math.max(0, o.value(gi, si) || 0));
      const tot = d3.sum(vals) || 1;
      let acc = 0;
      o.series.forEach((s, si) => {
        const sh = vals[si] / tot;
        if (sh <= 0) return;
        const x0 = x(acc), w = x(acc + sh) - x(acc);
        acc += sh;
        svg.append('rect').attr('x', x0).attr('y', yy).attr('width', Math.max(0, w - 1.5)).attr('height', rowH).attr('fill', s.color)
          .on('mousemove', (ev) => tp.show(ev, g + ' · ' + s.name, [{ name: 'Sales', value: ZC.usdFull(vals[si]) }, { name: 'Share', value: ZC.share(sh) }]))
          .on('mouseleave', () => tp.hide());
        const lab = d3.format('.0%')(sh);
        if (measure(svg, [lab], 'zc-in') + 8 < w) {
          svg.append('text').attr('class', 'zc-in').attr('x', x0 + w / 2).attr('y', yy + rowH / 2).attr('dy', '0.32em').attr('text-anchor', 'middle').attr('pointer-events', 'none').text(lab);
        }
      });
    });
  };

  // Horizontal grouped bars for ranked items.
  // o: {items:[name], series:[{name,color}], value(ii,si)}
  ZC.hbars = (el, o) => {
    const bh = 8, inner = 2, gap = 14, mt = 4, mb = 24;
    const rowH = o.series.length * (bh + inner) - inner;
    const H = mt + mb + o.items.length * (rowH + gap) - gap;
    const { svg, W } = fresh(el, H);
    const short = (s) => (s.length > 26 ? s.slice(0, 25) + '…' : s);
    const ml = Math.min(W * 0.45, measure(svg, o.items.map(short)) + 12), mr = 12;
    const vals = [];
    o.items.forEach((_, ii) => o.series.forEach((s, si) => vals.push(o.value(ii, si) || 0)));
    const x = d3.scaleLinear([Math.min(0, d3.min(vals)), Math.max(1, d3.max(vals))], [ml, W - mr]).nice(4);
    const ticks = x.ticks(Math.max(2, Math.floor((W - ml) / 90)));
    ticks.forEach((t) => {
      svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', mt).attr('y2', H - mb)
        .attr('stroke', t === 0 ? 'var(--axis)' : 'var(--grid)').attr('stroke-width', 1);
      svg.append('text').attr('class', 'zc-tick').attr('x', x(t)).attr('y', H - mb + 16).attr('text-anchor', 'middle').text(ZC.usd(t));
    });
    const tp = tip(el);
    o.items.forEach((name, ii) => {
      const yy = mt + ii * (rowH + gap);
      svg.append('text').attr('class', 'zc-tick zc-name').attr('x', ml - 10).attr('y', yy + rowH / 2).attr('dy', '0.32em').attr('text-anchor', 'end').text(short(name));
      o.series.forEach((s, si) => {
        const v = o.value(ii, si) || 0;
        svg.append('rect').attr('x', Math.min(x(0), x(v))).attr('y', yy + si * (bh + inner)).attr('width', Math.max(v ? 1 : 0, Math.abs(x(v) - x(0))))
          .attr('height', bh).attr('rx', 2).attr('fill', s.color);
      });
      svg.append('rect').attr('x', 0).attr('y', yy - gap / 2).attr('width', W).attr('height', rowH + gap).attr('fill', 'transparent')
        .on('mousemove', (ev) => tp.show(ev, name, o.series.map((s, si) => ({ color: s.color, name: s.name, value: ZC.usdFull(o.value(ii, si) || 0) }))))
        .on('mouseleave', () => tp.hide());
    });
  };

  // Sortable table body. cols: [{key, fmt, num}]
  ZC.table = (table, rows, cols, keyOf) => {
    const st = table._sort || (table._sort = { key: cols[cols.length - 2].key, dir: -1 });
    if (!table._bound) {
      table._bound = true;
      table.querySelectorAll('th').forEach((th) => {
        const b = th.querySelector('button');
        if (!b) return;
        b.addEventListener('click', () => {
          const k = th.dataset.field;
          st.dir = st.key === k ? -st.dir : (th.dataset.num ? -1 : 1);
          st.key = k;
          ZC.table(table, table._rows, table._cols, table._keyOf);
        });
      });
    }
    table._rows = rows; table._cols = cols; table._keyOf = keyOf;
    const col = cols.find((c) => c.key === st.key) || cols[0];
    const sorted = rows.slice().sort((a, b) => {
      const va = a[st.key], vb = b[st.key];
      return (col.num ? (va - vb) : String(va).localeCompare(String(vb))) * st.dir;
    });
    table.querySelectorAll('th').forEach((th) => {
      th.setAttribute('aria-sort', th.dataset.field === st.key ? (st.dir > 0 ? 'ascending' : 'descending') : 'none');
    });
    const tb = table.tBodies[0];
    tb.replaceChildren(...sorted.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = keyOf(r);
      cols.forEach((c) => {
        const td = document.createElement('td');
        if (c.num) td.className = 'zc-numc';
        if (c.cls) td.classList.add(c.cls);
        const v = r[c.key];
        td.textContent = c.fmt ? c.fmt(v) : v;
        if (c.signed && v) td.classList.add(v > 0 ? 'zc-up' : 'zc-down');
        tr.appendChild(td);
      });
      return tr;
    }));
  };

  window.ZC = ZC;
})();
