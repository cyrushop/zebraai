"""Build a single-file copy of rfid/index.html for publishing as a claude.ai artifact.

Inlines the local scripts and drops the <!doctype>/<html>/<head>/<body> wrapper, which the
artifact host adds itself. Usage:
    python3 -I tools/build_rfid_artifact.py OUT.html
"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent / 'rfid'
html = (root / 'index.html').read_text(encoding='utf-8')


def inline(m):
    src = m.group(1)
    js = (root / src).read_text(encoding='utf-8').replace('</script', '<\\/script')
    return '<script>\n' + js + '\n</script>'


html = re.sub(r'<script src="([a-z]+\.js)"></script>', inline, html)
# The artifact viewer blocks file downloads; Copy CSV stays.
html = html.replace('<button class="btn small" type="button" id="dlCsv">Download CSV</button>', '')
html = re.sub(r'<!doctype html>\s*', '', html, flags=re.I)
html = re.sub(r'</?(html|head|body)[^>]*>\s*', '', html, flags=re.I)
html = re.sub(r'<meta charset="utf-8">\s*', '', html)
html = re.sub(r'<meta name="viewport"[^>]*>\s*', '', html)
# Title first, within the first 8 KB.
title = re.search(r'<title>.*?</title>\s*', html).group(0)
html = title + html.replace(title, '', 1)
pathlib.Path(sys.argv[1]).write_text(html, encoding='utf-8')
print('wrote', sys.argv[1], len(html), 'bytes')
