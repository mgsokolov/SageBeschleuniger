// SageBeschleuniger main process.
// Windows-only tray app that spawns a fullscreen whip overlay and shakes
// whichever top-level window was most recently in the foreground.

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog } =
  require('electron');
const path = require('path');

const logger = require('./src/logger');

if (process.platform !== 'win32') {
  dialogOrConsole(
    'SageBeschleuniger is Windows-only (Windows Server 2019+ / Windows 10+).'
  );
  app.quit();
  process.exit(1);
}

let win32, targetTracker, shakeModule;
try {
  win32 = require('./src/win32');
  targetTracker = require('./src/targetTracker');
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
let pushTimer = null;

// ── Tray icon (embedded PNG, no external file required) ─────────────────────
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

// ── Coordinate conversion ───────────────────────────────────────────────────
// GetWindowRect returns physical screen pixels; the overlay operates in DIPs.
function screenRectToDip(rect) {
  if (!rect) return null;
  try {
    const tl = screen.screenToDipPoint({ x: rect.left, y: rect.top });
    const br = screen.screenToDipPoint({ x: rect.right, y: rect.bottom });
    return {
      left: Math.round(tl.x),
      top: Math.round(tl.y),
      right: Math.round(br.x),
      bottom: Math.round(br.y),
      width: Math.round(br.x - tl.x),
      height: Math.round(br.y - tl.y),
    };
  } catch {
    return rect;
  }
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
    stopPushTimer();
  });
}

function toggleOverlay() {
  // Lock in the user's actual foreground app BEFORE showing the overlay,
  // so the tray click itself cannot race us.
  targetTracker.capture();

  if (overlay && overlay.isVisible()) {
    overlay.webContents.send('overlay:drop-whip');
    return;
  }
  if (!overlay) createOverlay();
  overlay.show();
  startPushTimer();
  if (overlayReady) {
    overlay.webContents.send('overlay:spawn-whip');
    pushTargetUpdate(true);
  } else {
    spawnQueued = true;
  }
}

// ── Target polling ──────────────────────────────────────────────────────────
function pushTargetUpdate(force = false) {
  if (!overlay || overlay.isDestroyed() || !overlayReady) return;
  const target = targetTracker.current();
  const payload = target
    ? {
        found: true,
        rect: screenRectToDip(target.rect),
        title: target.title,
        exe: target.exe,
      }
    : { found: false };
  overlay.webContents.send('sage:target-update', payload);
  if (force) {
    // no-op; included for symmetry with the previous API
  }
}

function startPushTimer() {
  stopPushTimer();
  pushTimer = setInterval(() => pushTargetUpdate(false), 200);
}

function stopPushTimer() {
  if (pushTimer) {
    clearInterval(pushTimer);
    pushTimer = null;
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('sage:whip-hit', async (_ev, point) => {
  try {
    const target = targetTracker.current();
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
  stopPushTimer();
});

ipcMain.on('sage:refresh-target', () => {
  targetTracker.capture();
  pushTargetUpdate(true);
});

// ── Tray menu ───────────────────────────────────────────────────────────────
function buildContextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Whip', click: () => toggleOverlay() },
    {
      label: 'Identify Current Target',
      click: () => {
        const target = targetTracker.capture() || targetTracker.current();
        if (target) {
          dialog.showMessageBox({
            type: 'info',
            title: 'SageBeschleuniger',
            message: 'Current whip target',
            detail:
              'Title: ' +
              (target.title || '(no title)') +
              '\nProcess: ' +
              (target.exe || '(unknown)'),
          });
        } else {
          dialog.showMessageBox({
            type: 'warning',
            title: 'SageBeschleuniger',
            message: 'No target window found.',
            detail:
              'Bring the application you want to whip to the foreground, ' +
              'then reopen this menu.',
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
  tray.setToolTip('SageBeschleuniger - whip the active window');
  tray.setContextMenu(buildContextMenu());
  tray.on('click', toggleOverlay);
  targetTracker.start();
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', () => {
  stopPushTimer();
  targetTracker.stop();
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
