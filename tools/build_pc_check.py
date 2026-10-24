#!/usr/bin/env python3
"""Build a single-file PC Price Check page that runs with no internet access.

Inlines app/pc-engine.js and app/pc-justification.js into app/pc.html, drops
the Google Fonts link (the page falls back to system fonts) and the link to
the order check page, which is not part of the build.

SheetJS is left out by default: the SFDC PC list export is an HTML table and
the browser reads it without it. Pass --xlsx with a local copy of
xlsx.full.min.js to also read real .xlsx files.

The output holds no customer data: the PC list is uploaded in the browser.

Usage: python3 -I tools/build_pc_check.py OUT.html [--xlsx path/to/xlsx.full.min.js]
"""
import pathlib
import sys

APP = pathlib.Path(__file__).resolve().parent.parent / 'app'
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n',
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500'
         '&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n')
LINK = '      <a class="btn" href="index.html" id="orderLink">Order Check</a>\n'
XLSX = '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>\n'
SCRIPTS = ('pc-engine.js', 'pc-justification.js')


def inline(js):
    if '</script' in js.lower():
        raise SystemExit('script contains </script; cannot inline it')
    return '<script>\n' + js + '\n</script>'


def build(xlsx_path=None):
    html = (APP / 'pc.html').read_text(encoding='utf-8')
    tags = [(part, '') for part in FONTS + (LINK,)]
    tags.append((XLSX, inline(pathlib.Path(xlsx_path).read_text(encoding='utf-8')) + '\n' if xlsx_path else ''))
    for name in SCRIPTS:
        tags.append(('<script src="%s"></script>' % name, inline((APP / name).read_text(encoding='utf-8'))))
    for old, new in tags:
        if html.count(old) != 1:
            raise SystemExit('pc.html changed: cannot find ' + old.strip()[:80])
        html = html.replace(old, new)
    return html


if __name__ == '__main__':
    args = sys.argv[1:]
    xlsx = None
    if '--xlsx' in args:
        i = args.index('--xlsx')
        if i + 1 >= len(args):
            raise SystemExit(__doc__)
        xlsx = args[i + 1]
        del args[i:i + 2]
    if len(args) != 1:
        raise SystemExit(__doc__)
    pathlib.Path(args[0]).write_text(build(xlsx), encoding='utf-8')
    print('wrote', args[0])
