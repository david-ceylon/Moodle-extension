'use strict';
/**
 * Synchronisation : récupère tout ce qui compte sur Moodle, le met en forme pour l'interface,
 * puis compare avec la synchronisation précédente pour produire le fil des nouveautés.
 *
 * Fonctions pures (pas d'Electron ici) → testables avec `npm test`.
 */

const DAY = 86400;
const FIRST_SYNC_WINDOW = 14 * DAY; // à la 1re synchro, on considère « nouveau » ce qui date de moins de 14 jours
const FEED_MAX = 500;
const IGNORED_MODULES = new Set(['label', 'qbank']);

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cmidFromUrl(url) {
  const m = /\/mod\/\w+\/view\.php\?id=(\d+)/.exec(url || '');
  return m ? Number(m[1]) : null;
}

function normalizeFile(f, client) {
  return {
    name: f.filename,
    path: (f.filepath || '/') + f.filename,
    type: f.type, // 'file' | 'url' | 'content'
    url: f.type === 'url' ? f.fileurl : client.fileUrl(f.fileurl),
    size: f.filesize || 0,
    mimetype: f.mimetype || '',
    time: f.timemodified || f.timecreated || 0,
    created: f.timecreated || f.timemodified || 0,
  };
}

function normalizeModule(m, client) {
  const files = (m.contents || [])
    .filter((f) => f.type === 'file' || f.type === 'url')
    // Les pages (mod_page) ont un "index.html" interne qui n'intéresse personne.
    .filter((f) => !(m.modname === 'page' && f.filename === 'index.html'))
    .filter((f) => !(m.modname === 'book' && f.filename === 'index.html'))
    .map((f) => normalizeFile(f, client));
  const dates = (m.dates || []).map((d) => ({ label: d.label, time: d.timestamp }));
  return {
    id: m.id,
    name: m.name,
    modname: m.modname,
    url: m.url || null,
    description: stripHtml(m.description).slice(0, 600),
    visible: m.uservisible !== false,
    availability: m.availabilityinfo ? stripHtml(m.availabilityinfo) : null,
    completion: m.completiondata ? m.completiondata.state : null,
    dates,
    files,
    lastModified: m.contentsinfo?.lastmodified || Math.max(0, ...files.map((f) => f.time)),
  };
}

function normalizeCourse(c, contents, client) {
  const sections = (contents || []).map((s) => ({
    id: s.id,
    name: s.name || `Section ${s.section}`,
    summary: stripHtml(s.summary).slice(0, 400),
    modules: (s.modules || []).filter((m) => !IGNORED_MODULES.has(m.modname)).map((m) => normalizeModule(m, client)),
  }));
  return {
    id: c.id,
    fullname: stripHtml(c.displayname || c.fullname),
    shortname: c.shortname,
    summary: stripHtml(c.summary).slice(0, 500),
    progress: typeof c.progress === 'number' ? Math.round(c.progress) : null,
    lastaccess: c.lastaccess || 0,
    favourite: !!c.isfavourite,
    hidden: !!c.hidden,
    startdate: c.startdate || 0,
    enddate: c.enddate || 0,
    sections,
    announcements: [],
    grades: [],
    courseGrade: null,
  };
}

/** Récupère toutes les données Moodle. `onProgress(texte, ratio)` sert à la barre de progression. */
async function fetchEverything(client, { onProgress = () => {}, now = Math.floor(Date.now() / 1000) } = {}) {
  onProgress('Profil…', 0.02);
  const info = await client.call('core_webservice_get_site_info');
  const userid = info.userid;

  onProgress('Liste des cours…', 0.05);
  const rawCourses = await client.call('core_enrol_get_users_courses', { userid });

  let doneCount = 0;
  const courses = await mapLimit(rawCourses, 4, async (c) => {
    const contents = await client.tryCall('core_course_get_contents', { courseid: c.id }, []);
    const course = normalizeCourse(c, contents, client);
    const gradeItems = await client.tryCall('gradereport_user_get_grade_items', { courseid: c.id, userid }, null);
    const items = gradeItems?.usergrades?.[0]?.gradeitems || [];
    course.grades = items
      .filter((g) => g.itemtype !== 'course' && g.itemtype !== 'category')
      .filter((g) => g.graderaw !== null && g.graderaw !== undefined)
      .map((g) => ({
        id: g.id,
        name: stripHtml(g.itemname) || 'Note',
        grade: g.gradeformatted,
        max: g.grademax,
        percentage: g.percentageformatted,
        feedback: stripHtml(g.feedback).slice(0, 400),
        time: g.gradedategraded || g.gradedatesubmitted || 0,
        moduleId: g.cmid || null,
      }));
    const total = items.find((g) => g.itemtype === 'course');
    if (total && total.gradeformatted && total.gradeformatted !== '-') course.courseGrade = total.gradeformatted;
    doneCount++;
    onProgress(`Cours ${doneCount}/${rawCourses.length} : ${course.fullname}`, 0.08 + 0.7 * (doneCount / Math.max(1, rawCourses.length)));
    return course;
  });

  // Annonces (forums de type « news »)
  onProgress('Annonces…', 0.8);
  const courseIds = courses.map((c) => c.id);
  const forums = courseIds.length ? await client.tryCall('mod_forum_get_forums_by_courses', { courseids: courseIds }, []) : [];
  const newsForums = (forums || []).filter((f) => f.type === 'news');
  await mapLimit(newsForums, 4, async (f) => {
    let res = await client.tryCall('mod_forum_get_forum_discussions', { forumid: f.id, sortorder: 3, page: 0, perpage: 15 }, null);
    if (!res) res = await client.tryCall('mod_forum_get_forum_discussions_paginated', { forumid: f.id, sortby: 'timemodified', sortdirection: 'DESC', page: 0, perpage: 15 }, null);
    const course = courses.find((c) => c.id === f.course);
    if (!course || !res) return;
    course.announcements = (res.discussions || []).map((d) => ({
      id: d.discussion || d.id,
      subject: d.subject || d.name,
      message: stripHtml(d.message).slice(0, 4000),
      author: d.userfullname,
      authorPicture: d.userpictureurl,
      time: d.created || d.timemodified || d.modified,
      attachments: (d.attachments || []).map((a) => ({ name: a.filename, url: client.fileUrl(a.fileurl), size: a.filesize, mimetype: a.mimetype })),
    }));
  });

  // Échéances (devoirs, quiz…)
  onProgress('Échéances…', 0.88);
  const events = await client.tryCall('core_calendar_get_action_events_by_timesort', { timesortfrom: now - 7 * DAY, limitnum: 50 }, { events: [] });
  const deadlines = (events?.events || []).map((e) => ({
    id: e.id,
    name: e.activityname || e.name,
    title: e.name,
    courseId: e.course?.id || e.courseid,
    courseName: e.course ? stripHtml(e.course.fullname) : '',
    time: e.timesort || e.timestart,
    modname: e.modulename,
    url: e.action?.url || e.url,
    actionName: e.action?.name || null,
    actionable: e.action ? !!e.action.actionable : false,
    overdue: (e.timesort || e.timestart) < now,
    cmid: e.cmid || cmidFromUrl(e.url),
  }));

  // Notifications (hors forums, déjà couverts par les annonces)
  onProgress('Notifications…', 0.94);
  const notifRes = await client.tryCall('message_popup_get_popup_notifications', { useridto: userid, limit: 40, offset: 0, newestfirst: 1 }, null);
  const notifications = (notifRes?.notifications || [])
    .filter((n) => n.component !== 'mod_forum')
    .map((n) => ({
      id: n.id,
      subject: stripHtml(n.subject),
      text: stripHtml(n.smallmessage || n.fullmessage).slice(0, 500),
      url: n.contexturl || null,
      time: n.timecreated,
      component: n.component,
    }));

  return {
    site: {
      name: stripHtml(info.sitename),
      url: info.siteurl,
      release: info.release,
      user: { id: userid, fullname: info.fullname, firstname: info.firstname, picture: info.userpictureurl },
    },
    courses,
    deadlines,
    notifications,
  };
}

/** Construit l'instantané (ce qui existe actuellement) utilisé pour la comparaison. */
function buildSnapshot(data) {
  const snap = {};
  for (const c of data.courses) {
    for (const s of c.sections) {
      for (const m of s.modules) {
        snap[`m:${m.id}`] = 1;
        for (const f of m.files) snap[`f:${m.id}:${f.path}`] = f.time;
      }
    }
    for (const a of c.announcements) snap[`d:${a.id}`] = a.time;
    for (const g of c.grades) snap[`g:${c.id}:${g.id}`] = String(g.grade);
  }
  for (const n of data.notifications) snap[`n:${n.id}`] = n.time;
  return snap;
}

/**
 * Compare la nouvelle récupération avec l'instantané précédent et renvoie les nouveaux éléments du fil.
 * @param {object} data      résultat de fetchEverything
 * @param {object|null} prevSnap  instantané précédent (null à la toute 1re synchro)
 * @param {number} prevSyncTime   date (s) de la synchro précédente
 */
function diff(data, prevSnap, prevSyncTime, now = Math.floor(Date.now() / 1000)) {
  const first = !prevSnap;
  const recent = (t) => t && t >= now - FIRST_SYNC_WINDOW;
  // Date affichée : la vraie date si elle est postérieure à la dernière synchro, sinon la date de détection.
  const when = (t) => (first ? t : t && t > prevSyncTime ? Math.min(t, now) : now);
  const items = [];

  for (const c of data.courses) {
    for (const s of c.sections) {
      for (const m of s.modules) {
        if (!m.visible) continue;
        const moduleKnown = !first && prevSnap[`m:${m.id}`];
        const newFiles = [];
        const updatedFiles = [];
        for (const f of m.files) {
          const key = `f:${m.id}:${f.path}`;
          if (first) {
            if (recent(f.time)) newFiles.push(f);
          } else if (!(key in prevSnap)) {
            newFiles.push(f);
          } else if (f.time > prevSnap[key]) {
            updatedFiles.push(f);
          }
        }
        const base = { courseId: c.id, sectionId: s.id, sectionName: s.name, moduleId: m.id, modname: m.modname, title: m.name, url: m.url };
        if (!first && !moduleKnown) {
          items.push({ ...base, key: `m:${m.id}`, type: 'new_module', files: m.files, time: when(m.lastModified) });
        } else if (newFiles.length) {
          // 1re synchro : un module dont TOUS les fichiers sont récents est présenté comme « ajouté »
          const type = first && newFiles.length === m.files.length ? 'new_module' : 'new_files';
          items.push({ ...base, key: `nf:${m.id}:${now}`, type, files: newFiles, time: when(Math.max(...newFiles.map((f) => f.time))) });
        }
        if (updatedFiles.length) {
          items.push({ ...base, key: `uf:${m.id}:${now}`, type: 'updated_files', files: updatedFiles, time: when(Math.max(...updatedFiles.map((f) => f.time))) });
        }
      }
    }

    for (const a of c.announcements) {
      const isNew = first ? recent(a.time) : !(`d:${a.id}` in prevSnap);
      if (isNew) items.push({ key: `d:${a.id}`, type: 'announcement', courseId: c.id, announcementId: a.id, title: a.subject, text: a.message.slice(0, 300), author: a.author, time: when(a.time) });
    }

    for (const g of c.grades) {
      const key = `g:${c.id}:${g.id}`;
      const isNew = first ? recent(g.time) : !(key in prevSnap) || prevSnap[key] !== String(g.grade);
      if (isNew) items.push({ key: `${key}:${g.grade}`, type: 'grade', courseId: c.id, moduleId: g.moduleId, title: g.name, grade: g.grade, max: g.max, time: when(g.time) });
    }
  }

  for (const n of data.notifications) {
    const isNew = first ? recent(n.time) : !(`n:${n.id}` in prevSnap);
    if (isNew) items.push({ key: `n:${n.id}`, type: 'notification', title: n.subject, text: n.text, url: n.url, time: when(n.time) });
  }

  return items.map((it) => ({ ...it, id: it.key, read: false, detectedAt: now }));
}

/** Fusionne les nouveaux éléments dans le fil existant (sans doublons, triés, limité en taille). */
function mergeFeed(feed, newItems) {
  const seen = new Set(feed.map((i) => i.id));
  const merged = [...newItems.filter((i) => !seen.has(i.id)), ...feed];
  merged.sort((a, b) => b.time - a.time);
  return merged.slice(0, FEED_MAX);
}

// ---------------------------------------------------------------------------
// Notifications et rappels (utilisés par l'ordinateur, la web-app et la tâche
// d'arrière-plan Android). Volontairement sans Intl ni URL : le moteur JavaScript
// d'arrière-plan d'Android (QuickJS) ne les fournit pas forcément.
// ---------------------------------------------------------------------------

const DEFAULT_NOTIFY = { notifyContent: true, notifyAnnouncements: true, notifyGrades: true, notifyReminders: true };

// Textes des notifications (français, anglais, hébreu)
const NT = {
  fr: {
    days: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
    months: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
    today: (h) => `aujourd’hui à ${h}`, tomorrow: (h) => `demain à ${h}`, date: (day, d, m, h) => `${day} ${d} ${m} à ${h}`,
    hours: (h, m) => `${h} h${m ? ' ' + m : ''}`, minutes: (m) => `${m} min`,
    newFolder: 'Nouveau dossier', newFile: 'Nouveau fichier', newActivity: 'Nouvelle activité',
    newFiles: (n) => (n > 1 ? `${n} nouveaux fichiers` : 'Nouveau fichier'), updated: 'Fichier mis à jour',
    announcement: 'Annonce', grade: 'Nouvelle note', many: (c, n) => `${c} : ${n} nouveautés`, others: (n) => `Et ${n} autres cours mis à jour`,
    due: (left, when, course) => `À rendre dans ${left} (${when})${course ? ' · ' + course : ''}`,
  },
  en: {
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    today: (h) => `today at ${h}`, tomorrow: (h) => `tomorrow at ${h}`, date: (day, d, m, h) => `${day} ${d} ${m} at ${h}`,
    hours: (h, m) => `${h} h${m ? ' ' + m : ''}`, minutes: (m) => `${m} min`,
    newFolder: 'New folder', newFile: 'New file', newActivity: 'New activity',
    newFiles: (n) => (n > 1 ? `${n} new files` : 'New file'), updated: 'File updated',
    announcement: 'Announcement', grade: 'New grade', many: (c, n) => `${c}: ${n} updates`, others: (n) => `And ${n} more courses updated`,
    due: (left, when, course) => `Due in ${left} (${when})${course ? ' · ' + course : ''}`,
  },
  he: {
    days: ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'],
    months: ['בינו׳', 'בפבר׳', 'במרץ', 'באפר׳', 'במאי', 'ביוני', 'ביולי', 'באוג׳', 'בספט׳', 'באוק׳', 'בנוב׳', 'בדצמ׳'],
    today: (h) => `היום ב-${h}`, tomorrow: (h) => `מחר ב-${h}`, date: (day, d, m, h) => `${day}, ${d} ${m} ב-${h}`,
    hours: (h, m) => (m ? `${h}:${m} שע׳` : `${h} שע׳`), minutes: (m) => `${m} דק׳`,
    newFolder: 'תיקייה חדשה', newFile: 'קובץ חדש', newActivity: 'פעילות חדשה',
    newFiles: (n) => (n > 1 ? `${n} קבצים חדשים` : 'קובץ חדש'), updated: 'קובץ עודכן',
    announcement: 'הודעה', grade: 'ציון חדש', many: (c, n) => `${c}: ${n} עדכונים`, others: (n) => `ועוד ${n} קורסים עודכנו`,
    due: (left, when, course) => `להגשה בעוד ${left} (${when})${course ? ' · ' + course : ''}`,
  },
};
const tx = (lang) => NT[lang] || NT.fr;

/** Garde uniquement les nouveautés dont l'utilisateur veut être prévenu. */
function filterForNotification(items, settings) {
  const s = { ...DEFAULT_NOTIFY, ...(settings || {}) };
  return items.filter((i) => {
    if (i.type === 'announcement') return s.notifyAnnouncements;
    if (i.type === 'grade') return s.notifyGrades;
    return s.notifyContent; // fichiers, dossiers, activités, notifications Moodle
  });
}

function describeItem(i, lang) {
  const T = tx(lang);
  const files = i.files || [];
  const names = files.slice(0, 3).map((f) => f.name).join(', ') + (files.length > 3 ? '…' : '');
  switch (i.type) {
    case 'new_module': return { label: i.modname === 'folder' ? T.newFolder : i.modname === 'resource' ? T.newFile : T.newActivity, text: i.title + (names && i.modname === 'folder' ? ` (${names})` : '') };
    case 'new_files': return { label: T.newFiles(files.length), text: `${names} — ${i.title}` };
    case 'updated_files': return { label: T.updated, text: `${names} — ${i.title}` };
    case 'announcement': return { label: T.announcement, text: i.title + (i.text ? ` : ${i.text.slice(0, 120)}` : ''), short: true };
    case 'grade': return { label: T.grade, text: `${i.title} : ${i.grade}${i.max ? ' / ' + Number(i.max) : ''}`, short: true };
    default: return { label: 'Moodle', text: i.title };
  }
}

/** Regroupe les nouveautés par cours : une notification par cours (au plus `max`), plus un résumé si besoin. */
function buildNotifications(items, data, max = 4, lang = 'fr') {
  const T = tx(lang);
  const courseName = (id) => {
    const c = (data && data.courses || []).find((x) => x.id === id);
    return c ? (c.shortname || c.fullname) : 'Moodle';
  };
  const groups = new Map();
  for (const i of items) {
    const k = i.courseId || 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const out = [];
  for (const [courseId, list] of groups) {
    const name = courseId ? courseName(courseId) : 'Moodle';
    if (list.length === 1) {
      const d = describeItem(list[0], lang);
      out.push({ courseId, title: `${d.label} · ${name}`, body: d.text });
    } else {
      const descs = list.map((i) => describeItem(i, lang));
      const lines = descs.map((d) => `• ${d.label} : ${d.text}`);
      const short = list.map((i, k) => (descs[k].short ? `${descs[k].label} : ${i.title}` : i.title));
      out.push({ courseId, title: T.many(name, list.length), body: short.slice(0, 4).join(' · '), largeBody: lines.slice(0, 8).join('\n') });
    }
  }
  if (out.length > max) {
    const rest = out.splice(max - 1);
    out.push({ courseId: 0, title: T.others(rest.length), body: rest.map((n) => n.title).join(' · ') });
  }
  return out;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** « aujourd'hui à 12:12 », « demain à 9:00 », « mercredi 25 nov. à 12:12 » (heure locale). */
function formatDue(ts, now = Math.floor(Date.now() / 1000), lang = 'fr') {
  const T = tx(lang);
  const d = new Date(ts * 1000);
  const dayStart = (t) => { const x = new Date(t * 1000); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const diffDays = Math.round((dayStart(ts) - dayStart(now)) / 86400000);
  const hour = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (diffDays === 0) return T.today(hour);
  if (diffDays === 1) return T.tomorrow(hour);
  return T.date(T.days[d.getDay()], d.getDate(), T.months[d.getMonth()], hour);
}

function formatLeft(seconds, lang) {
  const T = tx(lang);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 1) return T.hours(h, m && h < 10 ? pad2(m) : '');
  return T.minutes(Math.max(1, m));
}

/**
 * Rappels d'échéances : un rappel quand il reste moins de 24 h, un autre quand il reste moins de 2 h.
 * Pensé pour être appelé régulièrement (toutes les 15-30 min) : on envoie le rappel dès qu'on entre
 * dans la fenêtre, et `sent` mémorise ce qui a déjà été envoyé. Un devoir déjà rendu disparaît
 * de la liste des échéances Moodle, donc il ne déclenche plus de rappel.
 * @returns {{ reminders: Array<{key,title,body}>, sent: object }}
 */
function dueReminders(deadlines, sent, now, data, lang = 'fr') {
  const T = tx(lang);
  const out = [];
  const next = {};
  const courseName = (d) => {
    const c = (data && data.courses || []).find((x) => x.id === d.courseId);
    return c ? (c.shortname || c.fullname) : (d.courseName || '');
  };
  for (const d of deadlines || []) {
    if (d.actionable === false) continue;
    const left = d.time - now;
    if (left <= 0) continue;
    const k24 = `${d.id}:24`;
    const k2 = `${d.id}:2`;
    if (sent && sent[k24]) next[k24] = sent[k24];
    if (sent && sent[k2]) next[k2] = sent[k2];
    let which = null;
    if (left <= 2 * 3600 && !next[k2]) which = '2';
    else if (left <= 24 * 3600 && !next[k24] && !next[k2]) which = '24';
    if (!which) continue;
    next[k24] = now;
    if (which === '2') next[k2] = now;
    out.push({
      key: which === '2' ? k2 : k24,
      title: `⏰ ${d.name}`,
      body: T.due(formatLeft(left, lang), formatDue(d.time, now, lang), courseName(d)),
    });
  }
  return { reminders: out, sent: next };
}

/** Identifiant numérique stable (32 bits) pour une notification Android. */
function notificationId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000 + 1;
}

const MoodleSync = {
  fetchEverything, buildSnapshot, diff, mergeFeed, normalizeCourse, stripHtml, mapLimit,
  filterForNotification, buildNotifications, dueReminders, formatDue, notificationId, DEFAULT_NOTIFY,
};
if (typeof module !== 'undefined' && module.exports) module.exports = MoodleSync;
else globalThis.MoodleSync = MoodleSync;
