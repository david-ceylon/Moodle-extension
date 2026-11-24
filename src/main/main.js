'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, shell, dialog, Notification, safeStorage, nativeTheme, clipboard } = require('electron');

const { Store } = require('./store');
const { MoodleClient, normalizeSiteUrl, getPublicConfig, isAuthError } = require('./moodle-client');
const { loginWithBrowser, openMoodlePage, clearAllSessionData } = require('./auth');
const { fetchEverything, buildSnapshot, diff, mergeFeed, filterForNotification, buildNotifications, dueReminders, DEFAULT_NOTIFY } = require('./sync');
const { createDemoClient } = require('./demo');
const QRCode = require('qrcode');

const DEMO_FLAG = process.argv.includes('--demo');
// Permet d'isoler les données (tests, plusieurs comptes) : MOODLEPLUS_USER_DATA=/chemin npm start
if (process.env.MOODLEPLUS_USER_DATA) app.setPath('userData', process.env.MOODLEPLUS_USER_DATA);
// Adresse de la web-app téléphone (publiée par GitHub Pages, voir .github/workflows/web.yml)
const DEFAULT_WEB_APP_URL = 'https://david-ceylon.github.io/Moodle-extension/';
const DEFAULT_SETTINGS = { autoSyncMinutes: 30, notifications: true, theme: 'system', webAppUrl: DEFAULT_WEB_APP_URL, ...DEFAULT_NOTIFY };

let mainWindow = null;
let store = null;
let client = null;
let syncing = null;
let autoSyncTimer = null;
let lastAutologin = 0;

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

function account() {
  return store.get('account', null);
}

function settings() {
  return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
}

function publicState() {
  const acc = account();
  return {
    platform: 'desktop',
    loggedIn: !!acc,
    demo: !!acc?.demo,
    account: acc ? { siteUrl: acc.siteUrl, siteName: acc.siteName } : null,
    data: store.get('data', null),
    feed: store.get('feed', []),
    lastSync: store.get('lastSync', 0),
    settings: settings(),
    syncing: !!syncing,
    version: app.getVersion(),
  };
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function buildClient() {
  const acc = account();
  if (!acc) return null;
  if (acc.demo) return createDemoClient();
  const token = store.getSecret('token');
  if (!token) return null;
  return new MoodleClient(acc.siteUrl, token);
}

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

async function runSync({ silent = false } = {}) {
  if (syncing) return syncing;
  if (!client) client = buildClient();
  if (!client) throw new Error('[notLoggedIn] Non connecté');

  syncing = (async () => {
    send('sync:progress', { text: 'Connexion…', ratio: 0 });
    const now = Math.floor(Date.now() / 1000);
    try {
      if (client.demo && store.get('lastSync', 0)) client.publishSomething();
      const data = await fetchEverything(client, { now, onProgress: (text, ratio) => send('sync:progress', { text, ratio }) });
      if (data.site.user.picture && client.fileUrl) data.site.user.picture = client.fileUrl(data.site.user.picture);

      const prevSnap = store.get('snapshot', null);
      const prevSync = store.get('lastSync', 0);
      const newItems = diff(data, prevSnap, prevSync, now);
      const feed = mergeFeed(store.get('feed', []), newItems);

      store.set('data', data);
      store.set('snapshot', buildSnapshot(data));
      store.set('feed', feed);
      store.set('lastSync', now);

      const acc = account();
      if (acc && acc.siteName !== data.site.name) store.set('account', { ...acc, siteName: data.site.name });

      if (prevSnap && newItems.length) notifyNewItems(newItems, data);
      checkReminders();
      return { newItems: newItems.length };
    } catch (e) {
      send('sync:progress', null);
      if (isAuthError(e)) {
        send('auth:expired', { message: 'Votre session Moodle a expiré. Reconnectez-vous (la 2FA peut être redemandée).' });
      }
      if (!silent) throw e;
      return { error: e.message };
    } finally {
      syncing = null;
      send('sync:progress', null);
      send('state', publicState());
    }
  })();
  return syncing;
}

/** Langue des notifications : celle choisie dans les réglages, sinon celle du système (hébreu, sinon français). */
function notifLang() {
  const l = settings().lang;
  if (l) return l;
  return /^(he|iw)/.test(app.getLocale()) ? 'he' : 'fr';
}

function showNotification(title, body, view) {
  const n = new Notification({ title, body: body || '', silent: false });
  n.on('click', () => {
    if (!mainWindow) createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    send('navigate', { view });
  });
  n.show();
}

function notifyNewItems(items, data) {
  const s = settings();
  if (!s.notifications || !Notification.isSupported()) return;
  const wanted = filterForNotification(items, s);
  for (const n of buildNotifications(wanted, data, 3, notifLang())) showNotification(n.title, n.largeBody || n.body, 'feed');
}

/** Rappels d'échéance (moins de 24 h, puis moins de 2 h) — vérifiés après chaque synchro et toutes les 10 min. */
function checkReminders() {
  const s = settings();
  const data = store.get('data', null);
  if (!data || !s.notifications || !s.notifyReminders || !Notification.isSupported()) return;
  const r = dueReminders(data.deadlines, store.get('sentReminders', {}), Math.floor(Date.now() / 1000), data, notifLang());
  store.set('sentReminders', r.sent);
  for (const n of r.reminders) showNotification(n.title, n.body, 'deadlines');
}

function scheduleAutoSync() {
  clearInterval(autoSyncTimer);
  const minutes = settings().autoSyncMinutes;
  if (!minutes || !account()) return;
  autoSyncTimer = setInterval(() => runSync({ silent: true }).catch(() => {}), minutes * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Fichiers
// ---------------------------------------------------------------------------

function safeName(name) {
  return String(name || 'fichier').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  // Moodle renvoie du JSON d'erreur (et pas le fichier) si le jeton est refusé.
  if (type.includes('application/json') && buf.length < 2000) {
    const j = JSON.parse(buf.toString('utf8'));
    if (j.error || j.exception) throw new Error(j.error || j.message || 'Fichier refusé par Moodle');
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

function cachePathFor(url, name) {
  const clean = String(url).replace(/[?&]token=[^&]+/, '');
  const hash = crypto.createHash('sha1').update(clean).digest('hex').slice(0, 12);
  return path.join(app.getPath('userData'), 'fichiers', hash, safeName(name));
}

function demoFileNotice() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    message: 'Mode démonstration',
    detail: 'Les fichiers de la démo ne sont pas réels. Connectez-vous à votre Moodle pour ouvrir et télécharger vos vrais documents.',
  });
}

// ---------------------------------------------------------------------------
// IPC (appelé depuis l'interface)
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('state:get', () => publicState());

  ipcMain.handle('auth:checkSite', async (_e, input) => {
    const siteUrl = normalizeSiteUrl(input);
    const cfg = await getPublicConfig(siteUrl);
    return {
      siteUrl: (cfg.httpswwwroot || cfg.wwwroot || siteUrl).replace(/\/+$/, ''),
      siteName: cfg.sitename,
      logo: cfg.logourl || cfg.compactlogourl || null,
      typeOfLogin: cfg.typeoflogin,
      launchUrl: cfg.launchurl || null,
      identityProviders: (cfg.identityproviders || []).map((p) => p.name),
    };
  });

  ipcMain.handle('auth:login', async (_e, { siteUrl, siteName, launchUrl }) => {
    const result = await loginWithBrowser({ siteUrl, launchUrl, parent: mainWindow });
    const prev = account();
    // Changement de site → on repart de zéro
    if (!prev || prev.siteUrl !== siteUrl || prev.demo) {
      for (const k of ['data', 'snapshot', 'feed', 'lastSync']) store.delete(k);
    }
    store.setSecret('token', result.token);
    if (result.privateToken) store.setSecret('privateToken', result.privateToken);
    store.set('account', { siteUrl, siteName, launchUrl });
    client = buildClient();
    scheduleAutoSync();
    await runSync();
    return publicState();
  });

  ipcMain.handle('demo:start', async () => {
    for (const k of ['data', 'snapshot', 'feed', 'lastSync', 'token', 'privateToken']) store.delete(k);
    store.set('account', { demo: true, siteUrl: 'https://moodle.demo-universite.fr', siteName: 'Moodle — Université de Démonstration' });
    client = createDemoClient();
    await runSync();
    return publicState();
  });

  ipcMain.handle('auth:logout', async (_e, { forgetDevice } = {}) => {
    for (const k of ['data', 'snapshot', 'feed', 'lastSync', 'token', 'privateToken', 'account', 'sentReminders']) store.delete(k);
    client = null;
    clearInterval(autoSyncTimer);
    if (forgetDevice) await clearAllSessionData();
    return publicState();
  });

  ipcMain.handle('sync:run', async () => {
    const r = await runSync();
    return { ...r, state: publicState() };
  });

  ipcMain.handle('feed:markRead', (_e, ids) => {
    const all = ids === 'all';
    const set = new Set(all ? [] : ids);
    const feed = store.get('feed', []).map((i) => (all || set.has(i.id) ? { ...i, read: true } : i));
    store.set('feed', feed);
    return feed;
  });

  ipcMain.handle('feed:markUnread', (_e, id) => {
    const feed = store.get('feed', []).map((i) => (i.id === id ? { ...i, read: false } : i));
    store.set('feed', feed);
    return feed;
  });

  ipcMain.handle('file:open', async (_e, { url, name }) => {
    if (account()?.demo) return demoFileNotice();
    if (!/pluginfile\.php/.test(url)) return shell.openExternal(url);
    const dest = cachePathFor(url, name);
    if (!fs.existsSync(dest)) await download(url, dest);
    const err = await shell.openPath(dest);
    if (err) throw new Error(err);
    return dest;
  });

  ipcMain.handle('file:save', async (_e, { url, name }) => {
    if (account()?.demo) return demoFileNotice();
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('downloads'), safeName(name)) });
    if (canceled || !filePath) return null;
    await download(url, filePath);
    shell.showItemInFolder(filePath);
    return filePath;
  });

  ipcMain.handle('files:saveMany', async (_e, { files, folderName }) => {
    if (account()?.demo) return demoFileNotice();
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: app.getPath('downloads'), buttonLabel: 'Enregistrer ici' });
    if (canceled || !filePaths[0]) return null;
    const dir = path.join(filePaths[0], safeName(folderName || 'Moodle'));
    for (const f of files) {
      if (/pluginfile\.php/.test(f.url)) await download(f.url, path.join(dir, safeName(f.name)));
    }
    shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('moodle:open', async (_e, url) => {
    if (!url) return;
    if (account()?.demo) return shell.openExternal('https://moodle.org/demo');
    let target = url;
    const privateToken = store.getSecret('privateToken');
    // Connexion automatique (comme l'appli officielle), limitée par Moodle à 1 fois / 6 min.
    if (privateToken && client && Date.now() - lastAutologin > 6 * 60 * 1000) {
      try {
        const r = await client.call('tool_mobile_get_autologin_key', { privatetoken: privateToken });
        const info = store.get('data')?.site?.user;
        if (r?.key && info?.id) {
          const u = new URL(r.autologinurl);
          u.searchParams.set('userid', info.id);
          u.searchParams.set('key', r.key);
          u.searchParams.set('urltogo', url);
          target = u.toString();
          lastAutologin = Date.now();
        }
      } catch { /* on ouvre simplement l'URL */ }
    }
    openMoodlePage(target, null);
  });

  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('external:open', (_e, url) => shell.openExternal(url));

  // Jumelage du téléphone : lien (et QR code) contenant l'adresse du site et le jeton.
  // Le jeton est après le « # » : il n'est jamais envoyé au serveur qui héberge la web-app.
  ipcMain.handle('phone:pairing', async () => {
    const acc = account();
    if (!acc || acc.demo) throw new Error('[pairingFirst] Connectez-vous d\'abord à votre Moodle (le jumelage n\'est pas disponible en démo).');
    const token = store.getSecret('token');
    if (!token) throw new Error('Jeton introuvable, reconnectez-vous.');
    const payload = Buffer.from(JSON.stringify({ s: acc.siteUrl, n: acc.siteName, t: token })).toString('base64url');
    const base = settings().webAppUrl || DEFAULT_WEB_APP_URL;
    const link = `${base.replace(/#.*$/, '')}#pair=${payload}`;
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
    return { link, qr };
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    store.set('settings', { ...settings(), ...patch });
    if (patch.theme) nativeTheme.themeSource = patch.theme;
    scheduleAutoSync();
    return settings();
  });
}

// ---------------------------------------------------------------------------
// Fenêtre principale
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Moodle+',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f6f7fb',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => (mainWindow = null));
}

app.whenReady().then(async () => {
  const canEncrypt = safeStorage.isEncryptionAvailable();
  store = new Store(app.getPath('userData'), canEncrypt
    ? { encrypt: (s) => safeStorage.encryptString(s).toString('base64'), decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')) }
    : {});
  nativeTheme.themeSource = settings().theme;
  registerIpc();

  if (DEMO_FLAG && !account()) {
    store.set('account', { demo: true, siteUrl: 'https://moodle.demo-universite.fr', siteName: 'Moodle — Université de Démonstration' });
  }
  client = buildClient();
  createWindow();
  scheduleAutoSync();
  setInterval(() => { try { checkReminders(); } catch { /* données absentes */ } }, 10 * 60 * 1000);

  // Synchro au démarrage (en arrière-plan) si on est déjà connecté
  if (client) mainWindow.webContents.once('did-finish-load', () => runSync({ silent: true }));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
