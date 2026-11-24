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
 *
 * Dans l'APPLI ANDROID (Capacitor), la connexion se fait directement sur le téléphone, comme sur
 * l'ordinateur : un navigateur intégré ouvre la page Moodle (mot de passe + 2FA) et intercepte
 * la redirection finale  moodlemobile://token=…  (événement « customscheme » de l'InAppBrowser).
 */
(function () {
  if (window.moodle) return; // Electron : rien à faire

  const { MoodleClient, isAuthError, normalizeSiteUrl, getPublicConfig } = window.MoodleClientLib;
  const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const URL_SCHEME = 'moodlemobile';
  // Moodle ne délivre la « connexion automatique » qu'aux applis qui s'annoncent comme l'appli Moodle.
  const NATIVE_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android) MoodleMobile Moodle+' };
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
    const c = new MoodleClient(acc.siteUrl, acc.token);
    if (IS_NATIVE) c.extraHeaders = NATIVE_HEADERS;
    return c;
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
    if (IS_NATIVE || !(await settings()).notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
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
    if (IS_NATIVE) return false;
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

  if (!IS_NATIVE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---------- Appli Android : navigateur intégré (cordova-plugin-inappbrowser) ----------
  function waitForIAB() {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function check() {
        if (window.cordova && window.cordova.InAppBrowser) return resolve(window.cordova.InAppBrowser);
        if (Date.now() - t0 > 10000) return reject(new Error('Le navigateur intégré n’a pas démarré.'));
        setTimeout(check, 100);
      })();
    });
  }

  function decodeTokenUrl(url) {
    const m = /token=([A-Za-z0-9+/=_-]+)/.exec(String(url));
    if (!m) return null;
    try {
      const [signature, token, privateToken] = atob(m[1].replace(/-/g, '+').replace(/_/g, '/')).split(':::');
      return token ? { signature, token, privateToken: privateToken || null } : null;
    } catch {
      return null;
    }
  }

  async function nativeLogin({ siteUrl, launchUrl }) {
    const IAB = await waitForIAB();
    const passport = Math.random().toString(36).slice(2, 12);
    const url = new URL(launchUrl || `${siteUrl}/admin/tool/mobile/launch.php`);
    url.searchParams.set('service', 'moodle_mobile_app');
    url.searchParams.set('passport', passport);
    url.searchParams.set('urlscheme', URL_SCHEME);
    return new Promise((resolve, reject) => {
      let done = false;
      // clearsessioncache : repart d'une session Moodle neuve (les cookies « se souvenir de cet appareil » de la 2FA sont conservés)
      const ref = IAB.open(url.toString(), '_blank',
        'location=yes,clearsessioncache=yes,clearcache=no,zoom=no,hardwareback=yes,hidenavigationbuttons=no,' +
        'toolbarcolor=#5b5bf0,closebuttoncolor=#ffffff,navigationbuttoncolor=#ffffff,closebuttoncaption=Annuler,footer=no');
      const finish = (err, res) => {
        if (done) return;
        done = true;
        try { ref.close(); } catch { /* déjà fermé */ }
        if (err) reject(err); else resolve(res);
      };
      const capture = (e) => {
        const u = e && e.url;
        if (!u || !u.startsWith(URL_SCHEME + '://')) return;
        const decoded = decodeTokenUrl(u);
        if (decoded) finish(null, decoded);
        else finish(new Error('Jeton de connexion invalide reçu de Moodle.'));
      };
      ref.addEventListener('customscheme', capture);
      ref.addEventListener('loadstart', capture);
      ref.addEventListener('loaderror', capture);
      ref.addEventListener('loadstop', (e) => {
        if (!/launch\.php/.test((e && e.url) || '')) return;
        ref.executeScript({ code: 'document.body ? document.body.innerText.slice(0, 2000) : ""' }, (r) => {
          const text = (r && r[0]) || '';
          if (/pluginnotenabledorconfigured|enablewsdescription|n'est pas activ|not enabled/i.test(text)) {
            finish(new Error('Ce Moodle n’autorise pas la connexion par l’application mobile.'));
          }
        });
      });
      ref.addEventListener('exit', () => finish(new Error('Connexion annulée.')));
    });
  }

  let lastAutologin = 0;
  async function nativeOpenInMoodle(url) {
    const IAB = await waitForIAB();
    let target = url;
    const acc = await db.get('account');
    // Connexion automatique (comme l'appli officielle), limitée par Moodle à 1 fois / 6 min
    if (acc?.privateToken && Date.now() - lastAutologin > 6 * 60 * 1000) {
      try {
        if (!client) client = await buildClient();
        const r = await client.call('tool_mobile_get_autologin_key', { privatetoken: acc.privateToken });
        const userId = (await db.get('data'))?.site?.user?.id;
        if (r?.key && userId) {
          const u = new URL(r.autologinurl);
          u.searchParams.set('userid', userId);
          u.searchParams.set('key', r.key);
          u.searchParams.set('urltogo', url);
          target = u.toString();
          lastAutologin = Date.now();
        }
      } catch { /* on ouvre simplement la page */ }
    }
    IAB.open(target, '_blank', 'location=yes,zoom=no,hardwareback=yes,toolbarcolor=#5b5bf0,closebuttoncolor=#ffffff,navigationbuttoncolor=#ffffff,closebuttoncaption=Fermer,footer=no');
  }

  const openSystem = async (url) => { if (url) (await waitForIAB()).open(url, '_system'); };

  if (IS_NATIVE) {
    const AppPlugin = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (AppPlugin) {
      AppPlugin.addListener('backButton', () => emit('back'));
      AppPlugin.addListener('resume', async () => {
        if (!(await db.get('account'))) return;
        if (Date.now() / 1000 - ((await db.get('lastSync')) || 0) > 5 * 60) runSync({ silent: true });
      });
    }
  }

  const openUrl = (url) => { if (!url) return; if (IS_NATIVE) openSystem(url); else window.open(url, '_blank', 'noopener'); };
  const demoNotice = () => alert('Mode démonstration : les fichiers ne sont pas réels.');

  window.moodle = {
    platform: 'web',
    native: IS_NATIVE,
    canLogin: IS_NATIVE,
    getState: async () => { await ready; return publicState(); },
    checkSite: async (input) => {
      if (!IS_NATIVE) throw new Error('Sur téléphone, la connexion se fait par jumelage avec l’ordinateur.');
      const siteUrl = normalizeSiteUrl(input);
      const cfg = await getPublicConfig(siteUrl);
      return {
        siteUrl: (cfg.httpswwwroot || cfg.wwwroot || siteUrl).replace(/\/+$/, ''),
        siteName: cfg.sitename,
        logo: cfg.logourl || cfg.compactlogourl || null,
        typeOfLogin: cfg.typeoflogin,
        launchUrl: cfg.launchurl || null,
      };
    },
    login: async ({ siteUrl, siteName, launchUrl }) => {
      if (!IS_NATIVE) throw new Error('Sur téléphone, la connexion se fait par jumelage avec l’ordinateur.');
      const result = await nativeLogin({ siteUrl, launchUrl });
      const prev = await db.get('account');
      if (!prev || prev.siteUrl !== siteUrl || prev.demo) {
        const s = await db.get('settings');
        await db.clear();
        if (s) await db.set('settings', s);
      }
      await db.set('account', { siteUrl, siteName, launchUrl, token: result.token, privateToken: result.privateToken });
      client = null;
      await runSync();
      await scheduleAutoSync();
      return publicState();
    },
    exitApp: () => { const A = window.Capacitor?.Plugins?.App; if (A) (A.minimizeApp ? A.minimizeApp() : A.exitApp()); },
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
    openInMoodle: async (url) => ((await db.get('account'))?.demo ? demoNotice() : IS_NATIVE ? nativeOpenInMoodle(url) : openUrl(url)),
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
