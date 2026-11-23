'use strict';
/**
 * Faux Moodle pour le mode démonstration (`npm run demo`) : permet de voir l'interface
 * sans compte. Chaque nouvelle synchronisation « publie » un nouveau contenu pour montrer le fil des nouveautés.
 */

const H = 3600;
const D = 86400;
const SITE = 'https://moodle.demo-universite.fr';

const COURSES = [
  { id: 101, fullname: 'Algorithmique et structures de données', shortname: 'INF301', progress: 62, fav: true },
  { id: 102, fullname: 'Bases de données relationnelles', shortname: 'INF305', progress: 48 },
  { id: 103, fullname: 'Réseaux et protocoles', shortname: 'INF310', progress: 35 },
  { id: 104, fullname: 'Mathématiques discrètes', shortname: 'MAT220', progress: 71 },
  { id: 105, fullname: 'Anglais scientifique', shortname: 'ANG201', progress: 80 },
  { id: 106, fullname: 'Gestion de projet agile', shortname: 'GP200', progress: 20 },
];

const TOPICS = {
  101: ['Complexité', 'Tris', 'Listes chaînées', 'Arbres binaires', 'Graphes', 'Programmation dynamique'],
  102: ['Modèle relationnel', 'SQL de base', 'Jointures', 'Normalisation', 'Transactions'],
  103: ['Modèle OSI', 'Couche liaison', 'IP et routage', 'TCP / UDP', 'Sécurité réseau'],
  104: ['Logique', 'Ensembles', 'Récurrence', 'Combinatoire', 'Graphes'],
  105: ['Writing an abstract', 'Presentations', 'Scientific vocabulary'],
  106: ['Introduction Scrum', 'User stories', 'Sprints', 'Rétrospectives'],
};

let cmSeq = 5000;
let extraRound = 0;
const extras = []; // contenus ajoutés au fil des synchros démo

function pdf(name, t, size = 350000) {
  return { type: 'file', filename: name, filepath: '/', filesize: size, fileurl: `${SITE}/webservice/pluginfile.php/1/mod_resource/content/0/${encodeURIComponent(name)}`, timecreated: t, timemodified: t, mimetype: 'application/pdf' };
}
function file(name, mimetype, t, size = 120000) {
  return { ...pdf(name, t, size), mimetype };
}

function buildContents(course, now) {
  const topics = TOPICS[course.id];
  const sections = [
    {
      id: course.id * 100,
      section: 0,
      name: 'Généralités',
      summary: `<p>Bienvenue dans le cours <b>${course.fullname}</b>. Toutes les informations pratiques sont ici.</p>`,
      modules: [
        { id: course.id * 10, name: 'Annonces', modname: 'forum', url: `${SITE}/mod/forum/view.php?id=${course.id * 10}` },
        { id: course.id * 10 + 1, name: 'Plan du cours et modalités d\'évaluation', modname: 'resource', url: `${SITE}/mod/resource/view.php?id=${course.id * 10 + 1}`, contents: [pdf(`Syllabus_${course.shortname}.pdf`, now - 60 * D)] },
      ],
    },
  ];
  topics.forEach((topic, i) => {
    const age = (topics.length - i) * 6 * D; // les derniers chapitres sont récents
    const t = now - age;
    const base = course.id * 1000 + i * 10;
    const mods = [
      { id: base + 1, name: `CM ${i + 1} — ${topic}`, modname: 'resource', url: `${SITE}/mod/resource/view.php?id=${base + 1}`, contents: [pdf(`CM${i + 1}_${topic.replace(/[^\p{L}\p{N}]+/gu, '_')}.pdf`, t, 900000 + i * 40000)] },
      {
        id: base + 2,
        name: `TD ${i + 1} — Exercices`,
        modname: 'folder',
        url: `${SITE}/mod/folder/view.php?id=${base + 2}`,
        description: 'Énoncés et corrigés (les corrigés sont publiés après la séance).',
        contents: [pdf(`TD${i + 1}_enonce.pdf`, t + 2 * H), ...(i < topics.length - 1 ? [pdf(`TD${i + 1}_corrige.pdf`, t + 5 * D)] : [])],
      },
    ];
    if (i % 2 === 1) {
      mods.push({ id: base + 3, name: `TP ${Math.ceil(i / 2)} — Mise en pratique`, modname: 'assign', url: `${SITE}/mod/assign/view.php?id=${base + 3}`, description: 'Déposez une archive .zip contenant votre code et un court rapport PDF.', dates: [{ label: 'À rendre', timestamp: t + 14 * D }], contents: [] });
    }
    if (i === 2) mods.push({ id: base + 4, name: `Quiz d'entraînement : ${topic}`, modname: 'quiz', url: `${SITE}/mod/quiz/view.php?id=${base + 4}`, contents: [] });
    if (i === 0) mods.push({ id: base + 5, name: 'Vidéo de la séance (enregistrement)', modname: 'url', url: `${SITE}/mod/url/view.php?id=${base + 5}`, contents: [{ type: 'url', filename: 'Vidéo', fileurl: 'https://example.org/video', timecreated: t, timemodified: t }] });
    sections.push({ id: course.id * 100 + i + 1, section: i + 1, name: `Chapitre ${i + 1} : ${topic}`, summary: '', modules: mods });
  });
  for (const e of extras.filter((x) => x.course === course.id)) {
    sections[sections.length - 1].modules.push(e.module);
  }
  return sections;
}

function createDemoClient() {
  const start = Math.floor(Date.now() / 1000);
  const now = () => Math.floor(Date.now() / 1000);
  const announcements = {
    101: [
      { subject: 'Partiel : salle et horaires', message: 'Le partiel aura lieu le 15 décembre à 9h en amphi B. Documents non autorisés, calculatrice interdite.', created: start - 1 * D, author: 'Claire Martin' },
      { subject: 'Correction du TD 4 disponible', message: 'La correction est en ligne dans le dossier du TD 4. Pensez à la relire avant le TP.', created: start - 6 * D, author: 'Claire Martin' },
    ],
    102: [{ subject: 'Cours annulé jeudi', message: 'Le cours de jeudi est annulé (grève des transports). Il sera rattrapé le lundi suivant de 14h à 16h.', created: start - 2 * D, author: 'Karim Benali' }],
    103: [{ subject: 'Projet réseau : groupes', message: 'Les groupes de projet sont à constituer avant vendredi (3 ou 4 étudiants). Inscription via le sondage.', created: start - 3 * D, author: 'Julie Robert' }],
    106: [{ subject: 'Bienvenue !', message: 'Bienvenue dans le module de gestion de projet. Le premier sprint commence la semaine prochaine.', created: start - 20 * D, author: 'Marc Petit' }],
  };

  const handlers = {
    core_webservice_get_site_info: () => ({ sitename: 'Moodle — Université de Démonstration', siteurl: SITE, userid: 7, fullname: 'Étudiant Démo', firstname: 'Étudiant', userpictureurl: '', release: '4.3 (demo)' }),
    core_enrol_get_users_courses: () => COURSES.map((c) => ({ id: c.id, fullname: c.fullname, displayname: c.fullname, shortname: c.shortname, progress: c.progress, isfavourite: !!c.fav, lastaccess: start - c.id * 3600, summary: '' })),
    core_course_get_contents: ({ courseid }) => buildContents(COURSES.find((c) => c.id === courseid), start),
    gradereport_user_get_grade_items: ({ courseid }) => {
      const items = [];
      if (courseid === 101) items.push({ id: 1, itemname: 'TP 1 — Mise en pratique', itemtype: 'mod', cmid: 101013, graderaw: 15.5, gradeformatted: '15,50', grademax: 20, percentageformatted: '77,50 %', gradedategraded: start - 2 * D, feedback: 'Très bon travail, attention à la complexité de votre fonction de tri.' });
      if (courseid === 104) items.push({ id: 2, itemname: 'Contrôle continu 1', itemtype: 'manual', graderaw: 12, gradeformatted: '12,00', grademax: 20, percentageformatted: '60,00 %', gradedategraded: start - 4 * D });
      if (courseid === 105) items.push({ id: 3, itemname: 'Oral presentation', itemtype: 'manual', graderaw: 17, gradeformatted: '17,00', grademax: 20, percentageformatted: '85,00 %', gradedategraded: start - 25 * D });
      items.push({ id: 99, itemtype: 'course', gradeformatted: items.length ? items[0].gradeformatted : '-' });
      return { usergrades: [{ gradeitems: items }] };
    },
    mod_forum_get_forums_by_courses: () => COURSES.map((c) => ({ id: c.id * 10, course: c.id, type: 'news', name: 'Annonces' })),
    mod_forum_get_forum_discussions: ({ forumid }) => ({
      discussions: (announcements[forumid / 10] || []).map((a, i) => ({ id: forumid * 100 + i, discussion: forumid * 100 + i, subject: a.subject, message: `<p>${a.message}</p>`, created: a.created, timemodified: a.created, userfullname: a.author })),
    }),
    core_calendar_get_action_events_by_timesort: () => ({
      events: [
        { id: 1, name: 'TP 2 — Mise en pratique est à remettre', activityname: 'TP 2 — Mise en pratique', course: { id: 101, fullname: COURSES[0].fullname }, timesort: start + 2 * D + 5 * H, modulename: 'assign', url: `${SITE}/mod/assign/view.php?id=101033`, action: { name: 'Remettre un travail', actionable: true } },
        { id: 2, name: 'Quiz d\'entraînement : Jointures ferme', activityname: 'Quiz d\'entraînement : Jointures', course: { id: 102, fullname: COURSES[1].fullname }, timesort: start + 18 * H, modulename: 'quiz', url: `${SITE}/mod/quiz/view.php?id=102024`, action: { name: 'Faire le test', actionable: true } },
        { id: 3, name: 'TP 1 — Mise en pratique est à remettre', activityname: 'TP 1 — Mise en pratique', course: { id: 103, fullname: COURSES[2].fullname }, timesort: start + 6 * D, modulename: 'assign', url: `${SITE}/mod/assign/view.php?id=103013`, action: { name: 'Remettre un travail', actionable: true } },
        { id: 4, name: 'Rapport de sprint est à remettre', activityname: 'Rapport de sprint', course: { id: 106, fullname: COURSES[5].fullname }, timesort: start - 1 * D, modulename: 'assign', url: `${SITE}/mod/assign/view.php?id=106013`, action: { name: 'Remettre un travail', actionable: true } },
        { id: 5, name: 'Devoir maison 3 est à remettre', activityname: 'Devoir maison 3', course: { id: 104, fullname: COURSES[3].fullname }, timesort: start + 12 * D, modulename: 'assign', url: `${SITE}/mod/assign/view.php?id=104033`, action: { name: 'Remettre un travail', actionable: true } },
      ],
    }),
    message_popup_get_popup_notifications: () => ({
      notifications: [
        { id: 1, subject: 'Votre travail « TP 1 — Mise en pratique » a été évalué', smallmessage: 'Claire Martin a laissé un feedback sur votre remise.', component: 'mod_assign', timecreated: start - 2 * D, contexturl: `${SITE}/mod/assign/view.php?id=101013` },
      ],
    }),
  };

  return {
    demo: true,
    siteUrl: SITE,
    token: 'demo',
    async call(fn, args) {
      await new Promise((r) => setTimeout(r, 40));
      if (!handlers[fn]) throw Object.assign(new Error('Fonction absente en démo'), { code: 'invalidfunction' });
      return handlers[fn](args || {});
    },
    async tryCall(fn, args, fallback = null) {
      try { return await this.call(fn, args); } catch { return fallback; }
    },
    fileUrl: (u) => u,
    /** Simule la publication d'un nouveau contenu par un enseignant. */
    publishSomething() {
      extraRound++;
      const t = now();
      const course = COURSES[extraRound % COURSES.length];
      const id = ++cmSeq;
      const kinds = [
        { name: `Annales d'examen ${2020 + extraRound}`, modname: 'folder', contents: [pdf(`Examen_${2020 + extraRound}_sujet.pdf`, t), pdf(`Examen_${2020 + extraRound}_corrige.pdf`, t)] },
        { name: 'Diaporama — séance de révision', modname: 'resource', contents: [file('Revisions.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', t, 4200000)] },
        { name: 'Jeu de données pour le TP', modname: 'resource', contents: [file('dataset.csv', 'text/csv', t, 80000)] },
      ];
      const k = kinds[extraRound % kinds.length];
      extras.push({ course: course.id, module: { id, url: `${SITE}/mod/${k.modname}/view.php?id=${id}`, ...k } });
    },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createDemoClient };
else globalThis.MoodleDemo = { createDemoClient };
