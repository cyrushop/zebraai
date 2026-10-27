#!/usr/bin/env python3
"""Embed the PPL checker (ppl/ppl-check.js + ppl-widget.js + ppl-widget.css) into a single-file web app.

    python3 -I tools/embed_ppl.py weekly in.html out.html   # HK Pipeline Weekly Review
    python3 -I tools/embed_ppl.py pos    in.html out.html   # POS Revenue Desk

Inserted blocks sit between <!-- PPL:... --> markers, so running it again on an
already patched page replaces the old copy instead of adding a second one.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'ppl'

HOSTS = {
    'weekly': {
        'key': 'hkpr.ppl',
        # shares the page's own pipeline upload (slot 1 at the top) instead of having its own
        'options': {'upload': False, 'sub': '檢查上方「1 · SFDC pipeline」載入的同一份報表。',
                    'emptyText': '在上方「1 · SFDC pipeline」上載報表後，這裡會列出有問題的機會。'},
        # mirror whatever pipeline the page shows when it opens; the page exposes it as window.HKPR_PIPE()
        'after_mount': (
            "(function () {\n"
            "  var h = window.HKPR_PIPE && window.HKPR_PIPE();\n"
            "  if (!h || !h.name || PPL_W.fileName() === h.name) return;\n"
            "  if (h.grid) PPL_W.load(h.grid, h.name);\n"
            "  else PPL_W.clear('上方的 ' + h.name + ' 是之前儲存的版本，沒有檢查用的欄。請在上方「1 · SFDC pipeline」重新上載一次。');\n"
            "})();\n"),
        'mount_after': '<main><div class="wrap" id="out"></div></main>',
        'mount_html': '<div class="wrap" style="padding-bottom:60px"><section id="ppl" style="scroll-margin-top:70px"></section></div>',
        # (anchor, replacement) pairs applied once each
        'patches': [
            # nav link to the checker
            ("}</a>`).join('');\n\n  // draw charts",
             "}</a>`).join('') + '<a href=\"#ppl\"><b>✓</b>PPL 合規</a>';\n\n  // draw charts"),
            # feed every pipeline the page accepts to the checker, so both always show the same file
            ("      S.pipe = { name: file.name, rows };\n",
             "      S.pipe = { name: file.name, rows };\n"
             "      if (window.PPL_W && !window.PPL_W.loadAny(sheets.map(s => s.rows), file.name)) window.PPL_W.clear(file.name + ' 沒有 Opportunity Number / Sales Stage 欄，無法做合規檢查。');\n"),
        ],
    },
    'pos': {
        'key': 'posdesk.ppl',
        'options': {'sub': '上載最新的 SFDC Pipeline 報表（.xls / .xlsx / .csv），自動找出不符合 7 條標準的機會。'},
        'after_mount': '',
        'mount_before': '  <div id="copyBox" hidden>',
        'mount_html': '  <section id="ppl"></section>\n\n',
        'patches': [],
    },
}


def strip_old(html):
    html = re.sub(r'<!-- PPL:(\w+) -->.*?<!-- /PPL:\1 -->\n?', '', html, flags=re.S)
    # undo earlier one-line patches
    for host in HOSTS.values():
        for old, new in host['patches'] + host.get('legacy', []):
            html = html.replace(new, old)
    return html


def main(kind, src, dst):
    h = HOSTS[kind]
    html = strip_old(pathlib.Path(src).read_text(encoding='utf-8'))
    css = (ROOT / 'ppl-widget.css').read_text(encoding='utf-8')
    js = (ROOT / 'ppl-check.js').read_text(encoding='utf-8') + '\n' + (ROOT / 'ppl-widget.js').read_text(encoding='utf-8')
    for s in (css, js):
        assert '</script' not in s.lower() and '</style' not in s.lower()

    block = '<!-- PPL:mount -->' + h['mount_html'] + '<!-- /PPL:mount -->\n'
    if 'mount_after' in h:
        a = h['mount_after']
        assert html.count(a) == 1, a
        html = html.replace(a, a + block)
    else:
        a = h['mount_before']
        assert html.count(a) == 1, a
        html = html.replace(a, block + a)

    for old, new in h['patches']:
        assert html.count(old) == 1, old
        html = html.replace(old, new)

    options = dict(h['options'], storageKey=h['key'])
    tail = ('<!-- PPL:code -->\n<style>\n' + css + '</style>\n<script>\n' + js + '\n'
            "window.PPL_W = PPLWidget.mount(document.getElementById('ppl'), Object.assign(" +
            json.dumps(options, ensure_ascii=False) +
            ", { onChange: function () { if (window.HUB_POST) window.HUB_POST(); } }));\n" + h['after_mount'] +
            "</script>\n<!-- /PPL:code -->\n")
    i = html.rfind('</body>')
    assert i > 0
    html = html[:i] + tail + html[i:]
    pathlib.Path(dst).write_text(html, encoding='utf-8')
    print(kind, '->', dst, len(html), 'bytes')


if __name__ == '__main__':
    main(*sys.argv[1:4])
