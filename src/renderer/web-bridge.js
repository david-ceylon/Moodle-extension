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
  // Extension Chrome : page de l'extension (chrome-extension://…) avec accès aux API chrome.*
  const IS_EXT = !!(window.chrome && chrome.runtime && chrome.runtime.id && location.protocol === 'chrome-extension:');
  const URL_SCHEME = 'moodlemobile';
  // Moodle ne délivre la « connexion automatique » qu'aux applis qui s'annoncent comme l'appli Moodle.
  const NATIVE_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android) MoodleMobile Moodle+' };
  const DEFAULT_SETTINGS = { autoSyncMinutes: 30, notifications: true, theme: 'system', notifyContent: true, notifyAnnouncements: true, notifyGrades: true, notifyReminders: true };
  const RUNNER_LABEL = 'fr.moodleplus.check';
  // Langue : réglage choisi, sinon celle du navigateur (hébreu) ou le français
  const navLang = () => (/^(he|iw)/.test(navigator.language || '') ? 'he' : 'fr');
  const SMALL = {
    fr: { demoFile: 'Mode démonstration : les fichiers ne sont pas réels.', cancel: 'Annuler', close: 'Fermer', badLink: 'Lien de jumelage invalide', title1: 'Nouveau sur Moodle' },
    en: { demoFile: 'Demo mode: files aren’t real.', cancel: 'Cancel', close: 'Close', badLink: 'Invalid pairing link', title1: 'New on Moodle' },
    he: { demoFile: 'מצב הדגמה: הקבצים אינם אמיתיים.', cancel: 'ביטול', close: 'סגירה', badLink: 'קישור צימוד לא תקין', title1: 'חדש ב-Moodle' },
  };
  let currentLang = navLang();
  const say = (k) => (SMALL[currentLang] || SMALL.fr)[k]; // = plugins.BackgroundRunner.label dans capacitor.config.json

  // ---------- Stockage clé/valeur sur IndexedDB (voir web-core.js) ----------
  const db = window.MoodleWebCore.openKV();

  // ---------- Événements (même interface que le preload Electron) ----------
  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((cb) => cb(p));

  let client = null;
  let syncing = null;
  let timer = null;

  async function settings() {
    const s = { ...DEFAULT_SETTINGS, ...((await db.get('settings')) || {}) };
    currentLang = s.lang || navLang();
    return s;
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
      version: IS_EXT ? chrome.runtime.getManifest().version : 'web',
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

  // ---------- Appli Android : tâche d'arrière-plan (vérifie Moodle même appli fermée) ----------
  function nativePlugin(name) {
    const C = window.Capacitor;
    if (!C) return null;
    return (C.Plugins && C.Plugins[name]) || (C.registerPlugin ? C.registerPlugin(name) : null);
  }

  async function runner(event, details = {}) {
    if (!IS_NATIVE) return null;
    const BR = nativePlugin('BackgroundRunner');
    if (!BR) return null;
    try {
      return await BR.dispatchEvent({ label: RUNNER_LABEL, event, details });
    } catch (e) {
      console.warn('Tâche d’arrière-plan :', e && e.message);
      return null;
    }
  }

  async function askNotificationPermission() {
    if (!IS_NATIVE) return null;
    const BR = nativePlugin('BackgroundRunner');
    try { return BR ? await BR.requestPermissions({ apis: ['notifications'] }) : null; } catch { return null; }
  }

  /** Transmet à la tâche d'arrière-plan ce qu'il faut pour vérifier Moodle seule (et envoie les rappels dus). */
  async function pushStateToRunner() {
    const acc = await db.get('account');
    const data = await db.get('data');
    if (!IS_NATIVE || !acc || acc.demo || !data) return;
    await runner('syncState', {
      account: { siteUrl: acc.siteUrl, token: acc.token },
      snapshot: await db.get('snapshot'),
      lastSync: await db.get('lastSync'),
      settings: { ...(await settings()), lang: currentLang },
      deadlines: data.deadlines,
      courses: data.courses.map((c) => ({ id: c.id, shortname: c.shortname, fullname: c.fullname })),
    });
  }

  async function runSync({ silent = false } = {}) {
    if (syncing) return syncing;
    if (!client) client = await buildClient();
    if (!client) throw new Error('[notLoggedIn] Non connecté');
    syncing = (async () => {
      emit('sync:progress', { text: 'Connexion…', ratio: 0 });
      const now = Math.floor(Date.now() / 1000);
      try {
        if (client.demo && (await db.get('lastSync'))) client.publishSomething();
        const { data, newItems, prevSnap, feed } = await window.MoodleWebCore.syncOnce({ db, client, now, onProgress: (text, ratio) => emit('sync:progress', { text, ratio }) });
        if (prevSnap && newItems.length) notify(newItems);
        if (!IS_NATIVE && !IS_EXT) webReminders(data, now);
        if (IS_EXT) extAfterSync(feed);
        pushStateToRunner();
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

  /** Affiche une notification : chrome.notifications (extension), sinon notification du navigateur. */
  async function showNotif(n) {
    try {
      if (IS_EXT) {
        chrome.notifications.create(n.key ? 'mp-' + n.key : '', { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), title: n.title, message: n.largeBody || n.body || '', priority: 1 });
        return;
      }
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(n.title, { body: n.largeBody || n.body, icon: 'icon-192.png', tag: n.key });
      else new Notification(n.title, { body: n.body });
    } catch { /* notifications indisponibles */ }
  }
  const canNotify = () => IS_EXT || ('Notification' in window && Notification.permission === 'granted');

  async function notify(items) {
    const s = await settings();
    if (IS_NATIVE || !s.notifications || !canNotify()) return;
    items = window.MoodleSync.filterForNotification(items, s);
    if (!items.length) return;
    const data = await db.get('data');
    window.MoodleSync.buildNotifications(items, data, 3, currentLang).forEach((n, i) => showNotif({ key: `new:${Date.now()}:${i}`, ...n }));
  }

  // Web-app (iPhone…) : rappels d'échéance quand elle est ouverte (pas d'arrière-plan possible pour un site web)
  async function webReminders(data, now) {
    const s = await settings();
    if (!s.notifications || !s.notifyReminders || !canNotify()) return;
    const r = window.MoodleSync.dueReminders(data.deadlines, (await db.get('sentReminders')) || {}, now, data, currentLang);
    await db.set('sentReminders', r.sent);
    r.reminders.forEach(showNotif);
  }

  // ---------- Extension Chrome ----------
  const toBackground = (msg) => { try { return chrome.runtime.sendMessage(msg).catch(() => null); } catch { return Promise.resolve(null); } };

  function updateBadge(feed) {
    if (!IS_EXT) return;
    const n = (feed || []).filter((i) => !i.read).length;
    try {
      chrome.action.setBadgeBackgroundColor({ color: '#5b5bf0' });
      chrome.action.setBadgeText({ text: n ? (n > 99 ? '99+' : String(n)) : '' });
    } catch { /* pas d'icône */ }
  }

  function extAfterSync(feed) {
    updateBadge(feed);
  }

  async function ensureHostPermission(siteUrl) {
    const origins = [new URL(siteUrl).origin + '/*'];
    if (await chrome.permissions.contains({ origins })) return;
    if (!(await chrome.permissions.request({ origins }))) throw new Error('[permission] Autorisation refusée pour ce site.');
  }

  async function clearSiteCookies(siteUrl) {
    const host = new URL(siteUrl).hostname;
    const cookies = await chrome.cookies.getAll({ domain: host });
    await Promise.all(cookies.map((c) => chrome.cookies.remove({ url: `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path}`, name: c.name, storeId: c.storeId }).catch(() => {})));
  }

  /**
   * Connexion dans une fenêtre Chrome : la page de l'établissement (mot de passe + 2FA) s'ouvre normalement,
   * et l'extension repère la redirection finale  moodlemobile://token=…  (en-tête Location de launch.php,
   * ou lien « launchapp » de la page de confirmation) grâce à l'API webRequest.
   */
  async function extLogin({ siteUrl, launchUrl }) {
    const passport = Math.random().toString(36).slice(2, 12);
    const url = new URL(launchUrl || `${siteUrl}/admin/tool/mobile/launch.php`);
    url.searchParams.set('service', 'moodle_mobile_app');
    url.searchParams.set('passport', passport);
    url.searchParams.set('urlscheme', URL_SCHEME);
    const origin = new URL(siteUrl).origin;
    let winId = null;
    let tabId = null; // onglet de la fenêtre de connexion (les événements réseau ne donnent que l'onglet)
    let done = false;
    let retried = false;
    return new Promise((resolve, reject) => {
      const finish = (err, res) => {
        if (done) return;
        done = true;
        chrome.webRequest.onHeadersReceived.removeListener(onHeaders);
        chrome.webRequest.onBeforeRedirect.removeListener(onRedirect);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.windows.onRemoved.removeListener(onRemoved);
        if (winId !== null) chrome.windows.remove(winId).catch(() => {});
        if (err) reject(err); else resolve(res);
      };
      const capture = (u) => {
        if (!u || !String(u).startsWith(URL_SCHEME + '://')) return false;
        const decoded = decodeTokenUrl(u);
        if (decoded) finish(null, decoded);
        else finish(new Error('[invalidToken] Jeton de connexion invalide reçu de Moodle.'));
        return true;
      };
      const mine = (d) => tabId === null || d.tabId === tabId;
      const onHeaders = (d) => {
        if (!mine(d)) return;
        const loc = (d.responseHeaders || []).find((h) => h.name.toLowerCase() === 'location');
        if (loc) capture(loc.value);
      };
      const onRedirect = (d) => { if (mine(d)) capture(d.redirectUrl); };
      const onUpdated = async (tabId, info, tab) => {
        if (tab.windowId !== winId || info.status !== 'complete' || !tab.url || !tab.url.includes('/admin/tool/mobile/launch.php')) return;
        try {
          const [res] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => ({ link: (document.getElementById('launchapp') || {}).href || null, text: document.body ? document.body.innerText.slice(0, 2000) : '' }),
          });
          const r = res && res.result;
          if (r && r.link && capture(r.link)) return;
          if (r && /pluginnotenabledorconfigured|enablewsdescription|n'est pas activ|not enabled/i.test(r.text)) {
            // Moodle refuse si l'on était déjà connecté sans « vraie » connexion : on efface la session Moodle et on recommence
            if (!retried) { retried = true; await clearSiteCookies(siteUrl); chrome.tabs.update(tabId, { url: url.toString() }); }
            else finish(new Error('[wsDisabled] Ce Moodle n’autorise pas la connexion par l’application mobile.'));
          }
        } catch { /* page en cours de chargement */ }
      };
      const onRemoved = (id) => { if (id === winId) finish(new Error('[cancelled] Connexion annulée.')); };
      chrome.webRequest.onHeadersReceived.addListener(onHeaders, { urls: [origin + '/*'], types: ['main_frame'] }, ['responseHeaders']);
      chrome.webRequest.onBeforeRedirect.addListener(onRedirect, { urls: [origin + '/*'], types: ['main_frame'] });
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.windows.onRemoved.addListener(onRemoved);
      chrome.windows.create({ url: url.toString(), type: 'popup', width: 520, height: 740, focused: true })
        .then((w) => { winId = w.id; tabId = w.tabs && w.tabs[0] ? w.tabs[0].id : null; })
        .catch((e) => finish(new Error('[unreachable] ' + e.message)));
    });
  }

  if (IS_EXT) {
    // La tâche de fond a synchronisé : on recharge l'affichage
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'synced') publicState().then((st) => { emit('state', st); updateBadge(st.feed); });
    });
  }

  async function scheduleAutoSync() {
    clearInterval(timer);
    const minutes = (await settings()).autoSyncMinutes;
    if (minutes && (await db.get('account'))) timer = setInterval(() => runSync({ silent: true }).catch(() => {}), minutes * 60000);
  }

  // ---------- Jumelage : lien  https://…/#pair=<base64url(JSON)> ----------
  async function consumePairingLink() {
    if (IS_NATIVE || IS_EXT) return false;
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
      alert(say('badLink') + ' : ' + e.message);
      return false;
    }
  }

  const ready = (async () => {
    const paired = await consumePairingLink();
    await scheduleAutoSync();
    if (await db.get('account')) setTimeout(() => runSync({ silent: true }), paired ? 50 : 800);
    if (IS_NATIVE && (await db.get('account'))) askNotificationPermission();
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

  if (!IS_NATIVE && !IS_EXT && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---------- Appli Android : navigateur intégré (cordova-plugin-inappbrowser) ----------
  function waitForIAB() {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function check() {
        if (window.cordova && window.cordova.InAppBrowser) return resolve(window.cordova.InAppBrowser);
        if (Date.now() - t0 > 10000) return reject(new Error('[iab] Le navigateur intégré n’a pas démarré.'));
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
        `toolbarcolor=#5b5bf0,closebuttoncolor=#ffffff,navigationbuttoncolor=#ffffff,closebuttoncaption=${say('cancel')},footer=no`);
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
        else finish(new Error('[invalidToken] Jeton de connexion invalide reçu de Moodle.'));
      };
      ref.addEventListener('customscheme', capture);
      ref.addEventListener('loadstart', capture);
      ref.addEventListener('loaderror', capture);
      ref.addEventListener('loadstop', (e) => {
        if (!/launch\.php/.test((e && e.url) || '')) return;
        ref.executeScript({ code: 'document.body ? document.body.innerText.slice(0, 2000) : ""' }, (r) => {
          const text = (r && r[0]) || '';
          if (/pluginnotenabledorconfigured|enablewsdescription|n'est pas activ|not enabled/i.test(text)) {
            finish(new Error('[wsDisabled] Ce Moodle n’autorise pas la connexion par l’application mobile.'));
          }
        });
      });
      ref.addEventListener('exit', () => finish(new Error('[cancelled] Connexion annulée.')));
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
    IAB.open(target, '_blank', `location=yes,zoom=no,hardwareback=yes,toolbarcolor=#5b5bf0,closebuttoncolor=#ffffff,navigationbuttoncolor=#ffffff,closebuttoncaption=${say('close')},footer=no`);
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

  const openUrl = (url) => {
    if (!url) return;
    if (IS_NATIVE) openSystem(url);
    else if (IS_EXT) chrome.tabs.create({ url }); // onglet normal : la session Moodle de Chrome est utilisée
    else window.open(url, '_blank', 'noopener');
  };
  const safeName = (n) => String(n || 'fichier').replace(/[\\/:*?"<>|~]+/g, '_').replace(/^\.+/, '').slice(0, 150) || 'fichier';
  const demoNotice = () => alert(say('demoFile'));

  window.moodle = {
    platform: 'web',
    native: IS_NATIVE,
    extension: IS_EXT,
    canLogin: IS_NATIVE || IS_EXT,
    getState: async () => { await ready; return publicState(); },
    checkSite: async (input) => {
      if (!IS_NATIVE && !IS_EXT) throw new Error('[pairingOnly] Sur téléphone, la connexion se fait par jumelage avec l’ordinateur.');
      const siteUrl = normalizeSiteUrl(input);
      if (IS_EXT) await ensureHostPermission(siteUrl);
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
      if (!IS_NATIVE && !IS_EXT) throw new Error('[pairingOnly] Sur téléphone, la connexion se fait par jumelage avec l’ordinateur.');
      const result = IS_EXT ? await extLogin({ siteUrl, launchUrl }) : await nativeLogin({ siteUrl, launchUrl });
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
      askNotificationPermission();
      if (IS_EXT) toBackground({ type: 'schedule' });
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
      await runner('logout');
      const s = await db.get('settings');
      await db.clear();
      if (s) await db.set('settings', s);
      client = null;
      clearInterval(timer);
      if (IS_EXT) { updateBadge([]); toBackground({ type: 'schedule' }); }
      return publicState();
    },
    sync: async () => { const r = await runSync(); return { ...r, state: await publicState() }; },
    markRead: async (ids) => {
      const all = ids === 'all';
      const set = new Set(all ? [] : ids);
      const feed = ((await db.get('feed')) || []).map((i) => (all || set.has(i.id) ? { ...i, read: true } : i));
      await db.set('feed', feed);
      updateBadge(feed);
      return feed;
    },
    markUnread: async (id) => {
      const feed = ((await db.get('feed')) || []).map((i) => (i.id === id ? { ...i, read: false } : i));
      await db.set('feed', feed);
      updateBadge(feed);
      return feed;
    },
    openFile: async ({ url }) => ((await db.get('account'))?.demo ? demoNotice() : openUrl(url)),
    saveFile: async ({ url, name }) => {
      if ((await db.get('account'))?.demo) return demoNotice();
      if (IS_EXT) return chrome.downloads.download({ url, filename: safeName(name), saveAs: true });
      return openUrl(url);
    },
    saveMany: async ({ files, folderName }) => {
      if (!IS_EXT) throw new Error('[bulkDesktop] Le téléchargement groupé n’est pas disponible ici.');
      if ((await db.get('account'))?.demo) return demoNotice();
      // Tout arrive dans Téléchargements/Moodle+/<cours ou dossier>/
      for (const f of files) await chrome.downloads.download({ url: f.url, filename: `Moodle+/${safeName(folderName)}/${safeName(f.name)}`, conflictAction: 'uniquify' });
      return true;
    },
    copy: async (text) => navigator.clipboard.writeText(text),
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
      if (IS_NATIVE) {
        if (patch.notifications) await askNotificationPermission();
        await runner('settings', { settings: { ...s, lang: s.lang || navLang() } });
      }
      if (IS_EXT) toBackground({ type: 'schedule' });
      return s;
    },
    testNotification: async () => {
      if (IS_EXT) return toBackground({ type: 'test' });
      if (!IS_NATIVE) throw new Error('[androidOnly] Disponible dans l’appli Android.');
      const perm = await askNotificationPermission();
      if (perm && perm.notifications && perm.notifications !== 'granted') throw new Error('[notifDenied] Notifications refusées : autorisez-les dans les paramètres de Moodle+.');
      await runner('test');
    },
    checkInBackgroundNow: async () => runner('checkMoodle'),
    on: (channel, cb) => {
      (listeners[channel] = listeners[channel] || []).push(cb);
      return () => (listeners[channel] = listeners[channel].filter((x) => x !== cb));
    },
  };
})();
