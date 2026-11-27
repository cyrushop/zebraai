#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Zebra Sales Hub — local server + daily data refresh.

Double-click 啟動.bat (which runs this), or run:  python serve.py

What it does, each time it starts:
  1. (optional) copies the NEWEST POS / pipeline / DSR / VAD file of each kind from your
     Google Drive synced folder into ./data, and removes older copies of the same kind;
  2. writes ./data/manifest.json (the list the Hub reads);
  3. starts a local web server and opens the Hub in your browser.

Set DRIVE_FOLDER below to your Google Drive synced folder. Leave it '' to just use whatever
files already sit in ./data (e.g. if Power Automate drops them straight into ./data).
"""
import os, re, sys, json, shutil, http.server, socketserver, webbrowser, threading, time, urllib.request, urllib.parse, posixpath

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')

# ↓↓↓ EDIT THIS: your Google Drive synced folder that holds the report files. Example on Windows:
#     DRIVE_FOLDER = r'G:\My Drive\ZebraReports'
#     Leave as '' to use files already in ./data.
DRIVE_FOLDER = r''

PORT = 8787   # fixed: the browser keeps forecast / target per address, so the port must not change

# kind -> filename pattern; the newest match (by the date in the name) is copied in.
# A file belongs to the FIRST kind it matches, in this order (same as localdata.js): POS-HKTW-….xlsx also
# matches the DSR pattern, so it must be claimed by POS first.
PATTERNS = {
    'POS':      r'POS-HKTW|POS[_-]?Report',
    'pipeline': r'pipeline-20\d{2}',
    'INV':      r'_INV_',       # one per distributor (Chinetek, VSTECS …)
    'BACKLOG':  r'_BACKLOG_',   # one per distributor
    'DSR':      r'HKTW[_-]\d.*\.xlsx$',
    'account':  r'Account[_ ]?list|GC_Account',
}
RX = [(k, re.compile(p, re.I)) for k, p in PATTERNS.items()]

def kind_of(name):
    for k, rx in RX:
        if rx.search(name):
            return k, rx
    return None, None

def data_date(n):
    n = re.sub(r'\s*\([^)]*\)$', '', n or '')
    m = re.search(r'(20\d{2})[-.](\d{1,2})[-.](\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?', n)
    if m: return ''.join((m.group(i) or '00').zfill(2) for i in range(1, 7))
    m = re.search(r'(20\d{2})(\d{2})(\d{2})(?!\d)', n)
    if m and 1 <= int(m.group(2)) <= 12 and 1 <= int(m.group(3)) <= 31: return m.group(1) + m.group(2) + m.group(3) + '000000'
    m = re.search(r'WK\s*(20\d{2})(\d{2})(?!\d)', n, re.I) or re.search(r'(20\d{2})\s*WK\s*(\d{1,2})(?!\d)', n, re.I)
    if m:   # fiscal week number: same approximation as the Hub (1 Jan + 7 days per week)
        d = time.localtime(time.mktime((int(m.group(1)), 1, 1 + (int(m.group(2)) - 1) * 7, 12, 0, 0, 0, 0, -1)))
        return '%04d%02d%02d000000' % (d.tm_year, d.tm_mon, d.tm_mday)
    m = re.search(r'(?:^|\D)(\d{2})(\d{2})$', re.sub(r'\.[A-Za-z0-9]+$', '', n))
    if m and 1 <= int(m.group(1)) <= 12 and 1 <= int(m.group(2)) <= 31:   # HKTW_1123: month-day, last year if after today
        import datetime
        y = datetime.date.today().year
        try:
            if datetime.date(y, int(m.group(1)), int(m.group(2))) > datetime.date.today() + datetime.timedelta(days=1): y -= 1
        except ValueError:
            pass
        return '%04d%s%s000000' % (y, m.group(1), m.group(2))
    return ''

PER_VAD = {'INV', 'BACKLOG'}

def group_of(kind, rx, name):
    """Inventory / backlog files are per distributor: keep the newest of each (review M6)."""
    if kind not in PER_VAD:
        return kind
    return kind + '|' + re.sub(r'[\s_\-]+$', '', rx.split(name)[0]).lower()

def refresh_from_drive():
    os.makedirs(DATA, exist_ok=True)
    if not DRIVE_FOLDER:
        return
    if not os.path.isdir(DRIVE_FOLDER):
        print('  ! DRIVE_FOLDER 不存在，略過：', DRIVE_FOLDER); return
    try:
        src_files = [f for f in os.listdir(DRIVE_FOLDER) if os.path.isfile(os.path.join(DRIVE_FOLDER, f))]
    except Exception as e:
        print('  ! 讀取 DRIVE_FOLDER 失敗：', e); return
    groups = {}
    for f in src_files:
        kind, rx = kind_of(f)
        if kind:
            groups.setdefault(group_of(kind, rx, f), []).append(f)
    for g, matches in sorted(groups.items()):
        newest = max(matches, key=lambda f: (data_date(f), os.path.getmtime(os.path.join(DRIVE_FOLDER, f))))
        # drop older copies of this kind (and, for inventory / backlog, of this distributor only) already in ./data
        for f in list(os.listdir(DATA)):
            k2, rx2 = kind_of(f)
            if k2 and group_of(k2, rx2, f) == g and f != newest and data_date(f) <= data_date(newest):
                try: os.remove(os.path.join(DATA, f))
                except OSError: pass
        dst = os.path.join(DATA, newest)
        if not os.path.exists(dst):
            shutil.copy2(os.path.join(DRIVE_FOLDER, newest), dst)
            print('  + 複製', g, ':', newest)

def write_manifest():
    os.makedirs(DATA, exist_ok=True)
    files = sorted(f for f in os.listdir(DATA) if f != 'manifest.json' and os.path.isfile(os.path.join(DATA, f)) and not f.startswith('.'))
    with open(os.path.join(DATA, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump({'files': files, 'builtAt': time.strftime('%Y-%m-%d %H:%M:%S')}, fh, ensure_ascii=False)
    return files

ALLOWED_EXT = {'.html', '.js', '.json', '.css', '.txt', '.xlsx', '.xls', '.csv', '.htm', '.png', '.svg', '.ico', '.woff2'}

class HubHandler(http.server.SimpleHTTPRequestHandler):
    """Serves only the Hub's own files: no folder listings, no hidden files, only this computer (review M6)."""
    def _host_ok(self):
        host = (self.headers.get('Host') or '').lower()
        return host in ('127.0.0.1:%d' % PORT, 'localhost:%d' % PORT)   # refuses DNS-rebinding names

    def _path_ok(self):
        rel = posixpath.normpath(urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)).lstrip('/')
        if rel in ('', '.'):
            return True                                     # → index.html
        parts = rel.split('/')
        if any(p.startswith('.') or p == '..' for p in parts) or len(parts) > 2:
            return False
        if len(parts) == 2 and parts[0] not in ('lib', 'data'):
            return False
        if parts[-1] in ('serve.py', '啟動.bat'):
            return False
        return os.path.splitext(parts[-1])[1].lower() in ALLOWED_EXT

    def send_head(self):
        if not self._host_ok() or not self._path_ok():
            self.send_error(404); return None
        if os.path.isdir(self.translate_path(self.path)) and not os.path.isfile(os.path.join(self.translate_path(self.path), 'index.html')):
            self.send_error(404); return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404); return None

    def end_headers(self):
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Content-Security-Policy', "frame-ancestors 'self'")
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass   # keep the window quiet

def hub_already_running(url):
    try:
        with urllib.request.urlopen(url.replace('index.html', 'localdata.js'), timeout=2) as r:
            return r.status == 200 and b'local-data mode' in r.read(400)
    except Exception:
        return False

def main():
    print('Zebra Sales Hub — 本機模式')
    print('1) 由 Google Drive 更新 data 資料夾…')
    refresh_from_drive()
    files = write_manifest()
    print('2) data 資料夾現有檔案：', ', '.join(files) if files else '(空)')
    os.chdir(HERE)
    url = 'http://127.0.0.1:%d/index.html' % PORT
    try:
        httpd = socketserver.TCPServer(('127.0.0.1', PORT), HubHandler)
    except OSError:
        if hub_already_running(url):
            print('3) Hub 已經喺另一個視窗運行緊，直接打開：', url)
            webbrowser.open(url); return
        print('\n連接埠 %d 被其他程式佔用。請關閉佔用嘅程式後再試。' % PORT)
        print('（Hub 固定用呢個連接埠：換 port 會令瀏覽器當係另一個網站，之前輸入嘅 forecast / target 會睇唔到。）')
        sys.exit(1)
    print('3) 伺服器已啟動：', url)
    print('   （關掉這個視窗就會停止伺服器）')
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()
