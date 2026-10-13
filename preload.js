const electron = require('electron');
const contextBridge = electron.contextBridge;
const ipcRenderer = electron.ipcRenderer;

contextBridge.exposeInMainWorld('electronAPI', {
  openQR: () => ipcRenderer.send('open-qr'),
  saveBillPDF: (html, billNo) => ipcRenderer.invoke('save-bill-pdf', { html, billNo }),
  onWAStatus: (callback) => ipcRenderer.on('wa-status', (_, data) => callback(data)),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  onUpdateResult: (callback) => ipcRenderer.on('update-result', (_, data) => callback(data)),
  disconnectWA: () => ipcRenderer.invoke('wa-disconnect'),
  reconnectWA: () => ipcRenderer.invoke('wa-reconnect')
});
