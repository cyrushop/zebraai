#!/usr/bin/env python3
"""Embed the PPL checker (ppl/ppl-check.js + ppl-widget.js + ppl-widget.css) into a single-file web app.

    python3 -I tools/embed_ppl.py weekly in.html out.html   # HK Pipeline Weekly Review
    python3 -I tools/embed_ppl.py pos    in.html out.html   # POS Revenue Desk

Inserted blocks sit between <!-- PPL:... --> markers, so running it again on an
already patched page replaces the old copy instead of adding a second one.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'ppl'

HOSTS = {
    'weekly': {
        'key': 'hkpr.ppl',
        'sub': '在上方上載 SFDC pipeline 會自動檢查；也可以在這裡單獨上載。',
        'mount_after': '<main><div class="wrap" id="out"></div></main>',
        'mount_html': '<div class="wrap" style="padding-bottom:60px"><section id="ppl" style="scroll-margin-top:70px"></section></div>',
        # (anchor, replacement) pairs applied once each
        'patches': [
            # nav link to the checker
            ("}</a>`).join('');\n\n  // draw charts",
             "}</a>`).join('') + '<a href=\"#ppl\"><b>✓</b>PPL 合規</a>';\n\n  // draw charts"),
            # feed every pipeline upload to the checker
            # (before the host parses it, so a file the review cannot read is still checked)
            ("    if (kind === 'pipe') {\n      const rows = firstParse(sheets, ENG.parsePipeline);\n",
             "    if (kind === 'pipe') {\n"
             "      if (window.PPL_W) window.PPL_W.loadAny(sheets.map(s => s.rows), file.name);\n"
             "      const rows = firstParse(sheets, ENG.parsePipeline);\n"),
        ],
    },
    'pos': {
        'key': 'posdesk.ppl',
        'sub': '上載最新的 SFDC Pipeline 報表（.xls / .xlsx / .csv），自動找出不符合 7 條標準的機會。',
        'mount_before': '  <div id="copyBox" hidden>',
        'mount_html': '  <section id="ppl"></section>\n\n',
        'patches': [],
    },
}


def strip_old(html):
    html = re.sub(r'<!-- PPL:(\w+) -->.*?<!-- /PPL:\1 -->\n?', '', html, flags=re.S)
    # undo earlier one-line patches
    for host in HOSTS.values():
        for old, new in host['patches']:
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

    tail = ('<!-- PPL:code -->\n<style>\n' + css + '</style>\n<script>\n' + js + '\n'
            "window.PPL_W = PPLWidget.mount(document.getElementById('ppl'), { storageKey: '" + h['key'] +
            "', sub: '" + h['sub'] + "' });\n</script>\n<!-- /PPL:code -->\n")
    i = html.rfind('</body>')
    assert i > 0
    html = html[:i] + tail + html[i:]
    pathlib.Path(dst).write_text(html, encoding='utf-8')
    print(kind, '->', dst, len(html), 'bytes')


if __name__ == '__main__':
    main(*sys.argv[1:4])
