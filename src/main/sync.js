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

const MoodleSync = { fetchEverything, buildSnapshot, diff, mergeFeed, normalizeCourse, stripHtml, mapLimit };
if (typeof module !== 'undefined' && module.exports) module.exports = MoodleSync;
else globalThis.MoodleSync = MoodleSync;
