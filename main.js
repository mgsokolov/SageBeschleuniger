// SageBeschleuniger main process.
// Windows-only tray app that spawns a fullscreen whip overlay and shakes
// the Sage window each time the whip connects with it.

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog } =
  require('electron');
const path = require('path');

const logger = require('./src/logger');

if (process.platform !== 'win32') {
  // Hard guard: refuse to run on anything but Windows.
  dialogOrConsole(
    'SageBeschleuniger is Windows-only (Windows Server 2019+ / Windows 10+).'
  );
  app.quit();
  process.exit(1);
}

let win32, sageLocator, shakeModule;
try {
  win32 = require('./src/win32');
  sageLocator = require('./src/sageLocator');
  shakeModule = require('./src/shake');
} catch (err) {
  dialogOrConsole(
    'SageBeschleuniger failed to load native Win32 helpers.\n\n' +
      (err && err.message ? err.message : String(err)) +
      '\n\nRun "npm install" and make sure "koffi" is present.'
  );
  app.quit();
  process.exit(1);
}

// ── Globals ─────────────────────────────────────────────────────────────────
let tray = null;
let overlay = null;
let overlayReady = false;
let spawnQueued = false;
let targetTimer = null;
let cachedTarget = null; // { hwnd, rect, title, exe }
let cachedTargetAt = 0;
const TARGET_CACHE_MS = 250;

// ── Tray icon (embedded PNG, no external file required) ─────────────────────
// 32x32 solid-red rounded square PNG, base64 encoded.
// Small enough to ship inline; avoids binary blob dependencies.
const TRAY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA3UlEQVR4nO3aMQrCMBRA0b9F' +
  'LyA4e/8jdXfQUXARpWChWFKTl7zPn7SQPshbkqapKcvylvLcPY3HMv5i9rL6XOKxLm5y7UwA' +
  'mQAyAWQCyASQCSATQCaATACZADIBZALIBJAJIBNAJoBMAJkAMgFkAsgEkAkgE0AmgEwAmQAy' +
  'AWQCyASQCSATQCaATACZADIBZALIBJAJIBNAJoBMAJkAMgFkAsgEkAkgE0AmgEwAmQAyAWQC' +
  'yASQCSATQCaATACZADIBZALIBJAJIBNAJoBMAJkAMgFkAsgEkAkgE0AmgEwAmQAyAWQCyASQ' +
  '7Q3+BjHDlZtJkwAAAABJRU5ErkJggg==';

function trayIconImage() {
  try {
    const buf = Buffer.from(TRAY_PNG_BASE64, 'base64');
    const img = nativeImage.createFromBuffer(buf);
    if (!img.isEmpty()) return img;
  } catch (err) {
    logger.warn('failed to decode embedded tray icon:', err.message);
  }
  return nativeImage.createEmpty();
}

// ── Overlay ─────────────────────────────────────────────────────────────────
function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlayReady = false;
  overlay.loadFile(path.join(__dirname, 'overlay.html'));
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (spawnQueued && overlay && overlay.isVisible()) {
      spawnQueued = false;
      overlay.webContents.send('overlay:spawn-whip');
      pushTargetUpdate(true);
    }
  });
  overlay.on('closed', () => {
    overlay = null;
    overlayReady = false;
    spawnQueued = false;
    stopTargetTimer();
  });
}

function toggleOverlay() {
  if (overlay && overlay.isVisible()) {
    overlay.webContents.send('overlay:drop-whip');
    return;
  }
  if (!overlay) createOverlay();
  overlay.show();
  startTargetTimer();
  if (overlayReady) {
    overlay.webContents.send('overlay:spawn-whip');
    pushTargetUpdate(true);
  } else {
    spawnQueued = true;
  }
}

// ── Target polling ──────────────────────────────────────────────────────────
function resolveTarget(force = false) {
  const now = Date.now();
  if (!force && cachedTarget && now - cachedTargetAt < TARGET_CACHE_MS) {
    return cachedTarget;
  }
  const found = sageLocator.findSageWindow();
  if (!found) {
    cachedTarget = null;
    cachedTargetAt = now;
    return null;
  }
  const rect = win32.getWindowRect(found.hwnd) || found.rect;
  cachedTarget = {
    hwnd: found.hwnd,
    rect,
    title: found.title,
    exe: found.exe,
  };
  cachedTargetAt = now;
  return cachedTarget;
}

function screenRectToDip(rect) {
  if (!rect) return null;
  try {
    const topLeft = screen.screenToDipPoint({ x: rect.left, y: rect.top });
    const bottomRight = screen.screenToDipPoint({
      x: rect.right,
      y: rect.bottom,
    });
    return {
      left: Math.round(topLeft.x),
      top: Math.round(topLeft.y),
      right: Math.round(bottomRight.x),
      bottom: Math.round(bottomRight.y),
      width: Math.round(bottomRight.x - topLeft.x),
      height: Math.round(bottomRight.y - topLeft.y),
    };
  } catch {
    return rect;
  }
}

function pushTargetUpdate(force = false) {
  if (!overlay || overlay.isDestroyed() || !overlayReady) return;
  const target = resolveTarget(force);
  const payload = target
    ? {
        found: true,
        rect: screenRectToDip(target.rect),
        title: target.title,
        exe: target.exe,
      }
    : { found: false };
  overlay.webContents.send('sage:target-update', payload);
}

function startTargetTimer() {
  stopTargetTimer();
  targetTimer = setInterval(() => pushTargetUpdate(false), 200);
}

function stopTargetTimer() {
  if (targetTimer) {
    clearInterval(targetTimer);
    targetTimer = null;
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('sage:whip-hit', async (_ev, point) => {
  try {
    const target = resolveTarget(true);
    if (!target || !target.hwnd) {
      if (overlay && !overlay.isDestroyed()) {
        overlay.webContents.send('sage:hit-feedback', { ok: false, point });
      }
      return;
    }
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('sage:hit-feedback', { ok: true, point });
    }
    await shakeModule.shakeWindow(target.hwnd);
  } catch (err) {
    logger.warn('whip-hit handler failed:', err.message);
  }
});

ipcMain.on('overlay:hide', () => {
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  stopTargetTimer();
});

ipcMain.on('sage:refresh-target', () => {
  pushTargetUpdate(true);
});

// ── Tray menu ───────────────────────────────────────────────────────────────
function buildContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Open Whip',
      click: () => toggleOverlay(),
    },
    {
      label: 'Locate Sage Window',
      click: () => {
        const target = resolveTarget(true);
        if (target) {
          dialog.showMessageBox({
            type: 'info',
            title: 'SageBeschleuniger',
            message: 'Sage window detected.',
            detail:
              'Title: ' +
              (target.title || '(no title)') +
              '\nProcess: ' +
              (target.exe ? path.basename(target.exe) : '(unknown)'),
          });
        } else {
          dialog.showMessageBox({
            type: 'warning',
            title: 'SageBeschleuniger',
            message: 'No Sage window found.',
            detail:
              'Make sure a Sage application is running with a visible window.\n' +
              'Matching is based on window title or process name containing "sage".',
          });
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  try {
    tray = new Tray(trayIconImage());
  } catch (err) {
    logger.error('failed to create tray:', err.message);
    app.quit();
    return;
  }
  tray.setToolTip('SageBeschleuniger - click to whip the Sage window');
  tray.setContextMenu(buildContextMenu());
  tray.on('click', toggleOverlay);
});

app.on('window-all-closed', (e) => e.preventDefault()); // stay alive in tray

app.on('before-quit', () => {
  stopTargetTimer();
  if (overlay && !overlay.isDestroyed()) {
    try {
      overlay.destroy();
    } catch {
      /* ignore */
    }
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function dialogOrConsole(message) {
  try {
    if (app && app.isReady && app.isReady()) {
      dialog.showErrorBox('SageBeschleuniger', message);
      return;
    }
  } catch {
    /* ignore */
  }
  console.error('[sagebeschleuniger]', message);
}
