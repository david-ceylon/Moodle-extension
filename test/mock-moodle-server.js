'use strict';
/**
 * Faux serveur Moodle pour les tests de bout en bout :
 *  - page de connexion SSO + étape de double authentification (code 123456)
 *  - launch.php qui renvoie vers moodlemobile://token=…
 *  - API REST (données de la démo) et téléchargement de fichiers protégés par jeton
 *
 * Lancement manuel :  node test/mock-moodle-server.js 8099
 */
const http = require('http');
const crypto = require('crypto');
const { createDemoClient } = require('../src/main/demo');

const TOKEN = 'tok_' + crypto.randomBytes(6).toString('hex');
const PRIVATE = 'priv_' + crypto.randomBytes(6).toString('hex');
const DEMO_SITE = 'https://moodle.demo-universite.fr';

function unflatten(params) {
  const out = {};
  for (const [k, raw] of params) {
    const v = /^-?\d+$/.test(raw) ? Number(raw) : raw;
    const parts = k.replace(/\]/g, '').split('[');
    let cur = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) cur[p] = v;
      else cur = cur[p] = cur[p] || (/^\d+$/.test(parts[i + 1]) ? [] : {});
    });
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => c.split('=')));
}

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>CAS — Connexion</title>
<style>body{font-family:sans-serif;background:#eef2f7;display:grid;place-items:center;height:100vh;margin:0}
form{background:#fff;padding:28px;border-radius:12px;width:300px;box-shadow:0 4px 20px rgba(0,0,0,.1)}
input,button{width:100%;padding:10px;margin-top:10px;box-sizing:border-box}button{background:#1d4ed8;color:#fff;border:0;border-radius:6px}</style>
</head><body>${body}</body></html>`;

function start(port = 0) {
  const client = createDemoClient();
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, origin);
    const ck = cookies(req);
    const send = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(body); };
    server.log.push(`${req.method} ${url.pathname}`);

    // Requête préalable CORS (navigateurs) — l'appli Android passe par le réseau natif et n'en envoie pas
    if (req.method === 'OPTIONS') {
      return send(204, '', { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST' });
    }
    // Simule un enseignant qui publie un nouveau contenu
    if (url.pathname === '/__publish') {
      client.publishSomething();
      return send(200, 'ok');
    }
    if (url.pathname === '/lib/ajax/service-nologin.php') {
      return send(200, JSON.stringify([{ error: false, data: { sitename: 'Moodle Test (faux serveur)', wwwroot: origin, httpswwwroot: origin, typeoflogin: 2, launchurl: `${origin}/admin/tool/mobile/launch.php` } }]), { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    }
    if (url.pathname === '/admin/tool/mobile/launch.php') {
      if (ck.MoodleSession !== 'ok') {
        return send(303, '', { location: '/login/index.php', 'set-cookie': `wants=${encodeURIComponent(url.search)}; Path=/` });
      }
      const sig = crypto.createHash('md5').update(origin + url.searchParams.get('passport')).digest('hex');
      const tok = Buffer.from(`${sig}:::${TOKEN}:::${PRIVATE}`).toString('base64');
      return send(303, '', { location: `${url.searchParams.get('urlscheme')}://token=${tok}` });
    }
    if (url.pathname === '/login/index.php') {
      if (req.method === 'POST') {
        const p = new URLSearchParams(await readBody(req));
        if (p.get('username') && p.get('password')) return send(303, '', { location: '/mfa', 'set-cookie': 'pending=1; Path=/' });
      }
      return send(200, page(`<form method="post"><h3>Connexion établissement</h3><input name="username" placeholder="Identifiant"><input name="password" type="password" placeholder="Mot de passe"><button>Se connecter</button></form>`));
    }
    if (url.pathname === '/mfa') {
      if (req.method === 'POST') {
        const p = new URLSearchParams(await readBody(req));
        if (p.get('code') === '123456' && ck.pending) {
          // Comme beaucoup de SSO (CAS, SAML…) : retour vers Moodle par une page HTML qui redirige
          const back = '/admin/tool/mobile/launch.php' + decodeURIComponent(ck.wants || '');
          return send(200, `<!doctype html><meta http-equiv="refresh" content="0;url=${back}"><p>Redirection…</p>`, { 'set-cookie': 'MoodleSession=ok; Path=/' });
        }
      }
      return send(200, page(`<form method="post"><h3>Double authentification</h3><p>Code reçu par SMS :</p><input name="code" placeholder="123456"><button>Valider</button></form>`));
    }
    if (url.pathname === '/webservice/rest/server.php') {
      const args = unflatten(new URLSearchParams(await readBody(req)));
      // Comme le vrai Moodle : l'API Web Services autorise les appels depuis une autre origine (CORS)
      const json = (o) => send(200, JSON.stringify(o).split(DEMO_SITE).join(origin), { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      if (args.wstoken !== TOKEN) return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Jeton invalide' });
      const { wstoken, wsfunction, moodlewsrestformat, ...rest } = args;
      if (wsfunction === 'tool_mobile_get_autologin_key') return json({ key: 'k', autologinurl: `${origin}/admin/tool/mobile/autologin.php` });
      try {
        return json(await client.call(wsfunction, rest));
      } catch (e) {
        return json({ exception: 'invalid_parameter_exception', errorcode: e.code || 'invalidfunction', message: e.message });
      }
    }
    if (url.pathname.startsWith('/webservice/pluginfile.php')) {
      if (url.searchParams.get('token') !== TOKEN) return send(403, '{"error":"Jeton manquant"}', { 'content-type': 'application/json' });
      return send(200, '%PDF-1.4\n% faux PDF de test\n', { 'content-type': 'application/pdf' });
    }
    send(404, 'Not found');
  });
  server.log = [];
  server.TOKEN = TOKEN;
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

if (require.main === module) {
  start(Number(process.argv[2]) || 8099).then((s) => console.log(`Faux Moodle sur http://127.0.0.1:${s.address().port} (2FA : 123456)`));
}

module.exports = { start, unflatten };
