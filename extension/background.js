'use strict';
/**
 * Tâche de fond de l'extension Chrome Moodle+ (service worker).
 *  - Clic sur l'icône → ouvre (ou ramène) l'onglet Moodle+.
 *  - Toutes les 30 min (réglable), même onglet fermé tant que Chrome tourne : synchronise Moodle,
 *    met à jour le compteur sur l'icône et envoie les notifications (nouveautés + rappels d'échéance).
 * Même logique et même stockage (IndexedDB) que la page : moodle-client.js, sync.js, web-core.js.
 */
importScripts('shared/moodle-client.js', 'shared/sync.js', 'shared/web-core.js');

const { MoodleClient, isAuthError } = self.MoodleClientLib;
const S = self.MoodleSync;
const db = self.MoodleWebCore.openKV();
const ALARM = 'moodle-check';
const APP = chrome.runtime.getURL('app.html');
const DEFAULTS = { autoSyncMinutes: 30, notifications: true, notifyContent: true, notifyAnnouncements: true, notifyGrades: true, notifyReminders: true };
const SMALL = {
  fr: { expiredTitle: 'Moodle+ : reconnexion nécessaire', expiredBody: 'Votre session Moodle a expiré. Ouvrez Moodle+ pour vous reconnecter.', testTitle: 'Moodle+ : notifications activées ✓', testBody: 'Vous serez prévenu des nouveaux fichiers, annonces, notes et échéances.' },
  en: { expiredTitle: 'Moodle+: please sign in again', expiredBody: 'Your Moodle session expired. Open Moodle+ to sign in again.', testTitle: 'Moodle+: notifications enabled ✓', testBody: 'You’ll be told about new files, announcements, grades and deadlines.' },
  he: { expiredTitle: 'Moodle+: נדרשת התחברות מחדש', expiredBody: 'תוקף ההתחברות ל-Moodle פג. פתחו את Moodle+ כדי להתחבר שוב.', testTitle: 'Moodle+: ההתראות פעילות ✓', testBody: 'תקבלו התראה על קבצים, הודעות, ציונים ומועדי הגשה חדשים.' },
};

async function settings() {
  return { ...DEFAULTS, ...((await db.get('settings')) || {}) };
}
const lang = (s) => s.lang || (/^(he|iw)/.test(self.navigator.language || '') ? 'he' : 'fr');
const say = (s, k) => (SMALL[lang(s)] || SMALL.fr)[k];

/** Crée les notifications et attend qu'elles existent (Chrome peut endormir le service worker juste après). */
function notify(list) {
  return Promise.all((list || []).map((n) => chrome.notifications.create(n.key ? 'mp-' + n.key : '', {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: n.title,
    message: n.largeBody || n.body || '',
    priority: 1,
  }).catch((e) => console.warn('Notification :', e && e.message))));
}

function setBadge(feed) {
  const n = (feed || []).filter((i) => !i.read).length;
  chrome.action.setBadgeBackgroundColor({ color: '#5b5bf0' });
  chrome.action.setBadgeText({ text: n ? (n > 99 ? '99+' : String(n)) : '' });
}

/** (Re)programme la vérification périodique selon le compte et les réglages. */
async function schedule() {
  await chrome.alarms.clear(ALARM);
  const acc = await db.get('account');
  if (!acc || acc.demo) return setBadge([]);
  const s = await settings();
  // Même avec la synchro désactivée, on garde une vérification toutes les 30 min pour les rappels d'échéance
  chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: Math.max(15, s.autoSyncMinutes || 30) });
  setBadge(await db.get('feed'));
}

async function reminders(data, s) {
  if (!s.notifications || s.notifyReminders === false || !data) return 0;
  const r = S.dueReminders(data.deadlines, (await db.get('sentReminders')) || {}, Math.floor(Date.now() / 1000), data, lang(s));
  await db.set('sentReminders', r.sent);
  await notify(r.reminders);
  return r.reminders.length;
}

let checking = null;
async function check() {
  if (checking) return checking;
  checking = (async () => {
    const acc = await db.get('account');
    if (!acc || acc.demo) return { skipped: true };
    const s = await settings();
    let data = await db.get('data');
    let newItems = 0;
    if (s.autoSyncMinutes !== 0) {
      try {
        const r = await self.MoodleWebCore.syncOnce({ db, client: new MoodleClient(acc.siteUrl, acc.token) });
        data = r.data;
        await db.set('expiredNotified', false);
        if (r.prevSnap && s.notifications) {
          const items = S.filterForNotification(r.newItems, s);
          newItems = items.length;
          await notify(S.buildNotifications(items, data, 4, lang(s)).map((n, i) => ({ key: `new:${Date.now()}:${i}`, ...n })));
        }
        setBadge(r.feed);
        chrome.runtime.sendMessage({ type: 'synced' }).catch(() => {}); // onglet ouvert → il se rafraîchit
      } catch (e) {
        if (isAuthError(e) && !(await db.get('expiredNotified'))) {
          await db.set('expiredNotified', true);
          if (s.notifications) await notify([{ key: 'expired', title: say(s, 'expiredTitle'), body: say(s, 'expiredBody') }]);
        }
      }
    }
    return { newItems, reminders: await reminders(data, s) };
  })();
  try { return await checking; } finally { checking = null; }
}

async function openApp() {
  try {
    const tabs = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [APP] });
    if (tabs.length && tabs[0].tabId >= 0) {
      const tab = await chrome.tabs.update(tabs[0].tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch { /* on ouvre un nouvel onglet */ }
  chrome.tabs.create({ url: APP });
}

chrome.runtime.onInstalled.addListener((details) => {
  schedule();
  if (details.reason === 'install') chrome.tabs.create({ url: APP });
});
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) check(); });
chrome.action.onClicked.addListener(openApp);
chrome.notifications.onClicked.addListener((id) => { openApp(); chrome.notifications.clear(id); });
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return false;
  if (msg.type === 'schedule') schedule();
  if (msg.type === 'test') settings().then((s) => notify([{ key: 'test', title: say(s, 'testTitle'), body: say(s, 'testBody') }]));
  if (msg.type === 'check') { check().then(reply); return true; }
  return false;
});
