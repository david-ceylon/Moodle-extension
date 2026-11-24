'use strict';
/**
 * Tâche d'arrière-plan de l'appli Android (plugin Capacitor « Background Runner »).
 *
 * Android l'exécute environ toutes les 30 minutes, MÊME APPLI FERMÉE, dans un petit moteur
 * JavaScript séparé (QuickJS) : pas de page, pas de DOM, pas d'IndexedDB, pas d'URL / URLSearchParams.
 * Elle réutilise la même logique que l'appli (MoodleClientLib + MoodleSync, ajoutés avant ce fichier
 * par scripts/build-web.js) :
 *   1. récupère vos cours sur Moodle ;
 *   2. compare avec la dernière photo connue → notification « nouveau dossier / fichier / annonce / note » ;
 *   3. envoie les rappels d'échéance (moins de 24 h, puis moins de 2 h).
 *
 * Événements :
 *   checkMoodle  → lancé par Android périodiquement (voir capacitor.config.json)
 *   syncState    → envoyé par l'appli après chaque synchronisation (compte, photo, réglages, échéances)
 *   settings     → réglages modifiés dans l'appli
 *   logout       → déconnexion : on efface tout
 *   test         → notification de test (bouton dans les réglages)
 */

var MC = globalThis.MoodleClientLib;
var MS = globalThis.MoodleSync;
var KV_STATE = 'mp.state'; // { account: { siteUrl, token }, settings, lastSync, courses, expiredNotified }
var KV_SNAP = 'mp.snapshot';
var KV_SENT = 'mp.reminders';
var HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android) MoodleMobile Moodle+' };

function kvGet(key) {
  try {
    var r = CapacitorKV.get(key);
    var v = r && typeof r === 'object' ? r.value : r;
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}
function kvSet(key, value) {
  CapacitorKV.set(key, JSON.stringify(value));
}

/** fetch du moteur d'arrière-plan → objet compatible avec MoodleClient ({ ok, status, text() }). */
async function runnerFetch(url, opts) {
  var res = await fetch(url, { method: opts.method, headers: opts.headers, body: opts.body });
  var status = res.status;
  var text = typeof res.text === 'function' ? await res.text() : JSON.stringify(await res.json());
  return {
    ok: res.ok !== undefined ? res.ok : status >= 200 && status < 300,
    status: status,
    text: async function () { return text; },
    json: async function () { return JSON.parse(text); },
  };
}

function notify(list) {
  if (!list || !list.length) return;
  CapacitorNotifications.schedule(list.map(function (n) {
    return {
      id: MS.notificationId(n.key || n.title),
      title: n.title,
      body: n.body,
      largeBody: n.largeBody || n.body,
      autoCancel: true,
      smallIcon: 'ic_stat_moodleplus', // res/drawable-*/ic_stat_moodleplus.png (silhouette « M+ » blanche)
    };
  }));
}

function lang(state) {
  return (state && state.settings && state.settings.lang) || 'fr';
}

var SMALL = {
  fr: { expiredTitle: 'Moodle+ : reconnexion nécessaire', expiredBody: 'Votre session Moodle a expiré. Ouvrez l’appli pour vous reconnecter.', testTitle: 'Moodle+ : notifications activées ✓', testBody: 'Vous serez prévenu des nouveaux fichiers, annonces, notes et échéances.' },
  en: { expiredTitle: 'Moodle+: please sign in again', expiredBody: 'Your Moodle session expired. Open the app to sign in again.', testTitle: 'Moodle+: notifications enabled ✓', testBody: 'You’ll be told about new files, announcements, grades and deadlines.' },
  he: { expiredTitle: 'Moodle+: נדרשת התחברות מחדש', expiredBody: 'תוקף ההתחברות ל-Moodle פג. פתחו את האפליקציה כדי להתחבר שוב.', testTitle: 'Moodle+: ההתראות פעילות ✓', testBody: 'תקבלו התראה על קבצים, הודעות, ציונים ומועדי הגשה חדשים.' },
};
function say(state, k) { return (SMALL[lang(state)] || SMALL.fr)[k]; }

function notificationsOn(state) {
  return !state.settings || state.settings.notifications !== false;
}

function sendReminders(state, deadlines, courses, now) {
  if (!notificationsOn(state) || (state.settings && state.settings.notifyReminders === false)) return 0;
  var r = MS.dueReminders(deadlines, kvGet(KV_SENT) || {}, now, { courses: courses || [] }, lang(state));
  kvSet(KV_SENT, r.sent);
  notify(r.reminders);
  return r.reminders.length;
}

async function checkMoodle() {
  var state = kvGet(KV_STATE);
  if (!state || !state.account || !state.account.token) return { skipped: 'non connecté' };
  try {
    var net = CapacitorDevice.getNetworkStatus();
    if (net && net.connected === false) return { skipped: 'hors ligne' };
  } catch (e) { /* info indisponible : on tente quand même */ }

  var client = new MC.MoodleClient(state.account.siteUrl, state.account.token, runnerFetch);
  client.extraHeaders = HEADERS;
  client.fileUrl = function (u) { return u; };
  var now = Math.floor(Date.now() / 1000);

  var data;
  try {
    data = await MS.fetchEverything(client, { now: now });
  } catch (e) {
    if (MC.isAuthError(e) && !state.expiredNotified) {
      state.expiredNotified = true;
      kvSet(KV_STATE, state);
      if (notificationsOn(state)) notify([{ key: 'expired', title: say(state, 'expiredTitle'), body: say(state, 'expiredBody') }]);
    }
    throw e;
  }

  var prevSnap = kvGet(KV_SNAP);
  var sentNew = 0;
  if (prevSnap && notificationsOn(state)) {
    var items = MS.filterForNotification(MS.diff(data, prevSnap, state.lastSync || 0, now), state.settings);
    var notes = MS.buildNotifications(items, data, 4, lang(state)).map(function (n, i) { return Object.assign({ key: 'new:' + now + ':' + i }, n); });
    notify(notes);
    sentNew = items.length;
  }
  kvSet(KV_SNAP, MS.buildSnapshot(data));
  state.lastSync = now;
  state.expiredNotified = false;
  state.courses = data.courses.map(function (c) { return { id: c.id, shortname: c.shortname, fullname: c.fullname }; });
  kvSet(KV_STATE, state);
  var reminders = sendReminders(state, data.deadlines, state.courses, now);
  return { newItems: sentNew, reminders: reminders };
}

function handler(fn) {
  return function (resolve, reject, args) {
    Promise.resolve()
      .then(function () { return fn(args || {}); })
      .then(function (r) { resolve(r || {}); })
      .catch(function (e) {
        console.error('Moodle+ arrière-plan : ' + (e && e.message ? e.message : e));
        resolve({ error: String(e && e.message ? e.message : e) }); // toujours terminer, sinon Android tue la tâche
      });
  };
}

addEventListener('checkMoodle', handler(checkMoodle));

addEventListener('syncState', handler(function (args) {
  var state = kvGet(KV_STATE) || {};
  state.account = args.account;
  state.settings = args.settings || state.settings || {};
  state.lastSync = args.lastSync || state.lastSync || 0;
  state.courses = args.courses || state.courses || [];
  state.expiredNotified = false;
  kvSet(KV_STATE, state);
  if (args.snapshot) kvSet(KV_SNAP, args.snapshot);
  var reminders = sendReminders(state, args.deadlines || [], state.courses, Math.floor(Date.now() / 1000));
  return { stored: true, reminders: reminders };
}));

addEventListener('settings', handler(function (args) {
  var state = kvGet(KV_STATE) || {};
  state.settings = Object.assign({}, state.settings || {}, args.settings || {});
  kvSet(KV_STATE, state);
  return { stored: true };
}));

addEventListener('logout', handler(function () {
  CapacitorKV.remove(KV_STATE);
  CapacitorKV.remove(KV_SNAP);
  CapacitorKV.remove(KV_SENT);
  return { cleared: true };
}));

addEventListener('test', handler(function () {
  var state = kvGet(KV_STATE) || {};
  notify([{ key: 'test', title: say(state, 'testTitle'), body: say(state, 'testBody') }]);
  return { sent: true };
}));
