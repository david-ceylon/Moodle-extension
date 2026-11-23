'use strict';
/**
 * Version « téléphone » (web-app) du pont `window.moodle`.
 *
 * Sur l'ordinateur, `window.moodle` est fourni par Electron (preload.js) et parle au processus principal.
 * Dans le navigateur du téléphone, ce fichier fournit la même API, mais :
 *  - les données sont stockées dans le navigateur (IndexedDB) ;
 *  - les appels à Moodle partent directement du téléphone (l'API Web Services de Moodle autorise le CORS) ;
 *  - la connexion se fait par JUMELAGE : l'ordinateur (déjà connecté avec la 2FA) affiche un QR code
 *    contenant l'adresse du site et le jeton ; le téléphone le scanne et c'est tout.
 */
(function () {
  if (window.moodle) return; // Electron : rien à faire

  const { MoodleClient, isAuthError } = window.MoodleClientLib;
  const { fetchEverything, buildSnapshot, diff, mergeFeed } = window.MoodleSync;
  const DEFAULT_SETTINGS = { autoSyncMinutes: 30, notifications: true, theme: 'system' };

  // ---------- Petit stockage clé/valeur sur IndexedDB ----------
  const dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open('moodle-plus', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await dbp;
    return new Promise((resolve, reject) => {
      const t = db.transaction('kv', mode);
      const r = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  };
  const db = {
    get: (k) => tx('readonly', (s) => s.get(k)),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    del: (k) => tx('readwrite', (s) => s.delete(k)),
    clear: () => tx('readwrite', (s) => s.clear()),
  };

  // ---------- Événements (même interface que le preload Electron) ----------
  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((cb) => cb(p));

  let client = null;
  let syncing = null;
  let timer = null;

  async function settings() {
    return { ...DEFAULT_SETTINGS, ...((await db.get('settings')) || {}) };
  }

  async function publicState() {
    const acc = await db.get('account');
    return {
      platform: 'web',
      loggedIn: !!acc,
      demo: !!acc?.demo,
      account: acc ? { siteUrl: acc.siteUrl, siteName: acc.siteName } : null,
      data: (await db.get('data')) || null,
      feed: (await db.get('feed')) || [],
      lastSync: (await db.get('lastSync')) || 0,
      settings: await settings(),
      syncing: !!syncing,
      version: 'web',
    };
  }

  async function buildClient() {
    const acc = await db.get('account');
    if (!acc) return null;
    if (acc.demo) return window.MoodleDemo.createDemoClient();
    return new MoodleClient(acc.siteUrl, acc.token);
  }

  async function runSync({ silent = false } = {}) {
    if (syncing) return syncing;
    if (!client) client = await buildClient();
    if (!client) throw new Error('Non connecté');
    syncing = (async () => {
      emit('sync:progress', { text: 'Connexion…', ratio: 0 });
      const now = Math.floor(Date.now() / 1000);
      try {
        if (client.demo && (await db.get('lastSync'))) client.publishSomething();
        const data = await fetchEverything(client, { now, onProgress: (text, ratio) => emit('sync:progress', { text, ratio }) });
        if (data.site.user.picture) data.site.user.picture = client.fileUrl(data.site.user.picture);
        const prevSnap = (await db.get('snapshot')) || null;
        const prevSync = (await db.get('lastSync')) || 0;
        const newItems = diff(data, prevSnap, prevSync, now);
        const feed = mergeFeed((await db.get('feed')) || [], newItems);
        await db.set('data', data);
        await db.set('snapshot', buildSnapshot(data));
        await db.set('feed', feed);
        await db.set('lastSync', now);
        if (prevSnap && newItems.length) notify(newItems);
        return { newItems: newItems.length };
      } catch (e) {
        if (isAuthError(e)) emit('auth:expired', { message: 'Le jumelage a expiré : reconnectez le téléphone depuis l’ordinateur.' });
        if (!silent) throw e;
        return { error: e.message };
      } finally {
        syncing = null;
        emit('sync:progress', null);
        emit('state', await publicState());
      }
    })();
    return syncing;
  }

  async function notify(items) {
    if (!(await settings()).notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    const title = items.length === 1 ? 'Nouveau sur Moodle' : `${items.length} nouveautés sur Moodle`;
    const body = items.slice(0, 3).map((i) => '• ' + i.title).join('\n');
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(title, { body, icon: 'icon-192.png' });
      else new Notification(title, { body });
    } catch { /* notifications indisponibles */ }
  }

  async function scheduleAutoSync() {
    clearInterval(timer);
    const minutes = (await settings()).autoSyncMinutes;
    if (minutes && (await db.get('account'))) timer = setInterval(() => runSync({ silent: true }).catch(() => {}), minutes * 60000);
  }

  // ---------- Jumelage : lien  https://…/#pair=<base64url(JSON)> ----------
  async function consumePairingLink() {
    const m = /^#pair=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search); // le jeton disparaît de la barre d'adresse
    try {
      const json = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
      if (!json.s || !json.t) throw new Error('lien incomplet');
      const prev = await db.get('account');
      if (!prev || prev.siteUrl !== json.s || prev.demo) await db.clear();
      await db.set('account', { siteUrl: json.s, siteName: json.n || json.s, token: json.t });
      client = null;
      return true;
    } catch (e) {
      alert('Lien de jumelage invalide : ' + e.message);
      return false;
    }
  }

  const ready = (async () => {
    const paired = await consumePairingLink();
    await scheduleAutoSync();
    if (await db.get('account')) setTimeout(() => runSync({ silent: true }), paired ? 50 : 800);
  })();

  // Lien de jumelage ouvert alors que l'appli était déjà affichée
  window.addEventListener('hashchange', async () => {
    if (await consumePairingLink()) location.reload();
  });

  // Resynchroniser quand on revient sur l'appli (téléphone sorti de la poche)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !(await db.get('account'))) return;
    const last = (await db.get('lastSync')) || 0;
    if (Date.now() / 1000 - last > 5 * 60) runSync({ silent: true });
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  const openUrl = (url) => { if (url) window.open(url, '_blank', 'noopener'); };
  const demoNotice = () => alert('Mode démonstration : les fichiers ne sont pas réels.');

  window.moodle = {
    platform: 'web',
    getState: async () => { await ready; return publicState(); },
    checkSite: async () => { throw new Error('Sur téléphone, la connexion se fait par jumelage avec l’ordinateur.'); },
    login: async () => { throw new Error('Sur téléphone, la connexion se fait par jumelage avec l’ordinateur.'); },
    startDemo: async () => {
      await db.clear();
      await db.set('account', { demo: true, siteUrl: 'https://moodle.demo-universite.fr', siteName: 'Moodle — Université de Démonstration' });
      client = window.MoodleDemo.createDemoClient();
      await runSync();
      await scheduleAutoSync();
      return publicState();
    },
    logout: async () => {
      const s = await db.get('settings');
      await db.clear();
      if (s) await db.set('settings', s);
      client = null;
      clearInterval(timer);
      return publicState();
    },
    sync: async () => { const r = await runSync(); return { ...r, state: await publicState() }; },
    markRead: async (ids) => {
      const all = ids === 'all';
      const set = new Set(all ? [] : ids);
      const feed = ((await db.get('feed')) || []).map((i) => (all || set.has(i.id) ? { ...i, read: true } : i));
      await db.set('feed', feed);
      return feed;
    },
    markUnread: async (id) => {
      const feed = ((await db.get('feed')) || []).map((i) => (i.id === id ? { ...i, read: false } : i));
      await db.set('feed', feed);
      return feed;
    },
    openFile: async ({ url }) => ((await db.get('account'))?.demo ? demoNotice() : openUrl(url)),
    saveFile: async ({ url }) => ((await db.get('account'))?.demo ? demoNotice() : openUrl(url)),
    saveMany: async () => { throw new Error('Le téléchargement groupé est disponible sur l’ordinateur.'); },
    openInMoodle: async (url) => ((await db.get('account'))?.demo ? demoNotice() : openUrl(url)),
    openExternal: async (url) => openUrl(url),
    phonePairing: async () => null,
    setSettings: async (patch) => {
      const s = { ...(await settings()), ...patch };
      await db.set('settings', s);
      if (patch.notifications && 'Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch {}
      }
      await scheduleAutoSync();
      return s;
    },
    on: (channel, cb) => {
      (listeners[channel] = listeners[channel] || []).push(cb);
      return () => (listeners[channel] = listeners[channel].filter((x) => x !== cb));
    },
  };
})();
