const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  // Renderer -> main
  whipHit: (point) => ipcRenderer.send('sage:whip-hit', point),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  requestTargetRefresh: () => ipcRenderer.send('sage:refresh-target'),

  // Main -> renderer
  onSpawnWhip: (fn) => ipcRenderer.on('overlay:spawn-whip', () => fn()),
  onDropWhip: (fn) => ipcRenderer.on('overlay:drop-whip', () => fn()),
  onTargetUpdate: (fn) =>
    ipcRenderer.on('sage:target-update', (_ev, payload) => fn(payload)),
  onHitFeedback: (fn) =>
    ipcRenderer.on('sage:hit-feedback', (_ev, payload) => fn(payload)),
});
