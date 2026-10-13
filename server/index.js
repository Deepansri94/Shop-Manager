const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');

const app = express();
const ALLOWED_ORIGINS = ['http://localhost:3001', 'http://127.0.0.1:3001'];
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)) }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Forbidden' });
  next();
});
app.use(express.json({ limit: '1mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

let sock = null;
let qrCodeData = null;
let isConnected = false;
let connectionState = 'starting';
let connectionError = null;
let manualDisconnect = false;

// persist auth in user home so it survives app updates
const AUTH_DIR = path.join(os.homedir(), '.shopmanager', 'auth_info');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

async function connectWhatsApp() {
  connectionState = 'initializing';
  connectionError = null;
  try {
    const baileys = require('@whiskeysockets/baileys');
    const pino = require('pino');

    const makeWASocket = baileys.default || baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version, isLatest, error } = await fetchLatestBaileysVersion({ timeout: 10000 });
    if (!isLatest) console.warn('Could not fetch latest WhatsApp version; using Baileys fallback:', error?.message);

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['Shop Manager', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        qrCodeData = qr;
        isConnected = false;
        connectionState = 'qr';
        connectionError = null;
      }
      if (connection === 'open') {
        isConnected = true;
        qrCodeData = null;
        connectionState = 'connected';
        connectionError = null;
        console.log('✅ WhatsApp connected!');
      }
      if (connection === 'close') {
        isConnected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = !manualDisconnect && code !== DisconnectReason.loggedOut;
        connectionState = manualDisconnect ? 'disconnected' : (shouldReconnect ? 'reconnecting' : 'logged-out');
        connectionError = manualDisconnect ? null : (lastDisconnect?.error?.message || `Connection closed (${code || 'unknown reason'})`);
        console.log('Connection closed. Reconnect:', shouldReconnect, 'Code:', code);
        if (shouldReconnect) setTimeout(connectWhatsApp, 3000);
      }
      if (connection === 'connecting') connectionState = 'connecting';
    });
  } catch (err) {
    connectionState = 'retrying';
    connectionError = err.message;
    console.error('WhatsApp init error:', err.message);
    setTimeout(connectWhatsApp, 5000);
  }
}

// ── QR Page ──────────────────────────────────────────────────────
app.get('/qr', async (req, res) => {
  if (isConnected) return res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#f0fdf4">
    <h2 style="color:#16a34a">✅ WhatsApp Connected!</h2>
    <p style="color:#64748b">You can close this window and use the app.</p>
    </body></html>`);

  if (!qrCodeData) return res.send(`
    <html><head><meta http-equiv="refresh" content="3">
    <style>body{font-family:sans-serif;text-align:center;padding:60px;background:#fefce8}h2{color:#854d0e}p{color:#64748b}.error{color:#b91c1c;font-size:.9rem;max-width:460px;margin:18px auto}</style>
    </head>
    <body>
    <h2>⏳ ${connectionState === 'retrying' ? 'Retrying WhatsApp connection...' : connectionState === 'reconnecting' ? 'Reconnecting to WhatsApp...' : connectionState === 'logged-out' ? 'WhatsApp logged out' : 'Connecting to WhatsApp...'}</h2>
    <p>${connectionState === 'logged-out' ? 'This linked device was logged out. Remove it from Linked Devices on your phone, then restart the app to connect again.' : 'The QR code will appear here when WhatsApp is ready. This page refreshes automatically.'}</p>
    ${connectionError ? `<p class="error">Connection detail: ${connectionError.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[ch])}</p>` : ''}
    </body></html>`);

  const imgSrc = await qrcode.toDataURL(qrCodeData);
  res.send(`<!DOCTYPE html><html>
    <head><title>Scan QR - Shop Manager</title><meta http-equiv="refresh" content="20">
    <style>
      body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;padding:40px;background:#f0f4f8}
      h2{color:#1e293b;margin-bottom:6px}
      p{color:#64748b;margin-bottom:20px;font-size:.95rem}
      img{border:4px solid #6366f1;border-radius:12px;width:280px}
      .note{margin-top:14px;font-size:.82rem;color:#94a3b8}
    </style></head>
    <body>
      <h2>📱 Scan with WhatsApp</h2>
      <p>WhatsApp → ⋮ Menu → Linked Devices → Link a Device → Scan</p>
      <img src="${imgSrc}" />
      <p class="note">Auto-refreshes every 20 seconds</p>
    </body></html>`);
});

// ── Status ───────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ connected: isConnected, qrReady: !!qrCodeData, connectionState, connectionError });
});

// ── Disconnect ───────────────────────────────────────────────────
app.post('/disconnect', async (req, res) => {
  manualDisconnect = true;
  qrCodeData = null;
  isConnected = false;
  connectionState = 'disconnected';
  connectionError = null;
  try {
    if (sock) {
      await sock.logout();
      sock = null;
    }
  } catch { sock = null; }
  // wipe saved auth so next connect starts fresh with a new QR
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  } catch (e) { console.error('Auth wipe error:', e.message); }
  res.json({ success: true });
});

// ── Reconnect ────────────────────────────────────────────────────
app.post('/reconnect', async (req, res) => {
  manualDisconnect = false;
  qrCodeData = null;
  isConnected = false;
  connectionState = 'initializing';
  connectionError = null;
  try {
    if (sock) { try { await sock.logout(); } catch {} sock = null; }
  } catch { sock = null; }
  // wipe auth for a clean new session
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  } catch (e) { console.error('Auth wipe error:', e.message); }
  res.json({ success: true });
  setTimeout(connectWhatsApp, 500);
});

// ── Send Bulk ────────────────────────────────────────────────────
app.post('/send-bulk', async (req, res) => {
  const { contacts, message } = req.body;
  if (!isConnected) return res.status(503).json({ success: false, error: 'WhatsApp not connected. Please scan QR first.' });
  if (!contacts?.length || !message) return res.status(400).json({ success: false, error: 'contacts and message required' });

  const results = [];
  for (const c of contacts) {
    try {
      const jid = '91' + c.phone.replace(/\D/g, '').slice(-10) + '@s.whatsapp.net';
      await sock.sendMessage(jid, { text: message });
      results.push({ name: c.name, phone: c.phone, status: 'sent' });
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      results.push({ name: c.name, phone: c.phone, status: 'failed', error: err.message });
    }
  }
  res.json({ success: true, results });
});

// ── Send Bulk Media (with attachment) ─────────────────────────────
app.post('/send-bulk-media', upload.single('attachment'), async (req, res) => {
  let contacts;
  try { contacts = JSON.parse(req.body.contacts || '[]'); } catch { return res.status(400).json({ success: false, error: 'Invalid contacts format' }); }
  const message = req.body.message;
  const file = req.file;

  if (!isConnected) return res.status(503).json({ success: false, error: 'WhatsApp not connected. Please scan QR first.' });
  if (!contacts.length || !message) return res.status(400).json({ success: false, error: 'contacts and message required' });

  const isImage = file && file.mimetype.startsWith('image/');
  const isPDF = file && file.mimetype === 'application/pdf';

  const results = [];
  for (const c of contacts) {
    try {
      const jid = '91' + c.phone.replace(/\D/g, '').slice(-10) + '@s.whatsapp.net';
      if (file && isImage) {
        await sock.sendMessage(jid, { image: file.buffer, caption: message, mimetype: file.mimetype });
      } else if (file && isPDF) {
        await sock.sendMessage(jid, { document: file.buffer, caption: message, mimetype: 'application/pdf', fileName: file.originalname || 'document.pdf' });
      } else {
        await sock.sendMessage(jid, { text: message });
      }
      results.push({ name: c.name, phone: c.phone, status: 'sent' });
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      results.push({ name: c.name, phone: c.phone, status: 'failed', error: err.message });
    }
  }
  res.json({ success: true, results });
});

const PORT = 3001;
app.listen(PORT, '127.0.0.1', () => console.log(`WA Server running on port ${PORT}`));
connectWhatsApp();
