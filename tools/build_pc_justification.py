#!/usr/bin/env python3
"""Build a single-file PC Justification page to download and open offline.

Inlines app/pc-justification.js into app/pc-justification.html and drops the
link to the pipeline page, which is not part of the download.

Usage: python3 -I tools/build_pc_justification.py OUT.html
"""
import pathlib
import sys

APP = pathlib.Path(__file__).resolve().parent.parent / 'app'
LINK = '    <a class="btn" href="index.html">Pipeline Order Check</a>\n'
SCRIPT = '<script src="pc-justification.js"></script>'


def build():
    html = (APP / 'pc-justification.html').read_text(encoding='utf-8')
    js = (APP / 'pc-justification.js').read_text(encoding='utf-8')
    for part in (LINK, SCRIPT):
        if html.count(part) != 1:
            raise SystemExit('pc-justification.html changed: cannot find ' + part.strip())
    return html.replace(LINK, '').replace(SCRIPT, '<script>\n' + js + '</script>')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    pathlib.Path(sys.argv[1]).write_text(build(), encoding='utf-8')
    print('wrote', sys.argv[1])
