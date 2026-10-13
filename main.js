const { app, BrowserWindow, shell, ipcMain, dialog, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const WA_SERVER = 'http://127.0.0.1:3001';
let mainWindow;
let qrWindow;
let serverProcess;
let statusInterval;

// ── Start WhatsApp backend server ────────────────────────────────
function startServer() {
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'index.js')
    : path.join(__dirname, 'server', 'index.js');

  serverProcess = utilityProcess.fork(serverPath, [], {
    serviceName: 'WhatsApp backend',
    stdio: 'pipe',
    env: { ...process.env }
  });
  serverProcess.stdout?.on('data', chunk => console.log(`[WhatsApp backend] ${chunk.toString().trimEnd()}`));
  serverProcess.stderr?.on('data', chunk => console.error(`[WhatsApp backend] ${chunk.toString().trimEnd()}`));
  serverProcess.on('exit', code => console.log('WhatsApp backend exited:', code));
}

// ── Poll server status ───────────────────────────────────────────
function pollStatus() {
  http.get(`${WA_SERVER}/status`, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const { connected, qrReady, connectionState } = JSON.parse(data);
        if (mainWindow) mainWindow.webContents.send('wa-status', { connected, qrReady, connectionState });
        if (qrReady && !qrWindow) openQRWindow();
        if (connected && qrWindow) { qrWindow.close(); qrWindow = null; }
      } catch {}
    });
  }).on('error', () => {
    if (mainWindow) mainWindow.webContents.send('wa-status', { connected: false, qrReady: false });
  });
}

// ── QR Window ────────────────────────────────────────────────────
function openQRWindow() {
  if (qrWindow) return;
  qrWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    title: 'Connect WhatsApp - Scan QR',
    parent: mainWindow,
    modal: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  qrWindow.setMenuBarVisibility(false);
  qrWindow.loadURL(`${WA_SERVER}/qr`);
  qrWindow.on('closed', () => qrWindow = null);
}

ipcMain.on('open-qr', () => openQRWindow());

ipcMain.handle('wa-disconnect', () => new Promise((resolve, reject) => {
  const req = http.request(`${WA_SERVER}/disconnect`, { method: 'POST', headers: { 'Content-Length': 0 } }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
  });
  req.on('error', reject); req.end();
}));

ipcMain.handle('wa-reconnect', () => new Promise((resolve, reject) => {
  const req = http.request(`${WA_SERVER}/reconnect`, { method: 'POST', headers: { 'Content-Length': 0 } }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
  });
  req.on('error', reject); req.end();
}));
ipcMain.handle('check-update', () => checkForUpdate(true));
ipcMain.handle('save-bill-pdf', async (event, { html, billNo }) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('PDF export is only available from the main app window');
  if (typeof html !== 'string' || html.length > 5_000_000) throw new Error('Invalid bill content');

  const safeBillNo = typeof billNo === 'string' ? billNo.replace(/[<>:"/\\|?*]/g, '-') : 'Bill';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Bill as PDF',
    defaultPath: `${safeBillNo}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { canceled: true };

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await pdfWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      marginsType: 0
    });
    await fs.promises.writeFile(filePath, pdf);
    return { canceled: false, filePath };
  } finally {
    pdfWindow.close();
  }
});

// ── Main Window ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Shop Manager',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only open external browser for real http/https URLs — never for the local WA server
    if ((url.startsWith('http://') || url.startsWith('https://')) && !url.startsWith(WA_SERVER)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // poll WhatsApp status every 3 seconds
  statusInterval = setInterval(pollStatus, 3000);
  // initial check after server warms up
  setTimeout(pollStatus, 2000);
}

// ── Auto-update ──────────────────────────────────────────────────
const RELEASES_API = 'https://api.github.com/repos/Deepansri94/Business-Application/releases/latest';
const os = require('os');

function send(event, payload) {
  if (mainWindow) mainWindow.webContents.send(event, payload);
}

const ALLOWED_REDIRECT_HOSTS = ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'];

function httpsGet(url, headers, callback) {
  let opts;
  try { opts = new URL(url); } catch { return callback(new Error('Invalid URL')); }
  if (opts.protocol !== 'https:') return callback(new Error('Only HTTPS allowed'));
  const req = https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers }, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      let redir;
      try { redir = new URL(res.headers.location); } catch { return callback(new Error('Invalid redirect URL')); }
      if (!ALLOWED_REDIRECT_HOSTS.includes(redir.hostname)) return callback(new Error('Redirect to untrusted host blocked'));
      return httpsGet(res.headers.location, {}, callback);
    }
    callback(null, res);
  });
  req.on('error', err => callback(err));
  req.end();
}

function checkForUpdate(manual = false) {
  httpsGet(RELEASES_API, {
    'User-Agent': 'ShopManager-App',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }, (err, res) => {
    if (err) {
      if (manual) send('update-result', { status: 'error' });
      return;
    }
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        const tag = release.tag_name || '';
        if (!tag.startsWith('build-')) {
          if (manual) send('update-result', { status: 'up-to-date' });
          return;
        }
        const remoteCode = parseInt(tag.replace('build-', ''), 10);
        const localCode = parseInt(app.getVersion().split('.')[2] || '0', 10);
        if (remoteCode > localCode) {
          const asset = (release.assets || []).find(a => a.name.endsWith('.exe'));
          if (!asset) {
            if (manual) send('update-result', { status: 'error' });
            return;
          }
          const promptAndDownload = () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Update Available',
              message: `Shop Manager ${release.name} is available!`,
              detail: 'The installer will be downloaded to your Downloads folder. Run it to update.',
              buttons: ['Download & Install', 'Later'],
              defaultId: 0,
              cancelId: 1
            }).then(({ response }) => {
              if (response === 0) downloadAndOpen(asset.browser_download_url, release.name, manual);
              else if (manual) send('update-result', { status: 'cancelled' });
            });
          };
          if (manual) send('update-result', { status: 'available', version: release.name });
          promptAndDownload();
        } else {
          if (manual) send('update-result', { status: 'up-to-date' });
        }
      } catch {
        if (manual) send('update-result', { status: 'error' });
      }
    });
  });
}

function downloadAndOpen(url, versionName, manual) {
  if (manual) send('update-result', { status: 'downloading' });
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const dest = path.join(downloadsDir, 'ShopManager-Setup.exe');
  if (!dest.startsWith(downloadsDir + path.sep) && dest !== path.join(downloadsDir, 'ShopManager-Setup.exe')) {
    if (manual) send('update-result', { status: 'error' });
    return;
  }
  const file = fs.createWriteStream(dest);

  httpsGet(url, { 'User-Agent': 'ShopManager-App', 'Accept': 'application/octet-stream' }, (err, res) => {
    if (err) {
      file.close();
      if (manual) send('update-result', { status: 'error' });
      return;
    }
    res.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        if (manual) send('update-result', { status: 'done' });
        // open the installer — user just clicks Next/Install, no GitHub needed
        shell.openPath(dest);
      });
    });
    file.on('error', () => {
      fs.unlink(dest, () => {});
      if (manual) send('update-result', { status: 'error' });
    });
  });
}

app.whenReady().then(() => {
  startServer();
  setTimeout(createWindow, 1800);
});

app.on('window-all-closed', () => {
  if (statusInterval) clearInterval(statusInterval);
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
