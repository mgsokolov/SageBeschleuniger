// Track the current whip target.
//
// SageBeschleuniger was originally wired to find a Sage window by name.
// The universal build instead tracks the most recently active top-level
// window — the one the user was actually working with — so the whip can
// shake any foreground application.
//
// Behaviour:
//   start()   — begin polling foreground window every 200ms.
//   stop()    — stop polling (no-op if already stopped).
//   current() — return the last-known suitable target, refreshing its rect
//               and liveness flags. Returns null if the hwnd is gone.
//   capture() — force a foreground read now (e.g. when user clicks tray).

const path = require('path');
const win32 = require('./win32');
const logger = require('./logger');

const BLOCK_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow',
  'ApplicationFrameWindow',
  'IME',
  'MSCTFIME UI',
  'Default IME',
]);
const SELF_EXE_PATTERNS = [/sagebeschleuniger/i, /^electron\.exe$/i];

let lastTarget = null;
let timer = null;

function describe(hwnd) {
  if (!hwnd) return null;
  try {
    const title = win32.getWindowTitle(hwnd);
    const pid = win32.getProcessId(hwnd);
    const image = win32.getProcessImageName(pid);
    const exe = image ? path.basename(image) : '';
    const cls = win32.getClassName(hwnd);
    const rect = win32.getWindowRect(hwnd);
    const visible = win32.isWindowVisible(hwnd);
    const minimized = win32.isMinimized(hwnd);
    return { hwnd, title, pid, image, exe, cls, rect, visible, minimized };
  } catch (err) {
    logger.debug('describe() failed:', err.message);
    return null;
  }
}

function isSuitable(info) {
  if (!info) return false;
  if (!info.visible || info.minimized) return false;
  if (!info.rect) return false;
  if (info.rect.width < 80 || info.rect.height < 60) return false;
  if (BLOCK_CLASSES.has(info.cls)) return false;
  for (const p of SELF_EXE_PATTERNS) {
    if (p.test(info.exe)) return false;
  }
  return true;
}

function readForeground() {
  let hwnd = win32.foregroundWindow();
  if (!hwnd) return null;
  // Climb to the root owner so we track the actual main window, not a
  // transient popup. rootOwnerOf() returns the input for plain top-levels.
  try {
    const root = win32.rootOwnerOf(hwnd);
    if (root) hwnd = root;
  } catch {
    /* ignore */
  }
  const info = describe(hwnd);
  return isSuitable(info) ? info : null;
}

function refresh() {
  const fresh = readForeground();
  if (fresh) lastTarget = fresh;
  return lastTarget;
}

function start() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, 200);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function current() {
  if (!lastTarget || !lastTarget.hwnd) return null;
  // Refresh rect/visibility on the hwnd we already locked in. If it has
  // disappeared, fall back to whichever window is now in the foreground.
  const fresh = describe(lastTarget.hwnd);
  if (fresh && isSuitable(fresh)) {
    lastTarget = fresh;
    return lastTarget;
  }
  const fg = readForeground();
  if (fg) lastTarget = fg;
  else lastTarget = null;
  return lastTarget;
}

function capture() {
  return refresh();
}

module.exports = { start, stop, current, capture };
