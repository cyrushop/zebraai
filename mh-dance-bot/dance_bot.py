#!/usr/bin/env python3
"""Auto-player for the Monster Hunter mobile dance mini-game via macOS iPhone Mirroring.

It reads the arrow sequence shown in the bar at the bottom of the screen
(left to right), maps each arrow's colour to a direction and taps the
matching on-screen button inside the iPhone Mirroring window.

    blue   -> right      green  -> left
    orange -> up         purple -> down

Commands
    python3 dance_bot.py calibrate          # once: mark the arrow bar and the 4 buttons
    python3 dance_bot.py run --dry-run      # only print what it sees
    python3 dance_bot.py run                # play
    python3 dance_bot.py test IMG --roi X0,Y0,X1,Y1   # offline check on a screenshot

Stop: move the mouse to the top-left corner of the screen, or Ctrl+C in the terminal.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
DEBUG_DIR = HERE / "debug"

BUNDLE_ID = "com.apple.ScreenContinuity"  # iPhone Mirroring.app
WINDOW_OWNER_NAMES = ("iPhone Mirroring", "iPhone 鏡像輸出", "iPhone镜像", "iPhone 鏡像", "iPhone-Synchronisierung")

DIRECTIONS = ("up", "down", "left", "right")

# Colour rules in OpenCV HSV units (H 0-180, S/V 0-255). Measured from a real
# screenshot: blue H~105, green H~56, orange H~17 (very saturated),
# purple H~150 (pale: S~90). Orange needs high S/V so the brown bar is ignored.
DEFAULT_COLORS = {
    "up":    {"h": [8, 30],    "s_min": 150, "v_min": 200},   # orange
    "left":  {"h": [40, 85],   "s_min": 90,  "v_min": 150},   # green
    "right": {"h": [90, 128],  "s_min": 90,  "v_min": 150},   # blue
    "down":  {"h": [130, 172], "s_min": 55,  "v_min": 160},   # purple / pink
}

ARROW_CHARS = {"up": "↑", "down": "↓", "left": "←", "right": "→"}


# --------------------------------------------------------------------------- detection

def detect_sequence(roi_bgr: np.ndarray, colors: dict = DEFAULT_COLORS, return_boxes: bool = False):
    """Return the directions of the arrows in the bar, left to right."""
    H = roi_bgr.shape[0]
    hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    blobs = []  # (cx, direction, area, (x, y, w, h))
    for direction, rule in colors.items():
        lo, hi = rule["h"]
        mask = (h >= lo) & (h <= hi) & (s >= rule["s_min"]) & (v >= rule["v_min"])
        mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        n, _, stats, cents = cv2.connectedComponentsWithStats(mask)
        for i in range(1, n):
            x, y, w, hh, area = stats[i]
            big, small = max(w, hh), min(w, hh)
            # an arrow chevron: not tiny, not a long thin line, not larger than the bar
            if area < 0.02 * H * H or big < 0.25 * H or small < 0.10 * H or big > 1.3 * H:
                continue
            blobs.append((float(cents[i][0]), direction, int(area), (int(x), int(y), int(w), int(hh))))

    # merge blobs that belong to the same slot (keep the biggest colour)
    blobs.sort(key=lambda b: b[0])
    slots: list[list] = []
    for b in blobs:
        if slots and b[0] - slots[-1][-1][0] < 0.45 * H:
            slots[-1].append(b)
        else:
            slots.append([b])
    picked = [max(slot, key=lambda b: b[2]) for slot in slots]
    seq = [b[1] for b in picked]
    if return_boxes:
        return seq, [b[3] for b in picked]
    return seq


def fmt(seq) -> str:
    return " ".join(ARROW_CHARS[d] for d in seq) if seq else "(none)"


def annotate(roi_bgr, seq, boxes):
    out = roi_bgr.copy()
    for d, (x, y, w, h) in zip(seq, boxes):
        cv2.rectangle(out, (x, y), (x + w, y + h), (0, 255, 255), 2)
        cv2.putText(out, d, (x, max(12, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    return out


# --------------------------------------------------------------------------- macOS helpers

def _quartz():
    try:
        import Quartz  # noqa: F401
        return Quartz
    except ImportError:
        sys.exit("pyobjc is missing: pip3 install -r requirements.txt (this part only runs on macOS)")


def find_window(app_name: str | None = None):
    """Return (x, y, w, h) in screen points of the iPhone Mirroring window, or None."""
    Q = _quartz()
    pids = set()
    try:
        from AppKit import NSRunningApplication
        for app in NSRunningApplication.runningApplicationsWithBundleIdentifier_(BUNDLE_ID):
            pids.add(int(app.processIdentifier()))
    except Exception:
        pass
    names = (app_name,) if app_name else WINDOW_OWNER_NAMES
    infos = Q.CGWindowListCopyWindowInfo(
        Q.kCGWindowListOptionOnScreenOnly | Q.kCGWindowListExcludeDesktopElements, Q.kCGNullWindowID)
    best = None
    for w in infos or []:
        if w.get("kCGWindowLayer", 0) != 0:
            continue
        owner = w.get("kCGWindowOwnerName", "")
        if int(w.get("kCGWindowOwnerPID", -1)) not in pids and owner not in names:
            continue
        b = w["kCGWindowBounds"]
        rect = (float(b["X"]), float(b["Y"]), float(b["Width"]), float(b["Height"]))
        if rect[2] < 100 or rect[3] < 100:
            continue
        if best is None or rect[2] * rect[3] > best[2] * best[3]:
            best = rect
    return best


def mouse_pos():
    Q = _quartz()
    p = Q.CGEventGetLocation(Q.CGEventCreate(None))
    return float(p.x), float(p.y)


def tap(x: float, y: float, hold: float):
    Q = _quartz()
    pt = (x, y)
    for etype in (Q.kCGEventMouseMoved, Q.kCGEventLeftMouseDown):
        ev = Q.CGEventCreateMouseEvent(None, etype, pt, Q.kCGMouseButtonLeft)
        Q.CGEventPost(Q.kCGHIDEventTap, ev)
    time.sleep(hold)
    ev = Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseUp, pt, Q.kCGMouseButtonLeft)
    Q.CGEventPost(Q.kCGHIDEventTap, ev)


# macOS virtual key codes usable as the pause/resume hotkey. A lone modifier tap
# types nothing, so it is harmless to the game even though the key is not swallowed.
HOTKEYS = {
    "right_option": 61, "left_option": 58, "right_command": 54, "right_shift": 60,
    "right_control": 62, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109,
}


class Hotkey:
    """Polls the global key state; pressed() is True once per key press."""

    def __init__(self, name: str):
        self.Q = _quartz()
        self.code = HOTKEYS[name]
        self.was_down = False

    @staticmethod
    def ensure_permission() -> bool:
        Q = _quartz()
        pre = getattr(Q, "CGPreflightListenEventAccess", None)
        if pre is None or pre():
            return True
        getattr(Q, "CGRequestListenEventAccess", lambda: None)()
        return False

    def pressed(self) -> bool:
        down = bool(self.Q.CGEventSourceKeyState(self.Q.kCGEventSourceStateHIDSystemState, self.code))
        edge = down and not self.was_down
        self.was_down = down
        return edge


def play_sound(name: str, enabled: bool):
    if enabled:
        os.system(f"afplay /System/Library/Sounds/{name}.aiff >/dev/null 2>&1 &")


class Grabber:
    def __init__(self):
        import mss
        self.sct = mss.mss()

    def grab(self, x, y, w, h) -> np.ndarray:
        shot = self.sct.grab({"left": int(round(x)), "top": int(round(y)),
                              "width": max(1, int(round(w))), "height": max(1, int(round(h)))})
        return cv2.cvtColor(np.asarray(shot), cv2.COLOR_BGRA2BGR)


# --------------------------------------------------------------------------- config

def load_config():
    if not CONFIG_PATH.exists():
        sys.exit("No config.json yet. Run:  python3 dance_bot.py calibrate")
    cfg = json.loads(CONFIG_PATH.read_text())
    cfg.setdefault("colors", DEFAULT_COLORS)
    return cfg


def to_screen(cfg, win, fx, fy):
    """Fractions (relative to the window) -> screen points. Without a window: absolute."""
    if cfg.get("absolute") or win is None:
        return fx, fy
    return win[0] + fx * win[2], win[1] + fy * win[3]


def roi_rect(cfg, win):
    x0, y0 = to_screen(cfg, win, *cfg["roi"][0])
    x1, y1 = to_screen(cfg, win, *cfg["roi"][1])
    return min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0)


# --------------------------------------------------------------------------- commands

def cmd_calibrate(args):
    win = find_window(args.app_name)
    if win is None:
        print("! iPhone Mirroring window not found - saving ABSOLUTE screen coordinates.")
        print("  (Then do not move the window after calibrating.)")
    else:
        print(f"iPhone Mirroring window: x={win[0]:.0f} y={win[1]:.0f} w={win[2]:.0f} h={win[3]:.0f}")
    print("\nOpen the dance mini-game so the arrow bar and the 4 buttons are visible.")
    print("For each step: keep THIS terminal focused, hover the mouse over the point, press Enter.\n")

    steps = [
        ("roi0", "TOP-LEFT corner of the arrow bar (left of the 1st arrow, above the icons)"),
        ("roi1", "BOTTOM-RIGHT corner of the arrow bar (right of the last possible arrow, below the icons,\n"
                 "       but ABOVE the +10/+6/+3 timing line)"),
        ("up", "centre of the UP button (orange)"),
        ("down", "centre of the DOWN button (purple)"),
        ("left", "centre of the LEFT button (green)"),
        ("right", "centre of the RIGHT button (blue)"),
    ]
    pts = {}
    for key, text in steps:
        input(f"  -> {text}  [Enter]")
        x, y = mouse_pos()
        pts[key] = (x, y)
        print(f"     recorded ({x:.0f}, {y:.0f})")

    def rel(p):
        if win is None:
            return [p[0], p[1]]
        return [(p[0] - win[0]) / win[2], (p[1] - win[1]) / win[3]]

    cfg = {
        "absolute": win is None,
        "roi": [rel(pts["roi0"]), rel(pts["roi1"])],
        "buttons": {d: rel(pts[d]) for d in DIRECTIONS},
        "colors": DEFAULT_COLORS,
    }
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    print(f"\nSaved {CONFIG_PATH}")

    # preview: what the bot sees right now
    roi = Grabber().grab(*roi_rect(cfg, win))
    seq, boxes = detect_sequence(roi, cfg["colors"], return_boxes=True)
    DEBUG_DIR.mkdir(exist_ok=True)
    cv2.imwrite(str(DEBUG_DIR / "calibration_roi.png"), annotate(roi, seq, boxes))
    print(f"Arrows visible now: {fmt(seq)}")
    print(f"Check {DEBUG_DIR / 'calibration_roi.png'} - it should show only the arrow row.")


def cmd_test(args):
    img = cv2.imread(args.image)
    if img is None:
        sys.exit(f"cannot read {args.image}")
    if args.roi:
        x0, y0, x1, y1 = (int(v) for v in args.roi.split(","))
        img = img[y0:y1, x0:x1]
    seq, boxes = detect_sequence(img, return_boxes=True)
    print(fmt(seq), seq)
    if args.out:
        cv2.imwrite(args.out, annotate(img, seq, boxes))


def cmd_run(args):
    cfg = load_config()
    colors = cfg["colors"]
    grab = Grabber()
    if args.debug:
        DEBUG_DIR.mkdir(exist_ok=True)

    win, win_checked = None, 0.0
    if not cfg.get("absolute"):
        win = find_window(args.app_name)
        if win is None:
            sys.exit("iPhone Mirroring window not found. Open it first (or re-run calibrate).")

    hotkey = None
    if args.hotkey != "none":
        if not Hotkey.ensure_permission():
            print("! Hotkey needs 'Input Monitoring' permission for your Terminal:\n"
                  "  System Settings > Privacy & Security > Input Monitoring, enable it,\n"
                  "  then quit and reopen the Terminal. Running without the hotkey for now.")
        else:
            hotkey = Hotkey(args.hotkey)

    paused = args.start_paused
    print("Running" + (" (dry run, no taps)" if args.dry_run else "") +
          ". Stop: mouse to top-left screen corner, or Ctrl+C.")
    if hotkey:
        print(f"Pause / resume: press {args.hotkey}." + ("  Starting PAUSED." if paused else ""))
    if not args.dry_run:
        os.system('osascript -e \'tell application id "%s" to activate\' >/dev/null 2>&1' % BUNDLE_ID)
        time.sleep(0.4)

    last_played, last_played_at = None, 0.0
    candidate, stable = None, 0
    blocked_until = 0.0
    rounds = 0

    def check_controls() -> str:
        """'stop' on fail-safe; toggles pause on hotkey. Returns 'stop', 'paused' or 'run'."""
        nonlocal paused
        mx, my = mouse_pos()
        if mx <= 3 and my <= 3:
            return "stop"
        if hotkey and hotkey.pressed():
            paused = not paused
            print(f"[{time.strftime('%H:%M:%S')}] " + ("PAUSED" if paused else "RESUMED"), flush=True)
            play_sound("Funk" if paused else "Tink", not args.no_sound)
        return "paused" if paused else "run"

    try:
        while True:
            state = check_controls()
            if state == "stop":
                print("\nFail-safe corner hit - stopped.")
                return
            if state == "paused":
                candidate, stable, last_played = None, 0, None
                time.sleep(args.poll)
                continue
            now = time.time()
            if not cfg.get("absolute") and now - win_checked > 1.0:
                win = find_window(args.app_name) or win
                win_checked = now

            roi = grab.grab(*roi_rect(cfg, win))
            seq = detect_sequence(roi, colors)

            if not seq:
                candidate, stable = None, 0
                last_played = None  # bar cleared: next sequence is new even if identical
                time.sleep(args.poll)
                continue

            # wait until the same sequence is seen on N frames (icons may animate in)
            if seq == candidate:
                stable += 1
            else:
                candidate, stable = seq, 1

            fresh = seq != last_played or now - last_played_at > args.repeat_after
            if stable >= args.stable_frames and now >= blocked_until and fresh:
                print(f"[{time.strftime('%H:%M:%S')}] {fmt(seq)}", flush=True)
                if args.debug:
                    seq_b, boxes = detect_sequence(roi, colors, return_boxes=True)
                    cv2.imwrite(str(DEBUG_DIR / f"seq_{int(now * 1000)}.png"), annotate(roi, seq_b, boxes))
                if not args.dry_run:
                    for d in seq:
                        if check_controls() != "run":  # pause/stop takes effect mid-sequence
                            break
                        bx, by = to_screen(cfg, win, *cfg["buttons"][d])
                        tap(bx, by, args.hold)
                        time.sleep(args.interval)
                last_played, last_played_at = seq, time.time()
                blocked_until = last_played_at + args.cooldown
                candidate, stable = None, 0
                rounds += 1
                if args.max_rounds and rounds >= args.max_rounds:
                    print("max rounds reached.")
                    return
            time.sleep(args.poll)
    except KeyboardInterrupt:
        print("\nStopped.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app-name", help="window owner name if auto-detect fails (e.g. 'iPhone Mirroring')")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("calibrate", help="mark the arrow bar and the 4 buttons")

    r = sub.add_parser("run", help="play")
    r.add_argument("--dry-run", action="store_true", help="detect and print only, no taps")
    r.add_argument("--debug", action="store_true", help="save each detected bar to debug/")
    r.add_argument("--interval", type=float, default=0.08, help="seconds between taps (default 0.08)")
    r.add_argument("--hold", type=float, default=0.03, help="seconds each tap is held (default 0.03)")
    r.add_argument("--poll", type=float, default=0.03, help="seconds between screen reads (default 0.03)")
    r.add_argument("--stable-frames", type=int, default=2, help="frames a sequence must be stable (default 2)")
    r.add_argument("--cooldown", type=float, default=0.6, help="no input for N s after a sequence (default 0.6)")
    r.add_argument("--repeat-after", type=float, default=2.5,
                   help="replay an identical sequence still on screen after N s (default 2.5)")
    r.add_argument("--max-rounds", type=int, default=0, help="stop after N sequences (0 = no limit)")
    r.add_argument("--hotkey", default="right_option", choices=sorted(HOTKEYS) + ["none"],
                   help="key that toggles pause/resume (default right_option)")
    r.add_argument("--start-paused", action="store_true", help="start paused; press the hotkey to begin")
    r.add_argument("--no-sound", action="store_true", help="no sound on pause/resume")

    t = sub.add_parser("test", help="run detection on a screenshot file")
    t.add_argument("image")
    t.add_argument("--roi", help="pixel crop X0,Y0,X1,Y1 of the arrow row")
    t.add_argument("--out", help="write an annotated crop here")

    args = ap.parse_args()
    {"calibrate": cmd_calibrate, "run": cmd_run, "test": cmd_test}[args.cmd](args)


if __name__ == "__main__":
    main()
