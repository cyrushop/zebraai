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
import signal
import sys
import threading
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


def _mirroring_pids() -> set:
    pids = set()
    try:
        from AppKit import NSWorkspace
        for app in NSWorkspace.sharedWorkspace().runningApplications():
            bid = str(app.bundleIdentifier() or "")
            if bid == BUNDLE_ID or "ScreenContinuity" in bid:
                pids.add(int(app.processIdentifier()))
    except Exception:
        pass
    return pids


def list_windows():
    """All visible windows as dicts (owner, pid, layer, rect)."""
    Q = _quartz()
    infos = Q.CGWindowListCopyWindowInfo(
        Q.kCGWindowListOptionOnScreenOnly | Q.kCGWindowListExcludeDesktopElements, Q.kCGNullWindowID)
    out = []
    for w in infos or []:
        b = w.get("kCGWindowBounds") or {}
        out.append({
            "owner": str(w.get("kCGWindowOwnerName", "")),
            "pid": int(w.get("kCGWindowOwnerPID", -1)),
            "layer": int(w.get("kCGWindowLayer", 0)),
            "rect": (float(b.get("X", 0)), float(b.get("Y", 0)), float(b.get("Width", 0)), float(b.get("Height", 0))),
        })
    return out


def find_window(app_name: str | None = None):
    """Return (x, y, w, h) in screen points of the iPhone Mirroring window, or None.

    Matches the iPhone Mirroring process (bundle id), a known localized name,
    or any window owner whose name contains "iPhone".
    """
    pids = _mirroring_pids()
    best = None
    for w in list_windows():
        owner, rect = w["owner"], w["rect"]
        if app_name:
            match = owner == app_name
        else:
            match = w["pid"] in pids or owner in WINDOW_OWNER_NAMES or "iphone" in owner.lower()
        if not match or rect[2] < 100 or rect[3] < 100:
            continue
        key = (w["layer"] == 0, rect[2] * rect[3])  # prefer normal windows, then the biggest
        if best is None or key > best[0]:
            best = (key, rect)
    return best[1] if best else None


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
    if getattr(args, "image", None):
        return cmd_calibrate_image(args)
    win = find_window(args.app_name)
    while win is None:
        print("! iPhone Mirroring window not found.")
        print("  Open iPhone Mirroring (and the game) so its window is visible on this screen.")
        ans = input("  Press Enter to look again, or type A + Enter to use absolute screen coordinates: ")
        if ans.strip().lower() == "a":
            print("  Using ABSOLUTE coordinates - do not move the iPhone Mirroring window afterwards.")
            break
        win = find_window(args.app_name)
    if win is not None:
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
        while True:
            typed = input(f"  -> {text}  [Enter]")
            x, y = mouse_pos()
            if typed.strip():
                print("     (only press Enter here - do not type anything) try again")
                continue
            if win is not None and not (win[0] <= x <= win[0] + win[2] and win[1] <= y <= win[1] + win[3]):
                print(f"     ({x:.0f}, {y:.0f}) is OUTSIDE the iPhone Mirroring window - hover over the game and try again")
                continue
            if key == "roi1" and (x - pts["roi0"][0] < 30 or y - pts["roi0"][1] < 8):
                print("     must be clearly BELOW and to the RIGHT of the top-left corner - try again")
                continue
            break
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


IMAGE_STEPS = [
    ("roi0", "TOP-LEFT of arrow bar (left of 1st arrow, above icons)"),
    ("roi1", "BOTTOM-RIGHT of arrow bar (right end, below icons, above +10/+6/+3 line)"),
    ("up", "centre of UP button (orange)"),
    ("down", "centre of DOWN button (purple)"),
    ("left", "centre of LEFT button (green)"),
    ("right", "centre of RIGHT button (blue)"),
]


def pick_points_on_image(img):
    """Show the screenshot; the user clicks the 6 points. Returns {key: (x, y)} in image pixels."""
    H, W = img.shape[:2]
    scale = min(1.0, 1400 / W, 850 / H)
    base = cv2.resize(img, (int(W * scale), int(H * scale))) if scale < 1 else img.copy()
    pts: list = []
    win_name = "Click the points - Z undo, Esc cancel"

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(pts) < len(IMAGE_STEPS):
            pts.append((x / scale, y / scale))

    cv2.namedWindow(win_name, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(win_name, on_mouse)
    while True:
        view = base.copy()
        for i, (px, py) in enumerate(pts):
            c = (int(px * scale), int(py * scale))
            cv2.circle(view, c, 6, (0, 255, 255), 2)
            cv2.putText(view, IMAGE_STEPS[i][0], (c[0] + 8, c[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        if len(pts) >= 2:
            a = (int(pts[0][0] * scale), int(pts[0][1] * scale))
            b = (int(pts[1][0] * scale), int(pts[1][1] * scale))
            cv2.rectangle(view, a, b, (0, 255, 255), 1)
        done = len(pts) == len(IMAGE_STEPS)
        msg = "All done - press Enter to save (Z = undo)" if done else \
            f"{len(pts) + 1}/{len(IMAGE_STEPS)}: click {IMAGE_STEPS[len(pts)][1]}"
        cv2.rectangle(view, (0, 0), (view.shape[1], 34), (0, 0, 0), -1)
        cv2.putText(view, msg, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
        cv2.imshow(win_name, view)
        k = cv2.waitKey(30) & 0xFF
        if k == 27:
            cv2.destroyAllWindows()
            sys.exit("Cancelled.")
        if k in (ord("z"), ord("Z")) and pts:
            pts.pop()
        if k in (13, 10) and done:
            break
    cv2.destroyAllWindows()
    cv2.waitKey(1)
    return {key: pts[i] for i, (key, _) in enumerate(IMAGE_STEPS)}


def find_content_rect(bgr):
    """Bounding box (x, y, w, h) of the game picture inside the window (black frame removed)."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    lit = gray > 25
    rows = np.where(lit.mean(axis=1) > 0.10)[0]
    cols = np.where(lit.mean(axis=0) > 0.10)[0]
    if len(rows) == 0 or len(cols) == 0:
        return None
    return int(cols[0]), int(rows[0]), int(cols[-1] - cols[0] + 1), int(rows[-1] - rows[0] + 1)


def cmd_calibrate_image(args):
    img = cv2.imread(args.image)
    if img is None:
        sys.exit(f"Cannot read image: {args.image}")
    win = find_window(args.app_name)
    while win is None:
        input("! iPhone Mirroring window not found. Open it (any game screen is fine), then press Enter: ")
        win = find_window(args.app_name)

    print("A window with your screenshot will open. Click the 6 points in order; Z = undo, Esc = cancel.")
    picked = pick_points_on_image(img)

    # where the game picture sits inside the iPhone Mirroring window right now
    shot = Grabber().grab(*win)
    sx, sy = shot.shape[1] / win[2], shot.shape[0] / win[3]  # pixels per point (Retina = 2)
    rect = find_content_rect(shot)
    if rect is None:
        sys.exit("Could not find the game picture in the iPhone Mirroring window. "
                 "Is the game showing? Does the Terminal have Screen Recording permission?")
    cx, cy, cw, ch = rect[0] / sx, rect[1] / sy, rect[2] / sx, rect[3] / sy  # in points, window-relative
    ih, iw = img.shape[:2]
    a_img, a_win = iw / ih, cw / ch
    print(f"Game picture in window: x={cx:.0f} y={cy:.0f} w={cw:.0f} h={ch:.0f} (aspect {a_win:.3f}; "
          f"screenshot {a_img:.3f})")
    if abs(a_img - a_win) / a_img > 0.04:
        print("! The screenshot and the mirrored picture have different shapes. Use a screenshot taken on\n"
              "  this same iPhone in landscape, and check debug/calibration_preview.png carefully.")

    def rel(p):  # image pixel -> fraction of the window
        return [(cx + p[0] / iw * cw) / win[2], (cy + p[1] / ih * ch) / win[3]]

    cfg = {
        "absolute": False,
        "roi": [rel(picked["roi0"]), rel(picked["roi1"])],
        "buttons": {d: rel(picked[d]) for d in DIRECTIONS},
        "colors": DEFAULT_COLORS,
        "content_rect": [cx / win[2], cy / win[3], cw / win[2], ch / win[3]],
    }
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    print(f"Saved {CONFIG_PATH}")

    # preview on the live window: yellow box = arrow bar, dots = buttons
    prev = shot.copy()
    cv2.rectangle(prev, (rect[0], rect[1]), (rect[0] + rect[2], rect[1] + rect[3]), (255, 0, 255), 1)
    (x0, y0), (x1, y1) = cfg["roi"]
    cv2.rectangle(prev, (int(x0 * win[2] * sx), int(y0 * win[3] * sy)),
                  (int(x1 * win[2] * sx), int(y1 * win[3] * sy)), (0, 255, 255), 2)
    for d, (fx, fy) in cfg["buttons"].items():
        c = (int(fx * win[2] * sx), int(fy * win[3] * sy))
        cv2.circle(prev, c, 8, (0, 255, 255), 2)
        cv2.putText(prev, d, (c[0] + 10, c[1]), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
    DEBUG_DIR.mkdir(exist_ok=True)
    cv2.imwrite(str(DEBUG_DIR / "calibration_preview.png"), prev)
    print(f"Check {DEBUG_DIR / 'calibration_preview.png'}: the magenta box should hug the game picture.")
    print("When the dance mini-game is on, the yellow box/dots should sit on the arrow bar and buttons.")


def cmd_windows(args):
    pids = _mirroring_pids()
    print(f"iPhone Mirroring process ids: {sorted(pids) or 'none (app not running?)'}")
    found = find_window(args.app_name)
    print(f"Window the bot would use: {found or 'NONE'}\n")
    print(f"{'owner':32} {'pid':>6} {'layer':>5}  x, y, w, h")
    for w in list_windows():
        if w["rect"][2] >= 50 and w["rect"][3] >= 50:
            mark = " <-- iPhone Mirroring" if w["pid"] in pids else ""
            x, y, ww, hh = w["rect"]
            print(f"{w['owner'][:32]:32} {w['pid']:>6} {w['layer']:>5}  {x:.0f}, {y:.0f}, {ww:.0f}, {hh:.0f}{mark}")


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


class BotState:
    """Shared between the bot thread, the hotkey and the menu bar."""

    def __init__(self, paused: bool, dry_run: bool, sound: bool):
        self.lock = threading.Lock()
        self.paused = paused
        self.dry_run = dry_run
        self.sound = sound
        self.stop = False
        self.stop_reason = ""
        self.last_seq = ""
        self.rounds = 0

    def toggle(self):
        with self.lock:
            self.paused = not self.paused
            paused = self.paused
        print(f"[{time.strftime('%H:%M:%S')}] " + ("PAUSED" if paused else "RESUMED"), flush=True)
        play_sound("Funk" if paused else "Tink", self.sound)

    def request_stop(self, reason: str):
        with self.lock:
            if not self.stop:
                self.stop, self.stop_reason = True, reason


def bot_loop(args, cfg, state: BotState, hotkey):
    colors = cfg["colors"]
    grab = Grabber()  # created in this thread
    win, win_checked = None, 0.0
    if not cfg.get("absolute"):
        win = find_window(args.app_name)

    last_played, last_played_at = None, 0.0
    candidate, stable = None, 0
    blocked_until = 0.0

    def check_controls() -> str:
        """Returns 'stop', 'paused' or 'run'."""
        if state.stop:
            return "stop"
        mx, my = mouse_pos()
        if mx <= 3 and my <= 3:
            state.request_stop("fail-safe corner")
            return "stop"
        if hotkey and hotkey.pressed():
            state.toggle()
        return "paused" if state.paused else "run"

    try:
        while True:
            ctl = check_controls()
            if ctl == "stop":
                return
            if ctl == "paused":
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
                state.last_seq = fmt(seq)
                state.rounds += 1
                if args.max_rounds and state.rounds >= args.max_rounds:
                    state.request_stop("max rounds reached")
                    return
            time.sleep(args.poll)
    except Exception as e:  # surface errors instead of dying silently in the thread
        state.request_stop(f"error: {e!r}")
        raise


def run_menubar(state: BotState, worker: threading.Thread):
    """Menu bar status light on the main thread; returns when the bot stops."""
    from AppKit import (NSApplication, NSApplicationActivationPolicyAccessory, NSMenu,
                        NSMenuItem, NSStatusBar, NSVariableStatusItemLength)
    from Foundation import NSObject, NSTimer
    from PyObjCTools import AppHelper

    class Controller(NSObject):
        def setup(self):
            self.item = NSStatusBar.systemStatusBar().statusItemWithLength_(NSVariableStatusItemLength)
            menu = NSMenu.alloc().init()
            self.info = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("", None, "")
            self.info.setEnabled_(False)
            menu.addItem_(self.info)
            menu.addItem_(NSMenuItem.separatorItem())
            self.toggle_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("", "toggle:", "")
            self.toggle_item.setTarget_(self)
            menu.addItem_(self.toggle_item)
            quit_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("停止 Bot", "quit:", "")
            quit_item.setTarget_(self)
            menu.addItem_(quit_item)
            self.item.setMenu_(menu)
            self.refresh_(None)
            NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
                0.2, self, "refresh:", None, True)
            return self

        def refresh_(self, _timer):
            if state.stop or not worker.is_alive():
                AppHelper.stopEventLoop()
                return
            if state.paused:
                title = "⏸ MH 暫停"
            elif state.dry_run:
                title = "👀 MH 試行"
            else:
                title = "🟢 MH 運行"
            self.item.button().setTitle_(title)
            self.info.setTitle_(f"已打 {state.rounds} 組　上一組：{state.last_seq or '-'}")
            self.toggle_item.setTitle_("繼續" if state.paused else "暫停")

        def toggle_(self, _sender):
            state.toggle()
            self.refresh_(None)

        def quit_(self, _sender):
            state.request_stop("stopped from menu bar")

    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyAccessory)  # no Dock icon, no focus steal
    controller = Controller.alloc().init().setup()  # noqa: F841 (keep a reference)
    AppHelper.runEventLoop()
    NSStatusBar.systemStatusBar().removeStatusItem_(controller.item)


def cmd_run(args):
    cfg = load_config()
    if args.debug:
        DEBUG_DIR.mkdir(exist_ok=True)
    if not cfg.get("absolute") and find_window(args.app_name) is None:
        sys.exit("iPhone Mirroring window not found. Open it first (or re-run calibrate).")

    hotkey = None
    if args.hotkey != "none":
        if not Hotkey.ensure_permission():
            print("! Hotkey needs 'Input Monitoring' permission for your Terminal:\n"
                  "  System Settings > Privacy & Security > Input Monitoring, enable it,\n"
                  "  then quit and reopen the Terminal. Running without the hotkey for now.")
        else:
            hotkey = Hotkey(args.hotkey)

    state = BotState(paused=args.start_paused, dry_run=args.dry_run, sound=not args.no_sound)
    print("Running" + (" (dry run, no taps)" if args.dry_run else "") +
          ". Stop: mouse to top-left screen corner, menu bar > 停止 Bot, or Ctrl+C.")
    if hotkey:
        print(f"Pause / resume: press {args.hotkey}." + ("  Starting PAUSED." if state.paused else ""))
    if not args.dry_run:
        os.system('osascript -e \'tell application id "%s" to activate\' >/dev/null 2>&1' % BUNDLE_ID)
        time.sleep(0.4)

    # Ctrl+C only sets a flag; the loop / menu bar timer pick it up.
    signal.signal(signal.SIGINT, lambda *_: state.request_stop("Ctrl+C"))
    worker = threading.Thread(target=bot_loop, args=(args, cfg, state, hotkey), daemon=True)
    worker.start()

    menubar = False
    if not args.no_menubar:
        try:
            run_menubar(state, worker)
            menubar = True
        except ImportError as e:
            print(f"! Menu bar status unavailable ({e}); running without it.")
    if not menubar:
        while worker.is_alive() and not state.stop:
            time.sleep(0.2)
    state.request_stop("done")
    worker.join(timeout=2)
    print(f"\nStopped: {state.stop_reason}.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app-name", help="window owner name if auto-detect fails (e.g. 'iPhone Mirroring')")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("calibrate", help="mark the arrow bar and the 4 buttons")
    c.add_argument("--image", help="calibrate by clicking on a screenshot of the dance game instead of live")
    sub.add_parser("windows", help="list visible windows (diagnose 'window not found')")

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
    r.add_argument("--no-menubar", action="store_true", help="no status light in the menu bar")

    t = sub.add_parser("test", help="run detection on a screenshot file")
    t.add_argument("image")
    t.add_argument("--roi", help="pixel crop X0,Y0,X1,Y1 of the arrow row")
    t.add_argument("--out", help="write an annotated crop here")

    args = ap.parse_args()
    try:
        {"calibrate": cmd_calibrate, "run": cmd_run, "test": cmd_test, "windows": cmd_windows}[args.cmd](args)
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.")


if __name__ == "__main__":
    main()
