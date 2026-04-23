// Thin wrapper around Win32 APIs used by SageBeschleuniger.
// Exposes window enumeration, process lookup, rect queries, and non-activating
// window movement – everything needed to locate and shake the Sage window.
//
// Windows-only. Throws on other platforms.

const logger = require('./logger');

if (process.platform !== 'win32') {
  throw new Error('win32 helper loaded on non-Windows platform');
}

let koffi;
try {
  koffi = require('koffi');
} catch (err) {
  throw new Error(
    'Failed to load "koffi". Install dependencies with: npm install (error: ' +
      err.message +
      ')'
  );
}

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// Type aliases for readability.
const HWND = 'void*';
const HANDLE = 'void*';
const DWORD_PTR = 'uintptr_t';
const LPARAM = 'intptr_t';

// RECT { long left; long top; long right; long bottom; }
const RECT = koffi.struct('RECT', {
  left: 'int32_t',
  top: 'int32_t',
  right: 'int32_t',
  bottom: 'int32_t',
});

// EnumWindows callback: BOOL (__stdcall *WNDENUMPROC)(HWND, LPARAM)
const WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(void*, intptr_t)');

const EnumWindows = user32.func(
  'bool __stdcall EnumWindows(WNDENUMPROC*, intptr_t)'
);
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void*)');
const IsIconic = user32.func('bool __stdcall IsIconic(void*)');
const GetWindow = user32.func('void* __stdcall GetWindow(void*, uint32_t)');
const GetWindowTextLengthW = user32.func(
  'int __stdcall GetWindowTextLengthW(void*)'
);
const GetWindowTextW = user32.func(
  'int __stdcall GetWindowTextW(void*, _Out_ uint16_t *lpString, int nMaxCount)'
);
const GetClassNameW = user32.func(
  'int __stdcall GetClassNameW(void*, _Out_ uint16_t *lpClassName, int nMaxCount)'
);
const GetWindowThreadProcessId = user32.func(
  'uint32_t __stdcall GetWindowThreadProcessId(void*, _Out_ uint32_t *lpdwProcessId)'
);
const GetWindowRect = user32.func(
  'bool __stdcall GetWindowRect(void*, _Out_ RECT *lpRect)'
);
const SetWindowPos = user32.func(
  'bool __stdcall SetWindowPos(void*, void*, int32_t, int32_t, int32_t, int32_t, uint32_t)'
);
const GetForegroundWindow = user32.func(
  'void* __stdcall GetForegroundWindow()'
);
const GetAncestor = user32.func('void* __stdcall GetAncestor(void*, uint32_t)');

const OpenProcess = kernel32.func(
  'void* __stdcall OpenProcess(uint32_t, bool, uint32_t)'
);
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void*)');
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(void*, uint32_t, _Out_ uint16_t *lpExeName, _Inout_ uint32_t *lpdwSize)'
);

// Constants
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SWP_NOSIZE = 0x0001;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_ASYNCWINDOWPOS = 0x4000;
const GW_OWNER = 4;
const GA_ROOT = 2;

// Decode null-terminated UTF-16 buffer.
function decodeWide(buf, maxLen) {
  let end = maxLen;
  for (let i = 0; i < maxLen; i++) {
    if (buf[i] === 0) {
      end = i;
      break;
    }
  }
  const slice = buf.subarray(0, end);
  // koffi returns a Uint16Array; convert to Buffer for toString('utf16le').
  const bytes = Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength);
  return bytes.toString('utf16le');
}

function getWindowTitle(hwnd) {
  const len = GetWindowTextLengthW(hwnd);
  if (!len || len <= 0) return '';
  const size = len + 1;
  const buf = new Uint16Array(size);
  const read = GetWindowTextW(hwnd, buf, size);
  if (read <= 0) return '';
  return decodeWide(buf, read);
}

function getClassName(hwnd) {
  const size = 256;
  const buf = new Uint16Array(size);
  const read = GetClassNameW(hwnd, buf, size);
  if (read <= 0) return '';
  return decodeWide(buf, read);
}

function getProcessId(hwnd) {
  const out = [0];
  GetWindowThreadProcessId(hwnd, out);
  return out[0] >>> 0;
}

function getProcessImageName(pid) {
  if (!pid) return '';
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!h) return '';
  try {
    const size = 1024;
    const buf = new Uint16Array(size);
    const lenBox = [size];
    const ok = QueryFullProcessImageNameW(h, 0, buf, lenBox);
    if (!ok) return '';
    return decodeWide(buf, lenBox[0]);
  } finally {
    CloseHandle(h);
  }
}

function getWindowRect(hwnd) {
  const r = {};
  const ok = GetWindowRect(hwnd, r);
  if (!ok) return null;
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.right - r.left,
    height: r.bottom - r.top,
  };
}

function isWindowVisible(hwnd) {
  return !!IsWindowVisible(hwnd);
}

function isMinimized(hwnd) {
  return !!IsIconic(hwnd);
}

function hasOwner(hwnd) {
  return !!GetWindow(hwnd, GW_OWNER);
}

function rootOwnerOf(hwnd) {
  return GetAncestor(hwnd, GA_ROOT);
}

function foregroundWindow() {
  return GetForegroundWindow();
}

// Iterate every top-level window; return array of raw { hwnd } handles.
function enumTopLevelWindows() {
  const handles = [];
  const cb = koffi.register((hwnd /* intptr_t */ /* , lparam */) => {
    handles.push(hwnd);
    return true;
  }, koffi.pointer(WNDENUMPROC));
  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  return handles;
}

// Move the window without activating/resizing. Returns true on success.
function moveWindowNoActivate(hwnd, x, y) {
  const flags = SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS;
  const ok = SetWindowPos(hwnd, null, x, y, 0, 0, flags);
  if (!ok) {
    logger.debug('SetWindowPos returned false for hwnd', hwnd);
  }
  return !!ok;
}

module.exports = {
  enumTopLevelWindows,
  getWindowTitle,
  getClassName,
  getProcessId,
  getProcessImageName,
  getWindowRect,
  isWindowVisible,
  isMinimized,
  hasOwner,
  rootOwnerOf,
  foregroundWindow,
  moveWindowNoActivate,
};
