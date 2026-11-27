#!/usr/bin/env python3
"""Build an offline copy of the Sales Hub that opens from a folder (double-click index.html).

    python3 make_offline.py HUB_DIR OUT_DIR [--lib LIB_DIR] [--seed SEED_DIR] [--zip]

HUB_DIR  the built hub: index.html, pipeline.html, pos.html, dsr.html, history.html and their data files.
LIB_DIR  chart.umd.js (Chart.js 4.4.1), xlsx.full.min.js (SheetJS 0.18.5), d3.min.js (d3 7.9.0);
         downloaded from the CDN when not given.
SEED_DIR the online hub's database exported as SEED_DIR/<collection>/<doc id>.json (forecast, weekly, targets).

The hub files hold customer data: OUT_DIR must stay outside this public repository.
"""
import argparse, base64, hashlib, json, os, re, shutil, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
LIBS = {
    'chart.umd.js': 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js',
    'xlsx.full.min.js': 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'd3.min.js': 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
}
# review M15: the same sha384 the pages carry as SRI; a library that does not match is refused
LIB_SHA384 = {
    'chart.umd.js': 'dug+JxfBvklEQdJ4AYuBBAIScUz0bVN73xpy273gcAwHjb3qI0fXmuYNaNfdyYJG',
    'xlsx.full.min.js': 'vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
    'd3.min.js': 'CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i',
}
PAGES = ['index.html', 'pipeline.html', 'pos.html', 'dsr.html', 'history.html']
DATA = ['engine.js', 'initial-data.js', 'tw-ppl.json']
# every CDN reference in the pages, mapped to the local copy
CDN = [
    (r'https://cdn\.jsdelivr\.net/npm/chart\.js@4\.4\.1/dist/chart\.umd\.js', 'lib/chart.umd.js'),
    (r'https://cdn\.jsdelivr\.net/npm/xlsx@0\.18\.5/dist/xlsx\.full\.min\.js', 'lib/xlsx.full.min.js'),
    (r'https://cdnjs\.cloudflare\.com/ajax/libs/xlsx/0\.18\.5/xlsx\.full\.min\.js', 'lib/xlsx.full.min.js'),
    (r'https://cdnjs\.cloudflare\.com/ajax/libs/d3/7\.9\.0/d3\.min\.js', 'lib/d3.min.js'),
    (r'https://cdn\.jsdelivr\.net/npm/d3@7\.9\.0/dist/d3\.min\.js', 'lib/d3.min.js'),
]
# SRI + crossorigin make a file:// page refuse its own local copy: drop them on the localized tags
LOCAL_SRI = re.compile(r'(<script src="lib/[^"]+")\s+integrity="[^"]*"\s+crossorigin="[^"]*"')
FONTS = re.compile(r'<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*', re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('hub'); ap.add_argument('out')
    ap.add_argument('--lib'); ap.add_argument('--seed'); ap.add_argument('--zip', action='store_true')
    a = ap.parse_args()
    hub, out = os.path.abspath(a.hub), os.path.abspath(a.out)
    if (out + os.sep).startswith(REPO + os.sep):
        sys.exit('OUT_DIR must be outside the repo (customer data)')
    shutil.rmtree(out, ignore_errors=True); os.makedirs(os.path.join(out, 'lib'))

    for name, url in LIBS.items():
        dst = os.path.join(out, 'lib', name)
        if a.lib and os.path.isfile(os.path.join(a.lib, name)):
            shutil.copy(os.path.join(a.lib, name), dst)
        else:
            urllib.request.urlretrieve(url, dst)
        with open(dst, 'rb') as fh:
            got = base64.b64encode(hashlib.sha384(fh.read()).digest()).decode()
        if got != LIB_SHA384[name]:
            sys.exit('lib/%s: sha384 %s does not match the pinned %s' % (name, got, LIB_SHA384[name]))

    for f in DATA:
        if os.path.isfile(os.path.join(hub, f)):
            shutil.copy(os.path.join(hub, f), out)

    # file:// pages cannot fetch(), so the history CSV travels as a script
    csv = os.path.join(hub, 'history-pos.csv')
    if os.path.isfile(csv):
        with open(csv, encoding='utf-8') as fh:
            body = fh.read()
        with open(os.path.join(out, 'history-pos.js'), 'w', encoding='utf-8') as fh:
            fh.write('window.HISTORY_POS_CSV = ' + json.dumps(body) + ';\n')

    for p in PAGES:
        src = os.path.join(hub, p)
        if not os.path.isfile(src):
            sys.exit('missing ' + src)
        with open(src, encoding='utf-8') as fh:
            t = fh.read()
        for pat, local in CDN:
            t = re.sub(pat, local, t)
        t = LOCAL_SRI.sub(r'\1', t)
        t = FONTS.sub('', t)
        t = re.sub(r'<link rel="preconnect"[^>]*>\s*', '', t)
        left = re.findall(r'https://(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)/[^"\')\s]+', t)
        if left:
            sys.exit(p + ': CDN reference without a local copy: ' + ', '.join(sorted(set(left))))
        if p == 'history.html':
            old = "fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })"
            if t.count(old) != 1:
                sys.exit('history.html: loader not found')
            t = t.replace(old, "(window.HISTORY_POS_CSV != null && /history-pos\\.csv$/.test(url) ? Promise.resolve(window.HISTORY_POS_CSV) : " + old + ")")
            t = t.replace('<script src="lib/d3.min.js"></script>', '<script src="lib/d3.min.js"></script>\n<script src="history-pos.js"></script>', 1)
            if 'history-pos.js' not in t:
                sys.exit('history.html: d3 script tag not found')
        if p == 'index.html':
            tags = ('<script src="offline-seed.js"></script>\n<script src="offline-shim.js"></script>\n'
                    '<script src="localdata.js"></script>\n')
            m = re.search(r'<meta charset="?utf-?8"?>\n?', t, re.I)
            if not m:
                sys.exit('index.html: charset meta not found')
            t = t[:m.end()] + tags + t[m.end():]
        with open(os.path.join(out, p), 'w', encoding='utf-8') as fh:
            fh.write(t)

    seed = {'builtAt': None, 'collections': {}}
    if a.seed:
        for coll in sorted(os.listdir(a.seed)):
            d = os.path.join(a.seed, coll)
            if not os.path.isdir(d):
                continue
            docs = {}
            for f in sorted(os.listdir(d)):
                if f.endswith('.json'):
                    with open(os.path.join(d, f), encoding='utf-8') as fh:
                        docs[f[:-5]] = json.load(fh)
            seed['collections'][coll] = docs
    with open(os.path.join(out, 'offline-seed.js'), 'w', encoding='utf-8') as fh:
        fh.write('window.OFFLINE_SEED = ' + json.dumps(seed, ensure_ascii=False) + ';\n')
    shutil.copy(os.path.join(HERE, 'offline-shim.js'), out)
    shutil.copy(os.path.join(HERE, 'README-offline.txt'), os.path.join(out, '使用說明.txt'))

    # local-data mode: auto-load the newest reports from ./data (a Google Drive synced folder)
    shutil.copy(os.path.join(HERE, 'localdata.js'), out)
    shutil.copy(os.path.join(HERE, 'serve.py'), out)
    if os.path.isfile(os.path.join(HERE, '啟動.bat')):
        shutil.copy(os.path.join(HERE, '啟動.bat'), out)
    data_dir = os.path.join(out, 'data')
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(data_dir, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump({'files': [], 'builtAt': None}, fh, ensure_ascii=False)
    with open(os.path.join(data_dir, '放報表喺呢度.txt'), 'w', encoding='utf-8') as fh:
        fh.write('把最新的報表檔案放入這個 data 資料夾（或讓 Power Automate / Google Drive 同步進來）：\n'
                 '  POS-HKTW-*.xlsx、pipeline-*.xls、HKTW_*.xlsx(DSR)、*_INV_*.xlsx、*_BACKLOG_*.xlsx\n'
                 '然後 double-click 上一層的「啟動.bat」。Hub 會自動載入每種報表最新的一份。\n')

    if a.zip:
        z = out.rstrip(os.sep) + '.zip'
        with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(out):
                for f in files:
                    full = os.path.join(root, f)
                    zf.write(full, os.path.join(os.path.basename(out), os.path.relpath(full, out)))
        print('zip:', z, round(os.path.getsize(z) / 1e6, 1), 'MB')
    print('offline hub:', out)


if __name__ == '__main__':
    main()
