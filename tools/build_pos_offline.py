"""Build a single-file, offline copy of the POS sell-out app (pos/).

Inlines d3, SheetJS and the page's own scripts into one HTML file that opens
from disk with no network. Optionally embeds combined data (the JSON written by
tools/pos_combine.js) so the file opens with the analysis already loaded.

    npm pack d3@7.8.5 xlsx@0.18.5      # then untar both packages
    python3 -I tools/build_pos_offline.py OUT.html \\
        --d3 d3-7.8.5/dist/d3.min.js --xlsx xlsx-0.18.5/dist/xlsx.full.min.js [--data combined.json]

A file built with --data contains customer data: keep it out of this public
repository.
"""
import argparse
import json
import os
import re
import sys

POS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pos')


def inline(js):
    # A literal "</script" inside inlined code would close the tag early.
    return '<script>\n' + js.replace('</script', '<\\/script') + '\n</script>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--d3', required=True, help='d3 7.8.5 d3.min.js')
    ap.add_argument('--xlsx', required=True, help='SheetJS 0.18.5 xlsx.full.min.js')
    ap.add_argument('--data', help='combined JSON {lines, used} to embed')
    a = ap.parse_args()

    html = open(os.path.join(POS, 'index.html'), encoding='utf-8').read()
    libs = {'xlsx': a.xlsx, 'd3': a.d3}

    def repl(m):
        src = m.group(1)
        if src.startswith('https://'):
            name = 'xlsx' if '/xlsx/' in src else 'd3' if '/d3/' in src else None
            if not name:
                sys.exit('Unknown external script: ' + src)
            return inline(open(libs[name], encoding='utf-8').read())
        return inline(open(os.path.join(POS, src), encoding='utf-8').read())

    html, n = re.subn(r'<script src="([^"]+)"></script>', repl, html)
    if n != 5:
        sys.exit('Expected 5 script tags in pos/index.html, found %d' % n)
    if a.data:
        data = json.load(open(a.data, encoding='utf-8'))
        preset = {'lines': data['lines'], 'used': data['used']}
        tag = inline('window.ZPOS_PRESET = ' + json.dumps(preset, ensure_ascii=False, separators=(',', ':')) + ';')
        # The preset must exist before app.js runs: put it before the first inlined script.
        html = html.replace('<script>', tag + '\n<script>', 1)
    html = html.replace('<title>Zebra HK Sell-out</title>', '<title>Zebra HK Sell-out (offline)</title>')
    if re.search(r'<script[^>]*\ssrc=', html):
        sys.exit('A script is still loaded from a file or URL')
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('Wrote %s (%.1f MB)%s' % (a.out, os.path.getsize(a.out) / 1e6, ' with embedded data' if a.data else ''))


if __name__ == '__main__':
    main()
