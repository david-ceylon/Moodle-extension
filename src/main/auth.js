'use strict';
/**
 * Connexion SSO + double authentification.
 *
 * Principe (identique à l'application mobile Moodle officielle) :
 *  1. On ouvre, DANS l'application, une fenêtre sur  <site>/admin/tool/mobile/launch.php
 *  2. Moodle redirige vers la vraie page de connexion (CAS, Shibboleth, Microsoft, Google…),
 *     l'utilisateur tape son mot de passe et valide la double authentification (code, appli, SMS…)
 *     directement dans cette fenêtre.
 *  3. Une fois connecté, Moodle redirige vers  moodlemobile://token=<base64>
 *     On intercepte cette adresse, on décode le jeton et on ferme la fenêtre.
 *
 * Les cookies du fournisseur d'identité sont conservés (partition persistante), donc si
 * votre établissement propose « se souvenir de cet appareil », la 2FA ne sera pas redemandée à chaque fois.
 */
const crypto = require('crypto');
const { BrowserWindow, session } = require('electron');

const PARTITION = 'persist:moodle';
const URL_SCHEME = 'moodlemobile';

function decodeTokenUrl(url) {
  // moodlemobile://token=BASE64  (parfois avec un "/" final ou un fragment)
  const m = String(url).match(/token=([A-Za-z0-9+/=_-]+)/);
  if (!m) return null;
  const decoded = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const [signature, token, privateToken] = decoded.split(':::');
  if (!token) return null;
  return { signature, token, privateToken: privateToken || null };
}

function moodleSession() {
  return session.fromPartition(PARTITION);
}

/** Supprime uniquement les cookies du site Moodle (on garde ceux du fournisseur SSO pour la 2FA). */
async function clearMoodleCookies(siteUrl) {
  const ses = moodleSession();
  const host = new URL(siteUrl).hostname;
  const cookies = await ses.cookies.get({});
  await Promise.all(
    cookies
      .filter((c) => host === c.domain.replace(/^\./, '') || host.endsWith(c.domain.startsWith('.') ? c.domain : '.' + c.domain))
      .map((c) => {
        const url = `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path}`;
        return ses.cookies.remove(url, c.name).catch(() => {});
      })
  );
}

/**
 * Ouvre la fenêtre de connexion et résout avec { token, privateToken } quand l'utilisateur est connecté.
 * @param {object} opts
 * @param {string} opts.siteUrl
 * @param {string} [opts.launchUrl]  URL de lancement renvoyée par la config publique
 * @param {BrowserWindow} [opts.parent]
 */
async function loginWithBrowser({ siteUrl, launchUrl, parent }) {
  await clearMoodleCookies(siteUrl);
  const ses = moodleSession();
  const passport = crypto.randomBytes(8).toString('hex');
  const base = launchUrl || `${siteUrl}/admin/tool/mobile/launch.php`;
  const url = new URL(base);
  url.searchParams.set('service', 'moodle_mobile_app');
  url.searchParams.set('passport', passport);
  url.searchParams.set('urlscheme', URL_SCHEME);

  return new Promise((resolve, reject) => {
    let done = false;
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent,
      modal: !!parent,
      show: false,
      title: 'Connexion à Moodle',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });

    const finish = (err, result) => {
      if (done) return;
      done = true;
      try { ses.protocol.unhandle(URL_SCHEME); } catch { /* déjà retiré */ }
      if (!win.isDestroyed()) win.close();
      if (err) reject(err);
      else resolve(result);
    };

    const tryCapture = (event, target) => {
      if (typeof target !== 'string' || !target.startsWith(URL_SCHEME + '://')) return false;
      if (event && event.preventDefault) event.preventDefault();
      const decoded = decodeTokenUrl(target);
      if (!decoded) {
        finish(new Error('[invalidToken] Jeton de connexion invalide reçu de Moodle.'));
      } else {
        const expected = crypto.createHash('md5').update(siteUrl + passport).digest('hex');
        decoded.signatureValid = decoded.signature === expected;
        finish(null, decoded);
      }
      return true;
    };

    // Filet de sécurité : si Chromium essaie vraiment d'ouvrir moodlemobile://, on capte la requête.
    try {
      ses.protocol.handle(URL_SCHEME, (request) => {
        tryCapture(null, request.url);
        return new Response('<html><body>Connexion réussie, vous pouvez fermer cette fenêtre.</body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      });
    } catch { /* déjà enregistré */ }

    const wc = win.webContents;
    wc.on('will-redirect', (e, target) => tryCapture(e, target));
    wc.on('will-navigate', (e, target) => tryCapture(e, target));
    wc.on('will-frame-navigate', (e) => tryCapture(e, e.url));
    wc.on('did-fail-load', (_e, _code, _desc, validatedURL) => tryCapture(null, validatedURL));
    wc.setWindowOpenHandler(({ url: target }) => {
      if (tryCapture(null, target)) return { action: 'deny' };
      // Certains SSO ouvrent une popup (ex. Microsoft) : on l'autorise dans la même session.
      return { action: 'allow', overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true, webPreferences: { partition: PARTITION } } };
    });

    // Repérer la page d'erreur Moodle « plugin non configuré » pour donner un message clair.
    wc.on('did-finish-load', async () => {
      try {
        const text = await wc.executeJavaScript('document.body ? document.body.innerText.slice(0, 2000) : ""');
        if (/pluginnotenabledorconfigured|enablewsdescription|n'est pas activ|not enabled/i.test(text) && wc.getURL().includes('launch.php')) {
          finish(new Error('[wsDisabled] Ce Moodle n\'autorise pas la connexion par l\'application mobile (services web désactivés).'));
        }
      } catch { /* page en cours de navigation */ }
    });

    win.on('closed', () => finish(new Error('[cancelled] Connexion annulée.')));
    win.once('ready-to-show', () => win.show());
    win.loadURL(url.toString()).catch((e) => {
      if (!done && !String(e.message).includes('ERR_ABORTED') && !String(e.message).includes('ERR_UNKNOWN_URL_SCHEME')) {
        finish(new Error('[unreachable] Impossible de joindre Moodle : ' + e.message));
      }
    });
  });
}

/** Ouvre une page Moodle (activité, cours…) dans une fenêtre de l'app, avec la session connectée. */
function openMoodlePage(url, parent) {
  const win = new BrowserWindow({
    width: 1200,
    height: 850,
    parent,
    autoHideMenuBar: true,
    title: 'Moodle',
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(url);
  return win;
}

async function clearAllSessionData() {
  await moodleSession().clearStorageData();
}

module.exports = { loginWithBrowser, openMoodlePage, decodeTokenUrl, clearAllSessionData, moodleSession, PARTITION };
