// Locate the Sage target window.
// Strategy (configurable):
//   1. Enumerate all top-level windows.
//   2. Keep windows that either
//        - have a title matching the title pattern, or
//        - belong to a process whose image name matches the process pattern.
//   3. Drop owned/child windows, invisible windows, tiny windows, and minimized.
//   4. Rank: foreground match > larger area. Return best candidate.

const path = require('path');
const win32 = require('./win32');
const logger = require('./logger');

const DEFAULT_TITLE_PATTERNS = [/sage/i];
const DEFAULT_PROCESS_PATTERNS = [/sage/i];

// Exclude our own and clearly unrelated windows.
const TITLE_BLOCKLIST = [/sagebeschleuniger/i];
const PROCESS_BLOCKLIST = [/electron\.exe$/i, /sagebeschleuniger/i];
// Window classes that are never our target (shell, system UI, …).
const CLASS_BLOCKLIST = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'IME',
  'MSCTFIME UI',
  'Default IME',
]);

const MIN_AREA = 100 * 100; // ignore anything smaller than this

function matchesAny(patterns, value) {
  if (!value) return false;
  for (const p of patterns) {
    if (p.test(value)) return true;
  }
  return false;
}

function describe(hwnd) {
  try {
    const title = win32.getWindowTitle(hwnd);
    const pid = win32.getProcessId(hwnd);
    const image = win32.getProcessImageName(pid);
    const exe = image ? path.basename(image) : '';
    const cls = win32.getClassName(hwnd);
    const visible = win32.isWindowVisible(hwnd);
    const minimized = win32.isMinimized(hwnd);
    const owned = win32.hasOwner(hwnd);
    const rect = win32.getWindowRect(hwnd);
    return { hwnd, title, pid, image, exe, cls, visible, minimized, owned, rect };
  } catch (err) {
    logger.debug('describe() failed:', err.message);
    return null;
  }
}

function findSageWindow(options = {}) {
  const titlePatterns = options.titlePatterns || DEFAULT_TITLE_PATTERNS;
  const processPatterns = options.processPatterns || DEFAULT_PROCESS_PATTERNS;

  const handles = win32.enumTopLevelWindows();
  const fg = win32.foregroundWindow();

  const candidates = [];
  for (const h of handles) {
    const info = describe(h);
    if (!info) continue;
    if (!info.visible || info.minimized || info.owned) continue;
    if (!info.rect) continue;
    if (info.rect.width * info.rect.height < MIN_AREA) continue;
    if (CLASS_BLOCKLIST.has(info.cls)) continue;
    if (matchesAny(TITLE_BLOCKLIST, info.title)) continue;
    if (matchesAny(PROCESS_BLOCKLIST, info.exe)) continue;

    const titleMatch = matchesAny(titlePatterns, info.title);
    const processMatch = matchesAny(processPatterns, info.exe);
    if (!titleMatch && !processMatch) continue;

    candidates.push({ ...info, titleMatch, processMatch });
  }

  logger.debug(
    'sage candidates:',
    candidates.map((c) => ({
      title: c.title,
      exe: c.exe,
      cls: c.cls,
      size: c.rect.width + 'x' + c.rect.height,
    }))
  );

  if (candidates.length === 0) return null;

  // Rank: foreground match first, otherwise largest area.
  candidates.sort((a, b) => {
    const aFg = fg && a.hwnd && sameHwnd(a.hwnd, fg) ? 1 : 0;
    const bFg = fg && b.hwnd && sameHwnd(b.hwnd, fg) ? 1 : 0;
    if (aFg !== bFg) return bFg - aFg;
    const aScore = (a.processMatch ? 1 : 0) + (a.titleMatch ? 1 : 0);
    const bScore = (b.processMatch ? 1 : 0) + (b.titleMatch ? 1 : 0);
    if (aScore !== bScore) return bScore - aScore;
    const aArea = a.rect.width * a.rect.height;
    const bArea = b.rect.width * b.rect.height;
    return bArea - aArea;
  });

  return candidates[0];
}

// hwnd values come back from koffi as opaque pointers; compare via their
// numeric address cast. Easiest portable check: use `==` via Buffer/ptr helpers.
function sameHwnd(a, b) {
  if (a === b) return true;
  try {
    // koffi pointer objects expose .address() in recent versions; fall back to string.
    const sa = a && typeof a === 'object' && 'address' in a ? a.address() : String(a);
    const sb = b && typeof b === 'object' && 'address' in b ? b.address() : String(b);
    return sa === sb;
  } catch {
    return false;
  }
}

module.exports = { findSageWindow };
