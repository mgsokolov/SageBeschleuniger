#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');

if (process.platform !== 'win32') {
  console.error('SageBeschleuniger is a Windows-only tool (Windows Server 2019+ / Windows 10+).');
  process.exit(1);
}

let electronBinary;
try {
  electronBinary = require('electron');
} catch (e) {
  console.error('Could not load Electron. Try: npm install -g sagebeschleuniger');
  process.exit(1);
}

const appPath = path.resolve(__dirname, '..');

const child = spawn(electronBinary, [appPath], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});

child.on('error', (err) => {
  console.error('Failed to start SageBeschleuniger:', err.message);
  process.exit(1);
});

child.unref();
