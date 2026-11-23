// Moodle+ — interface (Preact + htm, sans étape de compilation)
import { html, render, useState, useEffect, useMemo, useRef, useCallback } from '../../node_modules/htm/preact/standalone.module.js';

const api = window.moodle;

// ===========================================================================
// Icônes (style « lucide », dessinées en SVG)
// ===========================================================================
const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  sparkles: '<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  files: '<path d="M15 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M15 2v5h5"/><path d="M4 7v13a2 2 0 0 0 2 2h10"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  chevron: '<polyline points="9 18 15 12 9 6"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkAll: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  quiz: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};

function Icon({ name, cls = '' }) {
  return html`<svg class=${'icon ' + cls} viewBox="0 0 24 24" dangerouslySetInnerHTML=${{ __html: ICONS[name] || ICONS.file }}></svg>`;
}

// ===========================================================================
// Utilitaires
// ===========================================================================
const PALETTE = ['#5b5bf0', '#e5484d', '#12a594', '#e2711d', '#8e4ec6', '#2f6fe4', '#d6409f', '#1d9a57', '#c28a00', '#0891b2', '#6e56cf', '#e54666'];

const MODS = {
  resource: { icon: 'file', color: '#2f6fe4', label: 'Fichier' },
  folder: { icon: 'folder', color: '#d99100', label: 'Dossier' },
  assign: { icon: 'clipboard', color: '#e2711d', label: 'Devoir' },
  quiz: { icon: 'quiz', color: '#d6409f', label: 'Test' },
  url: { icon: 'link', color: '#12a594', label: 'Lien' },
  forum: { icon: 'message', color: '#8e4ec6', label: 'Forum' },
  page: { icon: 'fileText', color: '#64748b', label: 'Page' },
  book: { icon: 'book', color: '#0891b2', label: 'Livre' },
  lesson: { icon: 'book', color: '#0891b2', label: 'Leçon' },
  glossary: { icon: 'book', color: '#0891b2', label: 'Glossaire' },
  wiki: { icon: 'edit', color: '#0891b2', label: 'Wiki' },
  choice: { icon: 'check', color: '#1d9a57', label: 'Sondage' },
  feedback: { icon: 'check', color: '#1d9a57', label: 'Questionnaire' },
  workshop: { icon: 'users', color: '#6e56cf', label: 'Atelier' },
  h5pactivity: { icon: 'sparkles', color: '#2f6fe4', label: 'H5P' },
  scorm: { icon: 'layers', color: '#2f6fe4', label: 'SCORM' },
  bigbluebuttonbn: { icon: 'video', color: '#e5484d', label: 'Visio' },
  zoom: { icon: 'video', color: '#2f6fe4', label: 'Zoom' },
  lti: { icon: 'external', color: '#64748b', label: 'Outil externe' },
};
const NEW_LABELS = {
  resource: 'Nouveau fichier', folder: 'Nouveau dossier', assign: 'Nouveau devoir', quiz: 'Nouveau test', url: 'Nouveau lien',
  forum: 'Nouveau forum', page: 'Nouvelle page', book: 'Nouveau livre', lesson: 'Nouvelle leçon', choice: 'Nouveau sondage',
  feedback: 'Nouveau questionnaire', bigbluebuttonbn: 'Nouvelle visio', zoom: 'Nouvelle visio', h5pactivity: 'Nouvelle activité H5P',
};
const modInfo = (m) => MODS[m] || { icon: 'layers', color: '#64748b', label: m || 'Activité' };

const EXT_COLORS = [
  [/^pdf$/, '#e5484d'], [/^docx?$|^odt$|^rtf$/, '#2f6fe4'], [/^xlsx?$|^csv$|^ods$/, '#1d9a57'], [/^pptx?$|^odp$/, '#e2711d'],
  [/^(zip|rar|7z|tar|gz)$/, '#8e4ec6'], [/^(png|jpe?g|gif|svg|webp)$/, '#12a594'], [/^(mp4|mov|avi|mkv|webm|mp3|wav)$/, '#d6409f'],
  [/^(py|java|c|cpp|h|js|ts|sql|ipynb|r|m|html|css|json)$/, '#475569'],
];
function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}
function extColor(ext) {
  for (const [re, c] of EXT_COLORS) if (re.test(ext)) return c;
  return '#8a91a3';
}
const FILE_KINDS = {
  pdf: (e) => e === 'pdf',
  office: (e) => /^(docx?|odt|rtf|xlsx?|csv|ods|pptx?|odp)$/.test(e),
  media: (e) => /^(png|jpe?g|gif|svg|webp|mp4|mov|avi|mkv|webm|mp3|wav)$/.test(e),
  archive: (e) => /^(zip|rar|7z|tar|gz)$/.test(e),
  code: (e) => /^(py|java|c|cpp|h|js|ts|sql|ipynb|r|m|html|css|json|txt|md)$/.test(e),
};

function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' o';
  if (b < 1048576) return Math.round(b / 1024) + ' Ko';
  return (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' Mo';
}
const nowS = () => Math.floor(Date.now() / 1000);
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function fmtRelative(ts) {
  if (!ts) return '';
  const d = ts - nowS();
  const a = Math.abs(d);
  if (a < 60) return 'à l’instant';
  if (a < 3600) return rtf.format(Math.round(d / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(d / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(d / 86400), 'day');
  return fmtDate(ts);
}
function fmtDate(ts, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(ts * 1000).toLocaleDateString('fr-FR', opts);
}
function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function startOfDay(ts) {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}
function dayLabel(ts) {
  const today = startOfDay(nowS());
  const day = startOfDay(ts);
  if (day === today) return 'Aujourd’hui';
  if (day === today - 86400) return 'Hier';
  if (day === today + 86400) return 'Demain';
  return new Date(ts * 1000).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function countdown(ts) {
  const d = ts - nowS();
  if (d < 0) return { text: 'En retard de ' + humanDuration(-d), cls: 'urg-high', level: 'overdue' };
  const cls = d < 86400 ? 'urg-high' : d < 3 * 86400 ? 'urg-mid' : 'urg-low';
  return { text: 'Dans ' + humanDuration(d), cls, level: cls };
}
function humanDuration(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d >= 2) return `${d} j${h ? ' ' + h + ' h' : ''}`;
  if (d === 1) return `1 j ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')}`;
  return `${m} min`;
}
function initials(name) {
  return String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}
function cover(c) {
  return `linear-gradient(135deg, ${c} 0%, color-mix(in srgb, ${c} 55%, #1a1040) 100%)`;
}
function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ===========================================================================
// Petits composants réutilisables
// ===========================================================================
function FileRow({ f, ctx, compact }) {
  const ext = extOf(f.name);
  const isLink = f.type === 'url';
  return html`
    <div class="file">
      <div class="file-ext" style=${{ background: isLink ? '#12a594' : extColor(ext) }}>${isLink ? html`<${Icon} name="link" cls="sm" />` : (ext || '?').slice(0, 4).toUpperCase()}</div>
      <div class="grow">
        <div class="file-name ellipsis" title=${f.name} onClick=${() => ctx.openFile(f)}>${isLink ? f.url : f.name}</div>
        ${!compact && html`<div class="faint small">${[fmtSize(f.size), f.time ? fmtRelative(f.time) : ''].filter(Boolean).join(' · ')}</div>`}
      </div>
      <div class="file-actions">
        <button class="btn ghost sm icon-only" title="Ouvrir" onClick=${() => ctx.openFile(f)}><${Icon} name=${isLink ? 'external' : 'eye'} cls="sm" /></button>
        ${!isLink && html`<button class="btn ghost sm icon-only" title="Enregistrer sous…" onClick=${() => ctx.saveFile(f)}><${Icon} name="download" cls="sm" /></button>`}
      </div>
    </div>`;
}

function CoursePill({ course, ctx }) {
  if (!course) return null;
  return html`<span class="pill course" style=${{ '--c': ctx.color(course.id) }} onClick=${(e) => { e.stopPropagation(); ctx.go({ view: 'course', courseId: course.id }); }} role="button">${course.shortname || course.fullname}</span>`;
}

function Empty({ icon = 'inbox', title, text, children }) {
  return html`<div class="empty"><${Icon} name=${icon} /><div style=${{ fontWeight: 650, fontSize: '15px', color: 'var(--text)' }}>${title}</div><div>${text}</div>${children}</div>`;
}

function Switch({ on, onChange }) {
  return html`<button class=${'switch' + (on ? ' on' : '')} onClick=${() => onChange(!on)} aria-pressed=${on}></button>`;
}

// ===========================================================================
// Écran de connexion
// ===========================================================================
function LoginScreen({ onLoggedIn, toast, expiredAccount }) {
  const [url, setUrl] = useState(() => {
    try { return expiredAccount?.siteUrl || localStorage.getItem('lastSite') || ''; } catch { return ''; }
  });
  const [site, setSite] = useState(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');

  const check = async (e) => {
    e && e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const s = await api.checkSite(url);
      setSite(s);
      try { localStorage.setItem('lastSite', url); } catch {}
    } catch (err) {
      setError(cleanErr(err) + ' — Vérifiez l’adresse (ex. moodle.mon-universite.fr).');
    } finally {
      setBusy(false);
    }
  };

  const login = async (s) => {
    setError('');
    setWaiting(true);
    try {
      const state = await api.login({ siteUrl: s.siteUrl, siteName: s.siteName, launchUrl: s.launchUrl });
      onLoggedIn(state);
    } catch (err) {
      setError(cleanErr(err));
    } finally {
      setWaiting(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    try { onLoggedIn(await api.startDemo()); } catch (err) { setError(cleanErr(err)); } finally { setBusy(false); }
  };

  return html`
    <div class="login-wrap">
      <div class="card login-card">
        <div class="brand-logo" style=${{ width: '48px', height: '48px', fontSize: '22px', borderRadius: '14px' }}>M+</div>
        <h1>${expiredAccount ? 'Session expirée' : 'Bienvenue sur Moodle+'}</h1>
        <p class="muted" style=${{ margin: 0 }}>Toutes les nouveautés de vos cours, dans une interface claire. Connectez-vous avec le compte de votre établissement.</p>

        ${!site && html`
          <form onSubmit=${check} style=${{ marginTop: '22px' }}>
            <label class="small muted" style=${{ fontWeight: 600 }}>Adresse de votre Moodle</label>
            <input class="input" style=${{ marginTop: '6px' }} placeholder="moodle.mon-universite.fr" value=${url} onInput=${(e) => setUrl(e.target.value)} autofocus />
            <button class="btn primary block" style=${{ marginTop: '12px' }} disabled=${busy || !url.trim()}>
              ${busy ? html`<${Icon} name="refresh" cls="sm spin" />` : null} Continuer
            </button>
          </form>`}

        ${site && html`
          <div class="site-preview">
            ${site.logo ? html`<img src=${site.logo} alt="" />` : html`<div class="brand-logo" style=${{ background: 'var(--accent)' }}><${Icon} name="book" /></div>`}
            <div class="grow">
              <div style=${{ fontWeight: 650 }}>${site.siteName}</div>
              <div class="faint small ellipsis">${site.siteUrl}</div>
            </div>
            <button class="btn ghost sm" onClick=${() => { setSite(null); setWaiting(false); }}>Changer</button>
          </div>
          <div class="steps">
            <div class="step"><div class="step-num">1</div><div>Une fenêtre de connexion de votre établissement s’ouvre <b>dans l’application</b>.</div></div>
            <div class="step"><div class="step-num">2</div><div>Entrez votre identifiant et votre mot de passe, puis <b>validez la double authentification</b> (code, appli, SMS…).</div></div>
            <div class="step"><div class="step-num">3</div><div>La fenêtre se ferme toute seule et vos cours se chargent.</div></div>
          </div>
          ${waiting
            ? html`<div class="waiting"><${Icon} name="shield" cls="lg" /><div><b>En attente de votre connexion…</b><div class="small">Terminez la connexion et la 2FA dans la fenêtre ouverte.</div></div></div>`
            : html`<button class="btn primary block" onClick=${() => login(site)}><${Icon} name="lock" cls="sm" /> Se connecter</button>`}
        `}

        ${error && html`<div class="error">${error}</div>`}

        ${!expiredAccount && html`
          <div class="divider">ou</div>
          <button class="btn block" onClick=${demo} disabled=${busy}><${Icon} name="sparkles" cls="sm" /> Essayer avec des données de démonstration</button>`}
        <p class="faint small" style=${{ marginTop: '18px', marginBottom: 0 }}>
          <${Icon} name="lock" cls="sm" /> Votre mot de passe n’est jamais vu ni stocké par Moodle+ : vous le tapez directement sur la page officielle de votre établissement. Seul un jeton d’accès (comme celui de l’appli mobile Moodle) est conservé, chiffré, sur cet ordinateur.
        </p>
      </div>
    </div>`;
}

function cleanErr(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ===========================================================================
// Barre latérale & barre du haut
// ===========================================================================
function Sidebar({ ctx, route, data, counts, account }) {
  const user = data?.site?.user;
  const NavItem = ({ view, icon, label, badge, badgeCls }) => html`
    <button class=${'nav-item' + (route.view === view ? ' active' : '')} onClick=${() => ctx.go({ view })}>
      <${Icon} name=${icon} /> ${label}
      ${badge ? html`<span class=${'badge ' + (badgeCls || '')}>${badge}</span>` : null}
    </button>`;
  const courses = [...(data?.courses || [])].sort((a, b) => (b.favourite - a.favourite) || (counts.byCourse[b.id] || 0) - (counts.byCourse[a.id] || 0) || b.lastaccess - a.lastaccess);
  return html`
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">M+</div>
        <div class="grow">
          <div class="brand-name">Moodle+</div>
          <div class="brand-site ellipsis" title=${account?.siteName}>${account?.siteName || ''}</div>
        </div>
      </div>
      <nav class="nav">
        <${NavItem} view="feed" icon="sparkles" label="Nouveautés" badge=${counts.unread} />
        <${NavItem} view="deadlines" icon="calendar" label="Échéances" badge=${counts.urgent} badgeCls="danger" />
        <${NavItem} view="courses" icon="grid" label="Mes cours" />
        <${NavItem} view="files" icon="files" label="Tous les fichiers" />
        <${NavItem} view="grades" icon="award" label="Notes" />
      </nav>
      <div class="nav-title">Cours</div>
      <div class="course-nav">
        ${courses.map((c) => html`
          <button class=${'nav-item' + (route.view === 'course' && route.courseId === c.id ? ' active' : '')} onClick=${() => ctx.go({ view: 'course', courseId: c.id })} title=${c.fullname}>
            <span class="dot" style=${{ background: ctx.color(c.id) }}></span>
            <span class="ellipsis grow">${c.fullname}</span>
            ${counts.byCourse[c.id] ? html`<span class="badge soft">${counts.byCourse[c.id]}</span>` : null}
          </button>`)}
      </div>
      <div class="user-card">
        <div class="avatar">${user?.picture && !/\/u\/f[12]/.test(user.picture) ? html`<img src=${user.picture} onError=${(e) => (e.target.style.display = 'none')} />` : initials(user?.fullname)}</div>
        <div class="grow">
          <div class="ellipsis" style=${{ fontWeight: 600 }}>${user?.fullname || '…'}</div>
          <div class="faint small">${account?.demo ? 'Mode démo' : 'Connecté'}</div>
        </div>
        <button class="btn ghost icon-only" title="Réglages" onClick=${() => ctx.openSettings()}><${Icon} name="settings" /></button>
      </div>
    </aside>`;
}

function Topbar({ title, ctx, syncing, progress, lastSync, left }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  return html`
    <header class="topbar">
      ${left}
      <h1 class="ellipsis">${title}</h1>
      <button class="search-btn" onClick=${() => ctx.openPalette()}><${Icon} name="search" cls="sm" /> Rechercher…<kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd></button>
      <div class="row">
        <span class="faint small" style=${{ minWidth: '120px', textAlign: 'right' }}>${syncing ? (progress?.text || 'Synchronisation…') : lastSync ? 'Synchro ' + fmtRelative(lastSync) : ''}</span>
        <button class="btn icon-only" title="Synchroniser maintenant" onClick=${() => ctx.sync()} disabled=${syncing}><${Icon} name="refresh" cls=${syncing ? 'spin' : ''} /></button>
      </div>
    </header>`;
}

// ===========================================================================
// Vue « Nouveautés »
// ===========================================================================
const FEED_FILTERS = [
  ['all', 'Tout'],
  ['files', 'Fichiers & dossiers'],
  ['activities', 'Activités'],
  ['announcement', 'Annonces'],
  ['grade', 'Notes'],
  ['notification', 'Notifications'],
];
function matchFilter(item, f) {
  if (f === 'all') return true;
  if (f === 'files') return ['new_files', 'updated_files'].includes(item.type) || (item.type === 'new_module' && ['resource', 'folder'].includes(item.modname));
  if (f === 'activities') return item.type === 'new_module' && !['resource', 'folder'].includes(item.modname);
  return item.type === f;
}

function FeedItem({ item, ctx }) {
  const course = ctx.course(item.courseId);
  const c = course ? ctx.color(course.id) : '#8a91a3';
  let icon = 'sparkles';
  let verb = '';
  if (item.type === 'new_module') { icon = modInfo(item.modname).icon; verb = NEW_LABELS[item.modname] || 'Nouvelle activité'; }
  if (item.type === 'new_files') { icon = item.modname === 'folder' ? 'folder' : 'file'; verb = plural(item.files.length, 'nouveau fichier', 'nouveaux fichiers'); }
  if (item.type === 'updated_files') { icon = 'refresh'; verb = plural(item.files.length, 'fichier mis à jour', 'fichiers mis à jour'); }
  if (item.type === 'announcement') { icon = 'megaphone'; verb = 'Annonce' + (item.author ? ' de ' + item.author : ''); }
  if (item.type === 'grade') { icon = 'award'; verb = 'Nouvelle note'; }
  if (item.type === 'notification') { icon = 'bell'; verb = 'Notification'; }

  const open = () => {
    ctx.markRead([item.id]);
    if (item.type === 'announcement') return ctx.showAnnouncement(item.courseId, item.announcementId);
    if (item.type === 'grade') return ctx.go({ view: 'course', courseId: item.courseId, tab: 'grades' });
    if (item.type === 'notification') return item.url && api.openInMoodle(item.url);
    if (item.moduleId) return ctx.go({ view: 'course', courseId: item.courseId, highlight: item.moduleId });
  };
  const files = item.files || [];
  const realFiles = files.filter((f) => f.type !== 'url');

  return html`
    <article class=${'card feed-item' + (item.read ? '' : ' unread')} style=${{ '--c': c }} onMouseEnter=${() => !item.read && ctx.markReadSoon(item.id)}>
      <div class="feed-icon"><${Icon} name=${icon} /></div>
      <div class="grow">
        <div class="feed-head">
          <span style=${{ fontWeight: 600, color: 'var(--text)' }}>${verb}</span>
          ${course && html`<${CoursePill} course=${course} ctx=${ctx} />`}
          ${item.sectionName && html`<span class="ellipsis" style=${{ maxWidth: '260px' }}>· ${item.sectionName}</span>`}
          <span class="faint">· ${fmtRelative(item.time)}</span>
        </div>
        <h3 class="feed-title" onClick=${open}>${item.title}</h3>
        ${item.type === 'grade' && html`<div class="row" style=${{ marginTop: '4px' }}><span class="grade-big">${item.grade}</span>${item.max ? html`<span class="muted">/ ${Number(item.max)}</span>` : null}</div>`}
        ${item.text && html`<p class="feed-text">${item.text}</p>`}
        ${files.length > 0 && html`
          <div class="files">
            ${files.slice(0, 6).map((f) => html`<${FileRow} f=${f} ctx=${ctx} />`)}
            ${files.length > 6 && html`<div class="faint small">+ ${files.length - 6} autre(s) fichier(s)</div>`}
          </div>`}
        <div class="feed-actions">
          ${realFiles.length > 1 && html`<button class="btn sm" onClick=${() => ctx.saveMany(realFiles, item.title)}><${Icon} name="download" cls="sm" /> Tout télécharger</button>`}
          ${item.url && item.type !== 'notification' && html`<button class="btn sm ghost" onClick=${() => { ctx.markRead([item.id]); api.openInMoodle(item.url); }}><${Icon} name="external" cls="sm" /> Ouvrir dans Moodle</button>`}
          ${item.type === 'notification' && item.url && html`<button class="btn sm ghost" onClick=${open}><${Icon} name="external" cls="sm" /> Voir</button>`}
          ${item.read
            ? html`<button class="btn sm ghost" onClick=${() => ctx.markUnread(item.id)}>Marquer comme non lu</button>`
            : html`<button class="btn sm ghost" onClick=${() => ctx.markRead([item.id])}><${Icon} name="check" cls="sm" /> Marquer comme lu</button>`}
        </div>
      </div>
    </article>`;
}

function DeadlineCard({ d, ctx }) {
  const cd = countdown(d.time);
  return html`
    <button class="deadline-card" style=${{ '--c': ctx.color(d.courseId) }} onClick=${() => d.url && api.openInMoodle(d.url)}>
      <div class=${'countdown ' + cd.cls}>${cd.text}</div>
      <div style=${{ fontWeight: 620 }} class="ellipsis">${d.name}</div>
      <div class="row small muted"><${Icon} name=${modInfo(d.modname).icon} cls="sm" /><span class="ellipsis">${ctx.course(d.courseId)?.fullname || d.courseName}</span></div>
      <div class="faint small">${dayLabel(d.time)} à ${fmtTime(d.time)}</div>
    </button>`;
}

function FeedView({ ctx, data, feed, counts }) {
  const [filter, setFilter] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const items = feed.filter((i) => matchFilter(i, filter) && (!unreadOnly || !i.read));
  const groups = [];
  for (const it of items) {
    const label = dayLabel(it.time);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(it);
  }
  const upcoming = (data?.deadlines || []).filter((d) => d.time > nowS() - 86400 * 2).sort((a, b) => a.time - b.time).slice(0, 4);
  const weekAgo = nowS() - 7 * 86400;
  const filesThisWeek = feed.filter((i) => i.time > weekAgo && i.files).reduce((n, i) => n + i.files.length, 0);
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Bonsoir' : hour < 18 ? 'Bonjour' : 'Bonsoir';

  return html`
    <div class="content-inner">
      <p class="hello">${hello} ${data?.site?.user?.firstname || ''} 👋</p>
      <div class="muted">${counts.unread ? `Vous avez ${plural(counts.unread, 'nouveauté non lue', 'nouveautés non lues')}.` : 'Vous êtes à jour, rien de nouveau depuis votre dernière visite.'}</div>
      <div class="stats">
        <button class="stat" onClick=${() => { setFilter('all'); setUnreadOnly(true); }}>
          <div class="stat-icon" style=${{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}><${Icon} name="sparkles" /></div>
          <div><div class="stat-value">${counts.unread}</div><div class="stat-label">Non lues</div></div>
        </button>
        <button class="stat" onClick=${() => ctx.go({ view: 'deadlines' })}>
          <div class="stat-icon" style=${{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><${Icon} name="clock" /></div>
          <div><div class="stat-value">${counts.week}</div><div class="stat-label">À rendre sous 7 jours</div></div>
        </button>
        <button class="stat" onClick=${() => setFilter('files')}>
          <div class="stat-icon" style=${{ background: 'var(--warn-soft)', color: 'var(--warn)' }}><${Icon} name="folder" /></div>
          <div><div class="stat-value">${filesThisWeek}</div><div class="stat-label">Fichiers ajoutés cette semaine</div></div>
        </button>
        <button class="stat" onClick=${() => ctx.go({ view: 'courses' })}>
          <div class="stat-icon" style=${{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><${Icon} name="book" /></div>
          <div><div class="stat-value">${data?.courses?.length || 0}</div><div class="stat-label">Cours suivis</div></div>
        </button>
      </div>

      ${upcoming.length > 0 && html`
        <div class="section-title"><${Icon} name="calendar" /><h2>Prochaines échéances</h2><button class="btn ghost sm" style=${{ marginLeft: 'auto' }} onClick=${() => ctx.go({ view: 'deadlines' })}>Tout voir <${Icon} name="chevron" cls="sm" /></button></div>
        <div class="deadline-strip">${upcoming.map((d) => html`<${DeadlineCard} d=${d} ctx=${ctx} />`)}</div>`}

      <div class="section-title"><${Icon} name="sparkles" /><h2>Fil des nouveautés</h2></div>
      <div class="toolbar">
        ${FEED_FILTERS.map(([k, l]) => html`<button class=${'chip' + (filter === k ? ' active' : '')} onClick=${() => setFilter(k)}>${l}</button>`)}
        <span class="grow"></span>
        <label class="row small muted" style=${{ cursor: 'pointer' }}><${Switch} on=${unreadOnly} onChange=${setUnreadOnly} /> Non lues seulement</label>
        <button class="btn sm" onClick=${() => ctx.markRead('all')} disabled=${!counts.unread}><${Icon} name="checkAll" cls="sm" /> Tout marquer comme lu</button>
      </div>
      ${groups.length === 0
        ? html`<${Empty} icon="inbox" title="Rien à afficher" text=${feed.length ? 'Aucun élément ne correspond à ce filtre.' : 'Les prochains fichiers, dossiers, annonces et notes publiés sur Moodle apparaîtront ici.'} />`
        : groups.map((g) => html`<div><div class="day-label">${g.label}</div>${g.items.map((it) => html`<${FeedItem} key=${it.id} item=${it} ctx=${ctx} />`)}</div>`)}
    </div>`;
}

// ===========================================================================
// Vue « Échéances »
// ===========================================================================
function DeadlinesView({ ctx, data }) {
  const now = nowS();
  const list = [...(data?.deadlines || [])].sort((a, b) => a.time - b.time);
  const today = startOfDay(now);
  const buckets = [
    ['En retard', (d) => d.time < now, 'danger'],
    ['Aujourd’hui', (d) => d.time >= now && d.time < today + 86400, 'danger'],
    ['Demain', (d) => d.time >= today + 86400 && d.time < today + 2 * 86400, 'warn'],
    ['Cette semaine', (d) => d.time >= today + 2 * 86400 && d.time < today + 7 * 86400, 'warn'],
    ['Plus tard', (d) => d.time >= today + 7 * 86400, 'ok'],
  ];
  if (!list.length) return html`<div class="content-inner"><${Empty} icon="calendar" title="Aucune échéance" text="Aucun devoir ni test à venir. Profitez-en !" /></div>`;
  return html`
    <div class="content-inner">
      ${buckets.map(([label, test, tone]) => {
        const items = list.filter(test);
        if (!items.length) return null;
        return html`
          <div class="timeline-group">
            <h3><span class=${'pill ' + tone}>${items.length}</span> ${label}</h3>
            <div class="card">
              ${items.map((d) => {
                const cd = countdown(d.time);
                const course = ctx.course(d.courseId);
                return html`
                  <div class="deadline-row">
                    <div class="date-box" style=${{ borderLeft: `4px solid ${ctx.color(d.courseId)}` }}>
                      <div class="d">${new Date(d.time * 1000).getDate()}</div>
                      <div class="m">${fmtDate(d.time, { month: 'short' }).replace('.', '')}</div>
                    </div>
                    <div class="grow">
                      <div style=${{ fontWeight: 640 }}>${d.name}</div>
                      <div class="row small muted" style=${{ flexWrap: 'wrap' }}>
                        <${Icon} name=${modInfo(d.modname).icon} cls="sm" /> ${modInfo(d.modname).label}
                        ${course ? html`<${CoursePill} course=${course} ctx=${ctx} />` : html`<span>${d.courseName}</span>`}
                        <span>· ${dayLabel(d.time)} à ${fmtTime(d.time)}</span>
                      </div>
                    </div>
                    <div class=${'countdown ' + cd.cls} style=${{ textAlign: 'right', minWidth: '130px' }}>${cd.text}</div>
                    ${d.url && html`<button class="btn sm" onClick=${() => api.openInMoodle(d.url)}>${d.actionName || 'Ouvrir'} <${Icon} name="external" cls="sm" /></button>`}
                  </div>`;
              })}
            </div>
          </div>`;
      })}
    </div>`;
}

// ===========================================================================
// Vue « Mes cours »
// ===========================================================================
function CoursesView({ ctx, data, counts }) {
  const [q, setQ] = useState('');
  const courses = [...(data?.courses || [])]
    .filter((c) => !q || normalize(c.fullname + ' ' + c.shortname).includes(normalize(q)))
    .sort((a, b) => (b.favourite - a.favourite) || b.lastaccess - a.lastaccess);
  return html`
    <div class="content-inner">
      <div class="toolbar"><input class="input" style=${{ maxWidth: '340px' }} placeholder="Filtrer les cours…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="course-grid">
        ${courses.map((c) => {
          const color = ctx.color(c.id);
          const files = c.sections.reduce((n, s) => n + s.modules.reduce((k, m) => k + m.files.length, 0), 0);
          const next = (data.deadlines || []).filter((d) => d.courseId === c.id && d.time > nowS()).sort((a, b) => a.time - b.time)[0];
          return html`
            <div class="card course-card" onClick=${() => ctx.go({ view: 'course', courseId: c.id })}>
              <div class="course-cover" style=${{ background: cover(color) }}>
                <div class="cover-pattern"></div>
                <div class="row" style=${{ position: 'relative' }}>
                  <span class="course-code">${c.shortname}</span>
                  <span class="grow"></span>
                  ${c.favourite && html`<${Icon} name="star" cls="sm" />`}
                  ${counts.byCourse[c.id] ? html`<span class="badge" style=${{ background: 'white', color }}>${counts.byCourse[c.id]} nouv.</span>` : null}
                </div>
              </div>
              <div class="course-body">
                <div class="course-name">${c.fullname}</div>
                ${c.progress !== null && html`<div><div class="row small muted"><span class="grow">Progression</span><span>${c.progress} %</span></div><div class="progress" style=${{ '--c': color }}><div style=${{ width: c.progress + '%' }}></div></div></div>`}
                <div class="row small muted" style=${{ marginTop: 'auto', flexWrap: 'wrap' }}>
                  <span class="row"><${Icon} name="files" cls="sm" /> ${files} fichiers</span>
                  ${c.courseGrade && html`<span class="row">· <${Icon} name="award" cls="sm" /> ${c.courseGrade}</span>`}
                </div>
                ${next && html`<div class=${'small countdown ' + countdown(next.time).cls}><${Icon} name="clock" cls="sm" /> ${next.name} — ${countdown(next.time).text.toLowerCase()}</div>`}
              </div>
            </div>`;
        })}
      </div>
    </div>`;
}

// ===========================================================================
// Vue d'un cours
// ===========================================================================
function ModuleRow({ m, ctx, isNew }) {
  const info = modInfo(m.modname);
  const open = () => {
    ctx.markModuleRead(m.id);
    if (m.modname === 'resource' && m.files.length === 1) return ctx.openFile(m.files[0]);
    if (m.modname === 'url' && m.files[0]) return api.openExternal(m.files[0].url);
    if (m.url) api.openInMoodle(m.url);
  };
  const showFiles = m.files.length > 0 && !(m.modname === 'resource' && m.files.length === 1) && m.modname !== 'url';
  return html`
    <div class=${'module' + (isNew ? ' is-new' : '')} id=${'mod-' + m.id}>
      <div class="mod-icon" style=${{ background: `color-mix(in srgb, ${info.color} 15%, transparent)`, color: info.color }}><${Icon} name=${info.icon} /></div>
      <div class="grow">
        <div class="row" style=${{ flexWrap: 'wrap' }}>
          <span class="module-name" onClick=${open}>${m.name}</span>
          ${isNew && html`<span class="pill new">Nouveau</span>`}
          ${!m.visible && html`<span class="pill"><${Icon} name="lock" cls="sm" /> Restreint</span>`}
          ${m.completion === 1 || m.completion === 2 ? html`<span class="pill ok"><${Icon} name="check" cls="sm" /> Terminé</span>` : null}
        </div>
        <div class="faint small">
          ${info.label}
          ${m.modname === 'resource' && m.files[0] ? ` · ${extOf(m.files[0].name).toUpperCase()} · ${fmtSize(m.files[0].size)}` : ''}
          ${m.modname === 'folder' ? ` · ${plural(m.files.length, 'fichier', 'fichiers')}` : ''}
          ${m.dates.map((d) => ` · ${d.label} ${fmtDate(d.time, { day: 'numeric', month: 'short' })} ${fmtTime(d.time)}`).join('')}
        </div>
        ${m.description && html`<div class="muted small" style=${{ marginTop: '4px' }}>${m.description}</div>`}
        ${m.availability && html`<div class="small" style=${{ color: 'var(--warn)', marginTop: '4px' }}>${m.availability}</div>`}
        ${showFiles && html`<div class="files">${m.files.map((f) => html`<${FileRow} f=${f} ctx=${ctx} />`)}</div>`}
      </div>
      <div class="row">
        ${m.modname === 'folder' && m.files.length > 1 && html`<button class="btn sm ghost" title="Tout télécharger" onClick=${() => ctx.saveMany(m.files, m.name)}><${Icon} name="download" cls="sm" /></button>`}
        ${m.modname === 'resource' && m.files.length === 1 && html`<button class="btn sm ghost" title="Enregistrer sous…" onClick=${() => ctx.saveFile(m.files[0])}><${Icon} name="download" cls="sm" /></button>`}
        ${m.url && html`<button class="btn sm ghost" title="Ouvrir dans Moodle" onClick=${() => { ctx.markModuleRead(m.id); api.openInMoodle(m.url); }}><${Icon} name="external" cls="sm" /></button>`}
      </div>
    </div>`;
}

function FilesTable({ rows, ctx, showCourse }) {
  const [sort, setSort] = useState({ key: 'time', dir: -1 });
  const sorted = [...rows].sort((a, b) => {
    const k = sort.key;
    const va = k === 'name' ? normalize(a.f.name) : k === 'size' ? a.f.size : k === 'course' ? normalize(a.course?.fullname) : a.f.time;
    const vb = k === 'name' ? normalize(b.f.name) : k === 'size' ? b.f.size : k === 'course' ? normalize(b.course?.fullname) : b.f.time;
    return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
  });
  const Th = ({ k, label }) => html`<th onClick=${() => setSort({ key: k, dir: sort.key === k ? -sort.dir : k === 'name' || k === 'course' ? 1 : -1 })}>${label}${sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  if (!rows.length) return html`<${Empty} icon="files" title="Aucun fichier" text="Aucun fichier ne correspond." />`;
  return html`
    <div class="card" style=${{ overflow: 'hidden' }}>
      <table class="files-table">
        <thead><tr><${Th} k="name" label="Nom" />${showCourse && html`<${Th} k="course" label="Cours" />`}<th>Emplacement</th><${Th} k="size" label="Taille" /><${Th} k="time" label="Modifié" /><th></th></tr></thead>
        <tbody>
          ${sorted.slice(0, 400).map(({ f, m, s, course, isNew }) => html`
            <tr>
              <td>
                <div class="row">
                  <div class="file-ext" style=${{ background: extColor(extOf(f.name)), width: '30px', height: '30px', fontSize: '9px' }}>${(extOf(f.name) || '?').slice(0, 4).toUpperCase()}</div>
                  <span class="file-name ellipsis" style=${{ maxWidth: '340px' }} title=${f.name} onClick=${() => ctx.openFile(f)}>${f.name}</span>
                  ${isNew && html`<span class="pill new">Nouveau</span>`}
                </div>
              </td>
              ${showCourse && html`<td><${CoursePill} course=${course} ctx=${ctx} /></td>`}
              <td class="small muted"><div class="ellipsis" style=${{ maxWidth: '260px' }} title=${s.name + ' › ' + m.name}>${m.name}</div></td>
              <td class="small muted" style=${{ whiteSpace: 'nowrap' }}>${fmtSize(f.size)}</td>
              <td class="small muted" style=${{ whiteSpace: 'nowrap' }}>${f.time ? fmtDate(f.time) : ''}</td>
              <td style=${{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <button class="btn ghost sm icon-only" title="Ouvrir" onClick=${() => ctx.openFile(f)}><${Icon} name="eye" cls="sm" /></button>
                <button class="btn ghost sm icon-only" title="Enregistrer sous…" onClick=${() => ctx.saveFile(f)}><${Icon} name="download" cls="sm" /></button>
              </td>
            </tr>`)}
        </tbody>
      </table>
      ${sorted.length > 400 && html`<div class="faint small" style=${{ padding: '10px 14px' }}>${sorted.length - 400} fichiers supplémentaires — affinez la recherche.</div>`}
    </div>`;
}

function collectFiles(courses, newModules) {
  const rows = [];
  for (const course of courses) for (const s of course.sections) for (const m of s.modules) for (const f of m.files) {
    if (f.type === 'url') continue;
    rows.push({ f, m, s, course, isNew: newModules.has(m.id) });
  }
  return rows;
}

function CourseView({ ctx, data, route, counts, feed }) {
  const course = ctx.course(route.courseId);
  const [tab, setTab] = useState(route.tab || 'content');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [q, setQ] = useState('');
  useEffect(() => setTab(route.tab || 'content'), [route.courseId, route.tab]);
  useEffect(() => {
    if (!route.highlight) return;
    setTab('content');
    setTimeout(() => {
      const el = document.getElementById('mod-' + route.highlight);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.animate([{ boxShadow: 'inset 0 0 0 2px var(--accent)' }, { boxShadow: 'inset 0 0 0 2px transparent' }], { duration: 2200 });
      }
    }, 80);
  }, [route.highlight, route.n]);

  if (!course) return html`<div class="content-inner"><${Empty} title="Cours introuvable" text="Ce cours n’existe plus dans votre liste." /></div>`;
  const color = ctx.color(course.id);
  const fileRows = collectFiles([course], counts.newModules).filter((r) => !q || normalize(r.f.name + ' ' + r.m.name).includes(normalize(q)));
  const nModules = course.sections.reduce((n, s) => n + s.modules.length, 0);
  const deadlines = (data.deadlines || []).filter((d) => d.courseId === course.id && d.time > nowS() - 86400);
  const toggle = (id) => setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allIds = course.sections.map((s) => s.id);

  const tabs = [
    ['content', 'Contenu', 'layers', null],
    ['files', 'Fichiers', 'files', fileRows.length],
    ['announcements', 'Annonces', 'megaphone', course.announcements.length || null],
    ['grades', 'Notes', 'award', course.grades.length || null],
  ];

  return html`
    <div class="content-inner">
      <div class="course-hero" style=${{ background: cover(color) }}>
        <div class="cover-pattern"></div>
        <div class="row" style=${{ position: 'relative' }}>
          <span class="course-code">${course.shortname}</span>
          <span class="grow"></span>
          <button class="btn sm" style=${{ background: 'rgba(255,255,255,.18)', borderColor: 'transparent', color: 'white' }} onClick=${() => api.openInMoodle(`${data.site.url}/course/view.php?id=${course.id}`)}><${Icon} name="external" cls="sm" /> Ouvrir dans Moodle</button>
        </div>
        <h2>${course.fullname}</h2>
        <div class="hero-meta">
          <span>${plural(nModules, 'activité', 'activités')}</span>
          <span>${plural(fileRows.length, 'fichier', 'fichiers')}</span>
          ${course.progress !== null && html`<span>Progression ${course.progress} %</span>`}
          ${course.courseGrade && html`<span>Moyenne ${course.courseGrade}</span>`}
          ${counts.byCourse[course.id] ? html`<span><b>${counts.byCourse[course.id]} nouveauté(s)</b></span>` : null}
        </div>
      </div>

      ${deadlines.length > 0 && html`<div class="deadline-strip" style=${{ marginBottom: '18px' }}>${deadlines.map((d) => html`<${DeadlineCard} d=${d} ctx=${ctx} />`)}</div>`}

      <div class="tabs">
        ${tabs.map(([k, l, i, n]) => html`<button class=${'tab' + (tab === k ? ' active' : '')} onClick=${() => setTab(k)}><${Icon} name=${i} cls="sm" /> ${l} ${n ? html`<span class="badge soft">${n}</span>` : null}</button>`)}
      </div>

      ${tab === 'content' && html`
        <div class="toolbar">
          <button class="btn sm" onClick=${() => setCollapsed(new Set())}>Tout déplier</button>
          <button class="btn sm" onClick=${() => setCollapsed(new Set(allIds))}>Tout replier</button>
        </div>
        ${course.sections.filter((s) => s.modules.length || s.summary).map((s) => {
          const open = !collapsed.has(s.id);
          const newCount = s.modules.filter((m) => counts.newModules.has(m.id)).length;
          return html`
            <div class="card section-card">
              <div class="section-head" onClick=${() => toggle(s.id)}>
                <${Icon} name="chevron" cls=${'sm chev' + (open ? ' open' : '')} />
                <h3 class="grow">${s.name}</h3>
                ${newCount ? html`<span class="pill new">${newCount} nouveau${newCount > 1 ? 'x' : ''}</span>` : null}
                <span class="faint small">${plural(s.modules.length, 'élément', 'éléments')}</span>
              </div>
              ${open && s.summary && html`<div class="muted small" style=${{ padding: '0 18px 12px 44px', whiteSpace: 'pre-line' }}>${s.summary}</div>`}
              ${open && s.modules.map((m) => html`<${ModuleRow} key=${m.id} m=${m} ctx=${ctx} isNew=${counts.newModules.has(m.id)} />`)}
            </div>`;
        })}`}

      ${tab === 'files' && html`
        <div class="toolbar">
          <input class="input" style=${{ maxWidth: '320px' }} placeholder="Filtrer les fichiers…" value=${q} onInput=${(e) => setQ(e.target.value)} />
          <span class="grow"></span>
          <button class="btn sm" onClick=${() => ctx.saveMany(fileRows.map((r) => r.f), course.shortname || course.fullname)} disabled=${!fileRows.length}><${Icon} name="download" cls="sm" /> Tout télécharger (${fileRows.length})</button>
        </div>
        <${FilesTable} rows=${fileRows} ctx=${ctx} />`}

      ${tab === 'announcements' && (course.announcements.length
        ? course.announcements.map((a) => html`
            <div class="card feed-item" style=${{ '--c': color, cursor: 'pointer' }} onClick=${() => ctx.showAnnouncement(course.id, a.id)}>
              <div class="feed-icon"><${Icon} name="megaphone" /></div>
              <div class="grow">
                <div class="feed-head"><b style=${{ color: 'var(--text)' }}>${a.author}</b><span class="faint">· ${fmtRelative(a.time)}</span></div>
                <h3 class="feed-title">${a.subject}</h3>
                <p class="feed-text">${a.message}</p>
              </div>
            </div>`)
        : html`<${Empty} icon="megaphone" title="Aucune annonce" text="Les annonces des enseignants apparaîtront ici." />`)}

      ${tab === 'grades' && html`<${GradesList} course=${course} ctx=${ctx} />`}
    </div>`;
}

function GradesList({ course, ctx }) {
  if (!course.grades.length) return html`<${Empty} icon="award" title="Pas encore de note" text="Les notes publiées dans ce cours apparaîtront ici." />`;
  return html`
    <div class="card">
      ${course.grades.map((g) => html`
        <div class="deadline-row">
          <div class="mod-icon" style=${{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><${Icon} name="award" /></div>
          <div class="grow">
            <div style=${{ fontWeight: 620 }}>${g.name}</div>
            <div class="faint small">${g.time ? 'Noté ' + fmtRelative(g.time) : ''}${g.percentage && g.percentage !== '-' ? ' · ' + g.percentage : ''}</div>
            ${g.feedback && html`<div class="muted small" style=${{ marginTop: '4px', whiteSpace: 'pre-line' }}>💬 ${g.feedback}</div>`}
          </div>
          <div style=${{ textAlign: 'right' }}><span class="grade-big">${g.grade}</span>${g.max ? html`<span class="muted"> / ${Number(g.max)}</span>` : null}</div>
        </div>`)}
    </div>`;
}

// ===========================================================================
// Vue « Tous les fichiers » et « Notes »
// ===========================================================================
function FilesView({ ctx, data, counts }) {
  const [q, setQ] = useState('');
  const [courseId, setCourseId] = useState('');
  const [kind, setKind] = useState('');
  const rows = collectFiles(data?.courses || [], counts.newModules).filter((r) =>
    (!courseId || r.course.id === Number(courseId)) &&
    (!kind || FILE_KINDS[kind](extOf(r.f.name))) &&
    (!q || normalize(r.f.name + ' ' + r.m.name + ' ' + r.course.fullname).includes(normalize(q))));
  return html`
    <div class="content-inner">
      <div class="toolbar">
        <input class="input" style=${{ maxWidth: '320px' }} placeholder="Rechercher un fichier…" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <select class="input" value=${courseId} onChange=${(e) => setCourseId(e.target.value)}>
          <option value="">Tous les cours</option>
          ${(data?.courses || []).map((c) => html`<option value=${c.id}>${c.fullname}</option>`)}
        </select>
        <select class="input" value=${kind} onChange=${(e) => setKind(e.target.value)}>
          <option value="">Tous les types</option>
          <option value="pdf">PDF</option>
          <option value="office">Word / Excel / PowerPoint</option>
          <option value="media">Images & vidéos</option>
          <option value="archive">Archives (zip…)</option>
          <option value="code">Code & texte</option>
        </select>
        <span class="grow"></span>
        <span class="faint small">${plural(rows.length, 'fichier', 'fichiers')}</span>
      </div>
      <${FilesTable} rows=${rows} ctx=${ctx} showCourse=${true} />
    </div>`;
}

function GradesView({ ctx, data }) {
  const courses = (data?.courses || []).filter((c) => c.grades.length || c.courseGrade);
  if (!courses.length) return html`<div class="content-inner"><${Empty} icon="award" title="Aucune note" text="Aucune note n’a encore été publiée (ou votre Moodle ne les rend pas accessibles)." /></div>`;
  return html`
    <div class="content-inner">
      ${courses.map((c) => html`
        <div class="section-title" style=${{ cursor: 'pointer' }} onClick=${() => ctx.go({ view: 'course', courseId: c.id, tab: 'grades' })}>
          <span class="dot" style=${{ background: ctx.color(c.id) }}></span><h2>${c.fullname}</h2>
          ${c.courseGrade && html`<span class="pill" style=${{ marginLeft: 'auto' }}>Total : ${c.courseGrade}</span>`}
        </div>
        <${GradesList} course=${c} ctx=${ctx} />`)}
    </div>`;
}

// ===========================================================================
// Recherche (Ctrl/Cmd + K)
// ===========================================================================
function Palette({ ctx, data, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => inputRef.current && inputRef.current.focus(), []);
  const index = useMemo(() => {
    const out = [];
    for (const c of data?.courses || []) {
      out.push({ group: 'Cours', icon: 'book', color: ctx.color(c.id), label: c.fullname, sub: c.shortname, text: c.fullname + ' ' + c.shortname, run: () => ctx.go({ view: 'course', courseId: c.id }) });
      for (const s of c.sections) for (const m of s.modules) {
        out.push({ group: 'Activités', icon: modInfo(m.modname).icon, color: modInfo(m.modname).color, label: m.name, sub: `${c.shortname} › ${s.name}`, text: m.name + ' ' + c.fullname, run: () => ctx.go({ view: 'course', courseId: c.id, highlight: m.id }) });
        for (const f of m.files) if (f.type !== 'url') out.push({ group: 'Fichiers', icon: 'file', color: extColor(extOf(f.name)), label: f.name, sub: `${c.shortname} › ${m.name}`, text: f.name + ' ' + m.name, run: () => ctx.openFile(f) });
      }
      for (const a of c.announcements) out.push({ group: 'Annonces', icon: 'megaphone', color: ctx.color(c.id), label: a.subject, sub: c.shortname, text: a.subject + ' ' + a.message, run: () => ctx.showAnnouncement(c.id, a.id) });
    }
    return out.map((r) => ({ ...r, n: normalize(r.text) }));
  }, [data]);
  const terms = normalize(q).split(/\s+/).filter(Boolean);
  const results = terms.length ? index.filter((r) => terms.every((t) => r.n.includes(t))).slice(0, 60) : index.filter((r) => r.group === 'Cours');
  useEffect(() => setSel(0), [q]);
  const run = (r) => { onClose(); r.run(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && results[sel]) run(results[sel]);
    if (e.key === 'Escape') onClose();
  };
  useEffect(() => document.querySelector('.palette .sel')?.scrollIntoView({ block: 'nearest' }), [sel]);
  let lastGroup = null;
  return html`
    <div class="overlay" onClick=${onClose}>
      <div class="card palette" onClick=${(e) => e.stopPropagation()}>
        <div class="palette-input"><${Icon} name="search" /><input autofocus placeholder="Cours, activités, fichiers, annonces…" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${onKey} ref=${inputRef} /><kbd>Échap</kbd></div>
        <div class="palette-results">
          ${results.length === 0 && html`<div class="empty small">Aucun résultat pour « ${q} »</div>`}
          ${results.map((r, i) => {
            const header = r.group !== lastGroup ? html`<div class="result-group">${r.group}</div>` : null;
            lastGroup = r.group;
            return html`${header}<div class=${'result' + (i === sel ? ' sel' : '')} onMouseEnter=${() => setSel(i)} onClick=${() => run(r)}>
              <div class="mod-icon" style=${{ width: '30px', height: '30px', background: `color-mix(in srgb, ${r.color} 15%, transparent)`, color: r.color }}><${Icon} name=${r.icon} cls="sm" /></div>
              <div class="grow"><div class="ellipsis" style=${{ fontWeight: 560 }}>${r.label}</div><div class="faint small ellipsis">${r.sub}</div></div>
            </div>`;
          })}
        </div>
      </div>
    </div>`;
}

// ===========================================================================
// Réglages & annonce
// ===========================================================================
function SettingsModal({ state, onClose, onChange, onLogout }) {
  const s = state.settings;
  return html`
    <div class="overlay" onClick=${onClose}>
      <div class="card modal" onClick=${(e) => e.stopPropagation()}>
        <div class="row"><h2 class="grow">Réglages</h2><button class="btn ghost icon-only" onClick=${onClose}><${Icon} name="x" /></button></div>
        <p class="muted small" style=${{ marginTop: 0 }}>${state.account?.siteName} — ${state.account?.siteUrl}</p>
        <div class="setting">
          <div class="grow"><div style=${{ fontWeight: 600 }}>Synchronisation automatique</div><div class="faint small">Vérifie les nouveautés en arrière-plan tant que l’app est ouverte.</div></div>
          <select class="input" value=${s.autoSyncMinutes} onChange=${(e) => onChange({ autoSyncMinutes: Number(e.target.value) })}>
            <option value="0">Désactivée</option><option value="15">Toutes les 15 min</option><option value="30">Toutes les 30 min</option><option value="60">Toutes les heures</option><option value="180">Toutes les 3 h</option>
          </select>
        </div>
        <div class="setting">
          <div class="grow"><div style=${{ fontWeight: 600 }}>Notifications du bureau</div><div class="faint small">Une notification quand un fichier, un dossier, une annonce ou une note apparaît.</div></div>
          <${Switch} on=${s.notifications} onChange=${(v) => onChange({ notifications: v })} />
        </div>
        <div class="setting">
          <div class="grow"><div style=${{ fontWeight: 600 }}>Thème</div></div>
          <select class="input" value=${s.theme} onChange=${(e) => onChange({ theme: e.target.value })}>
            <option value="system">Comme le système</option><option value="light">Clair</option><option value="dark">Sombre</option>
          </select>
        </div>
        <div class="setting" style=${{ flexWrap: 'wrap' }}>
          <div class="grow"><div style=${{ fontWeight: 600 }}>Compte</div><div class="faint small">« Oublier cet appareil » efface aussi les cookies de connexion : la double authentification sera redemandée.</div></div>
          <button class="btn" onClick=${() => onLogout(false)}><${Icon} name="logout" cls="sm" /> Se déconnecter</button>
          <button class="btn" style=${{ color: 'var(--danger)' }} onClick=${() => onLogout(true)}>Oublier cet appareil</button>
        </div>
        <p class="faint small" style=${{ marginBottom: 0 }}>Moodle+ v${state.version}</p>
      </div>
    </div>`;
}

function AnnouncementModal({ ctx, courseId, id, onClose }) {
  const course = ctx.course(courseId);
  const a = course?.announcements.find((x) => x.id === id);
  if (!a) return null;
  return html`
    <div class="overlay" onClick=${onClose}>
      <div class="card modal" style=${{ width: '680px' }} onClick=${(e) => e.stopPropagation()}>
        <div class="row"><${CoursePill} course=${course} ctx=${ctx} /><span class="grow"></span><button class="btn ghost icon-only" onClick=${onClose}><${Icon} name="x" /></button></div>
        <h2 style=${{ marginTop: '12px' }}>${a.subject}</h2>
        <div class="muted small">${a.author} · ${fmtDate(a.time, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} à ${fmtTime(a.time)}</div>
        <div class="announcement-body">${a.message}</div>
        ${a.attachments?.length > 0 && html`<div class="files">${a.attachments.map((f) => html`<${FileRow} f=${f} ctx=${ctx} />`)}</div>`}
      </div>
    </div>`;
}

// ===========================================================================
// Application
// ===========================================================================
const TITLES = { feed: 'Nouveautés', deadlines: 'Échéances', courses: 'Mes cours', files: 'Tous les fichiers', grades: 'Notes' };

function App() {
  const [state, setState] = useState(null);
  const [route, setRoute] = useState({ view: 'feed' });
  const [history, setHistory] = useState([]);
  const [progress, setProgress] = useState(null);
  const [palette, setPalette] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [expired, setExpired] = useState(false);
  const readTimers = useRef({});
  const contentRef = useRef(null);

  const toast = useCallback((text, type = '') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    api.getState().then(setState);
    const offs = [
      api.on('state', (s) => setState(s)),
      api.on('sync:progress', (p) => setProgress(p)),
      api.on('auth:expired', () => setExpired(true)),
      api.on('navigate', (r) => setRoute(r)),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  useEffect(() => {
    const t = state?.settings?.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }, [state?.settings?.theme]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); ctx.sync(); }
      if (e.key === 'Escape') { setSettingsOpen(false); setAnnouncement(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { if (contentRef.current && !route.highlight) contentRef.current.scrollTop = 0; }, [route.view, route.courseId]);

  const data = state?.data;
  const feed = state?.feed || [];
  const colorMap = useMemo(() => {
    const map = {};
    [...(data?.courses || [])].sort((a, b) => a.id - b.id).forEach((c, i) => (map[c.id] = PALETTE[i % PALETTE.length]));
    return map;
  }, [data]);

  const counts = useMemo(() => {
    const unreadItems = feed.filter((i) => !i.read);
    const byCourse = {};
    const newModules = new Set();
    for (const i of unreadItems) {
      if (i.courseId) byCourse[i.courseId] = (byCourse[i.courseId] || 0) + 1;
      if (i.moduleId && i.type !== 'grade') newModules.add(i.moduleId);
    }
    const n = nowS();
    const dl = data?.deadlines || [];
    return {
      unread: unreadItems.length,
      byCourse,
      newModules,
      urgent: dl.filter((d) => d.time > n && d.time < n + 2 * 86400).length,
      week: dl.filter((d) => d.time > n && d.time < n + 7 * 86400).length,
    };
  }, [feed, data]);

  const setFeed = (f) => setState((s) => ({ ...s, feed: f }));

  const ctx = {
    color: (id) => colorMap[id] || '#8a91a3',
    course: (id) => data?.courses?.find((c) => c.id === id),
    go: (r) => {
      setHistory((h) => [...h.slice(-30), route]);
      setRoute({ ...r, n: Math.random() });
    },
    openPalette: () => setPalette(true),
    openSettings: () => setSettingsOpen(true),
    showAnnouncement: (courseId, id) => {
      setAnnouncement({ courseId, id });
      const it = feed.find((i) => i.type === 'announcement' && i.announcementId === id && !i.read);
      if (it) ctx.markRead([it.id]);
    },
    sync: async () => {
      try {
        const r = await api.sync();
        setState(r.state);
        toast(r.newItems ? `${plural(r.newItems, 'nouveauté trouvée', 'nouveautés trouvées')} ✨` : 'Tout est à jour ✓');
      } catch (e) {
        toast(cleanErr(e), 'error');
      }
    },
    markRead: async (ids) => setFeed(await api.markRead(ids)),
    markUnread: async (id) => setFeed(await api.markUnread(id)),
    // Marque comme lu après 2,5 s de survol (comme une boîte mail)
    markReadSoon: (id) => {
      if (readTimers.current[id]) return;
      readTimers.current[id] = setTimeout(() => ctx.markRead([id]), 2500);
    },
    markModuleRead: (moduleId) => {
      const ids = feed.filter((i) => i.moduleId === moduleId && !i.read).map((i) => i.id);
      if (ids.length) ctx.markRead(ids);
    },
    openFile: async (f) => {
      try {
        if (f.type === 'url') return api.openExternal(f.url);
        toast('Ouverture de « ' + f.name + ' »…');
        await api.openFile({ url: f.url, name: f.name });
      } catch (e) { toast(cleanErr(e), 'error'); }
    },
    saveFile: async (f) => {
      try { const p = await api.saveFile({ url: f.url, name: f.name }); if (p) toast('Enregistré ✓'); } catch (e) { toast(cleanErr(e), 'error'); }
    },
    saveMany: async (files, folderName) => {
      try {
        toast(`Téléchargement de ${plural(files.length, 'fichier', 'fichiers')}…`);
        const p = await api.saveMany({ files: files.map((f) => ({ url: f.url, name: f.name })), folderName });
        if (p) toast('Dossier enregistré ✓');
      } catch (e) { toast(cleanErr(e), 'error'); }
    },
  };

  if (!state) return null;

  if (!state.loggedIn || expired) {
    return html`
      <${LoginScreen} toast=${toast} expiredAccount=${expired ? state.account : null} onLoggedIn=${(s) => { setExpired(false); setState(s); setRoute({ view: 'feed' }); }} />
      ${expired && html`<div style=${{ position: 'fixed', top: '14px', right: '14px' }}><button class="btn" onClick=${() => setExpired(false)}>Continuer hors ligne</button></div>`}
      <div class="toast-zone">${toasts.map((t) => html`<div class=${'toast ' + t.type}>${t.text}</div>`)}</div>`;
  }

  const course = route.view === 'course' ? ctx.course(route.courseId) : null;
  const title = course ? course.fullname : TITLES[route.view];
  const back = history.length && route.view === 'course'
    ? html`<button class="btn ghost icon-only" title="Retour" onClick=${() => { const h = [...history]; const prev = h.pop(); setHistory(h); setRoute(prev); }}><${Icon} name="back" /></button>`
    : null;

  let view;
  if (!data) view = html`<div class="content-inner"><${Empty} icon="refresh" title="Première synchronisation…" text="Récupération de vos cours, fichiers et annonces. Cela peut prendre une minute." /></div>`;
  else if (route.view === 'feed') view = html`<${FeedView} ctx=${ctx} data=${data} feed=${feed} counts=${counts} />`;
  else if (route.view === 'deadlines') view = html`<${DeadlinesView} ctx=${ctx} data=${data} />`;
  else if (route.view === 'courses') view = html`<${CoursesView} ctx=${ctx} data=${data} counts=${counts} />`;
  else if (route.view === 'course') view = html`<${CourseView} ctx=${ctx} data=${data} route=${route} counts=${counts} feed=${feed} />`;
  else if (route.view === 'files') view = html`<${FilesView} ctx=${ctx} data=${data} counts=${counts} />`;
  else if (route.view === 'grades') view = html`<${GradesView} ctx=${ctx} data=${data} />`;

  return html`
    ${progress && html`<div class="sync-bar" style=${{ width: Math.max(4, progress.ratio * 100) + '%' }}></div>`}
    <div class="layout">
      <${Sidebar} ctx=${ctx} route=${route} data=${data} counts=${counts} account=${state.account ? { ...state.account, demo: state.demo } : null} />
      <main class="main">
        <${Topbar} title=${title} ctx=${ctx} syncing=${!!progress} progress=${progress} lastSync=${state.lastSync} left=${back} />
        <div class="content" ref=${contentRef}>${view}</div>
      </main>
    </div>
    ${palette && html`<${Palette} ctx=${ctx} data=${data} onClose=${() => setPalette(false)} />`}
    ${settingsOpen && html`<${SettingsModal} state=${state} onClose=${() => setSettingsOpen(false)}
        onChange=${async (patch) => { const s = await api.setSettings(patch); setState((st) => ({ ...st, settings: s })); }}
        onLogout=${async (forget) => { setSettingsOpen(false); setState(await api.logout({ forgetDevice: forget })); setRoute({ view: 'feed' }); }} />`}
    ${announcement && html`<${AnnouncementModal} ctx=${ctx} courseId=${announcement.courseId} id=${announcement.id} onClose=${() => setAnnouncement(null)} />`}
    <div class="toast-zone">${toasts.map((t) => html`<div class=${'toast ' + t.type}>${t.text}</div>`)}</div>`;
}

render(html`<${App} />`, document.getElementById('app'));
