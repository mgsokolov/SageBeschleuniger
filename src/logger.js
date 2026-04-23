const DEBUG = process.env.SAGEBESCHLEUNIGER_DEBUG === '1';

function info(...args) {
  console.log('[sagebeschleuniger]', ...args);
}

function warn(...args) {
  console.warn('[sagebeschleuniger]', ...args);
}

function error(...args) {
  console.error('[sagebeschleuniger]', ...args);
}

function debug(...args) {
  if (!DEBUG) return;
  console.log('[sagebeschleuniger:debug]', ...args);
}

module.exports = { info, warn, error, debug, DEBUG };
