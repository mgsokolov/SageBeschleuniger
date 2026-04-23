// Window shake animation.
// Reads the original window position, bounces it horizontally a few times,
// and always restores the exact original top-left. Uses SetWindowPos with
// SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER so the Sage window is never
// resized, re-z-ordered, or focus-stolen.

const win32 = require('./win32');
const logger = require('./logger');

const DEFAULTS = {
  amplitude: 14, // px per bounce (start value)
  bounces: 6, // number of horizontal movements
  stepMs: 22, // ms between steps (→ total ~130 ms for 6 bounces)
  decay: 0.8, // per-bounce amplitude multiplier
  minRateMs: 60, // minimum interval between shakes on the same window
};

// Concurrency / rate-limit state keyed by hwnd address.
const state = new Map(); // address -> { inFlight: bool, lastStart: ms }

function hwndKey(hwnd) {
  try {
    if (hwnd && typeof hwnd === 'object' && 'address' in hwnd) {
      return String(hwnd.address());
    }
  } catch {
    // fall through
  }
  return String(hwnd);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampToVirtualBounds(x, y, width, height, screensBounds) {
  if (!screensBounds) return { x, y };
  // Keep at least 40px of the window within any screen bounds union box.
  const minX = screensBounds.minX - width + 40;
  const maxX = screensBounds.maxX - 40;
  const minY = screensBounds.minY - height + 40;
  const maxY = screensBounds.maxY - 40;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

async function shakeWindow(hwnd, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  if (!hwnd) return false;

  const key = hwndKey(hwnd);
  const s = state.get(key) || { inFlight: false, lastStart: 0 };
  const now = Date.now();

  if (s.inFlight) {
    logger.debug('shake skipped (already in flight)', key);
    return false;
  }
  if (now - s.lastStart < cfg.minRateMs) {
    logger.debug('shake skipped (rate-limited)', key);
    return false;
  }

  const rect = win32.getWindowRect(hwnd);
  if (!rect) {
    logger.debug('shake aborted: GetWindowRect failed', key);
    return false;
  }

  s.inFlight = true;
  s.lastStart = now;
  state.set(key, s);

  const originX = rect.left;
  const originY = rect.top;
  const width = rect.width;
  const height = rect.height;

  try {
    let amp = cfg.amplitude;
    for (let i = 0; i < cfg.bounces; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const offset = Math.round(amp) * dir;
      const target = clampToVirtualBounds(
        originX + offset,
        originY,
        width,
        height,
        opts.screensBounds
      );
      win32.moveWindowNoActivate(hwnd, target.x, target.y);
      await sleep(cfg.stepMs);
      amp *= cfg.decay;
    }
  } catch (err) {
    logger.warn('shake error:', err.message);
  } finally {
    // Always restore original position, even if something above threw.
    try {
      win32.moveWindowNoActivate(hwnd, originX, originY);
    } catch (err) {
      logger.warn('shake restore failed:', err.message);
    }
    s.inFlight = false;
    state.set(key, s);
  }
  return true;
}

module.exports = { shakeWindow };
