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
import os, re, sys, json, shutil, http.server, socketserver, webbrowser, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')

# ↓↓↓ EDIT THIS: your Google Drive synced folder that holds the report files. Example on Windows:
#     DRIVE_FOLDER = r'G:\My Drive\ZebraReports'
#     Leave as '' to use files already in ./data.
DRIVE_FOLDER = r''

PORT = 8787

# kind -> filename pattern; the newest match (by the date in the name) is copied in
PATTERNS = {
    'POS':      r'POS-HKTW|POS[_-]?Report',
    'pipeline': r'pipeline-20\d{2}',
    'DSR':      r'HKTW[_-]\d.*\.xlsx$',
    'INV':      r'_INV_',
    'BACKLOG':  r'_BACKLOG_',
    'account':  r'Account[_ ]?list|GC_Account',
}

def data_date(n):
    n = re.sub(r'\s*\([^)]*\)$', '', n or '')
    m = re.search(r'(20\d{2})[-.](\d{1,2})[-.](\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?', n)
    if m: return ''.join((m.group(i) or '00').zfill(2) for i in range(1, 7))
    m = re.search(r'(20\d{2})(\d{2})(\d{2})(?!\d)', n)
    if m and 1 <= int(m.group(2)) <= 12 and 1 <= int(m.group(3)) <= 31: return m.group(1) + m.group(2) + m.group(3) + '000000'
    return ''

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
    for kind, pat in PATTERNS.items():
        rx = re.compile(pat, re.I)
        matches = [f for f in src_files if rx.search(f)]
        if not matches:
            continue
        newest = max(matches, key=lambda f: (data_date(f), os.path.getmtime(os.path.join(DRIVE_FOLDER, f))))
        # drop older copies of this kind already in ./data
        for f in list(os.listdir(DATA)):
            if rx.search(f) and f != newest:
                try: os.remove(os.path.join(DATA, f))
                except OSError: pass
        dst = os.path.join(DATA, newest)
        if not os.path.exists(dst):
            shutil.copy2(os.path.join(DRIVE_FOLDER, newest), dst)
            print('  + 複製', kind, ':', newest)

def write_manifest():
    os.makedirs(DATA, exist_ok=True)
    files = sorted(f for f in os.listdir(DATA) if f != 'manifest.json' and os.path.isfile(os.path.join(DATA, f)) and not f.startswith('.'))
    with open(os.path.join(DATA, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump({'files': files, 'builtAt': time.strftime('%Y-%m-%d %H:%M:%S')}, fh, ensure_ascii=False)
    return files

def main():
    print('Zebra Sales Hub — 本機模式')
    print('1) 由 Google Drive 更新 data 資料夾…')
    refresh_from_drive()
    files = write_manifest()
    print('2) data 資料夾現有檔案：', ', '.join(files) if files else '(空)')
    os.chdir(HERE)
    port = PORT
    for _ in range(20):
        try:
            httpd = socketserver.TCPServer(('127.0.0.1', port), http.server.SimpleHTTPRequestHandler)
            break
        except OSError:
            port += 1
    else:
        print('找不到可用連接埠'); return
    url = 'http://127.0.0.1:%d/index.html' % port
    print('3) 伺服器已啟動：', url)
    print('   （關掉這個視窗就會停止伺服器）')
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()
