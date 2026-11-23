'use strict';
/**
 * Client pour l'API Web Services de Moodle (le même protocole que l'application mobile officielle).
 * Toutes les requêtes passent par /webservice/rest/server.php avec le jeton obtenu à la connexion.
 */

class MoodleError extends Error {
  constructor(message, code, fn) {
    super(message);
    this.code = code;
    this.fn = fn;
  }
}

/** Nettoie l'adresse tapée par l'utilisateur : "moodle.univ.fr/my/" → "https://moodle.univ.fr" */
function normalizeSiteUrl(input) {
  let url = String(input || '').trim();
  if (!url) throw new Error('Adresse Moodle vide');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const u = new URL(url);
  let p = u.pathname
    .replace(/\/(login\/index\.php|my\/?.*|course\/.*|index\.php|admin\/.*)$/i, '')
    .replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${p}`;
}

/** Transforme {a:[1,2], b:{c:3}} en a[0]=1&a[1]=2&b[c]=3 (format attendu par Moodle). */
function flattenParams(obj, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj || {})) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      flattenParams(value, name, out);
    } else if (typeof value === 'boolean') {
      out.append(name, value ? '1' : '0');
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

/** Configuration publique du site (nom, type de connexion, URL de lancement SSO…). Pas besoin d'être connecté. */
async function getPublicConfig(siteUrl, fetchImpl = fetch) {
  const res = await fetchImpl(`${siteUrl}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ index: 0, methodname: 'tool_mobile_get_public_config', args: {} }]),
  });
  if (!res.ok) throw new Error(`Le site a répondu ${res.status}`);
  const json = await res.json();
  const first = Array.isArray(json) ? json[0] : json;
  if (!first || first.error) {
    const msg = first?.exception?.message || 'Ce site ne semble pas autoriser l\'application mobile Moodle.';
    throw new Error(msg);
  }
  return first.data;
}

class MoodleClient {
  constructor(siteUrl, token, fetchImpl = fetch) {
    this.siteUrl = siteUrl.replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }

  async call(wsfunction, args = {}) {
    const body = flattenParams(args);
    body.append('wstoken', this.token);
    body.append('wsfunction', wsfunction);
    body.append('moodlewsrestformat', 'json');
    const res = await this.fetch(`${this.siteUrl}/webservice/rest/server.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new MoodleError(`HTTP ${res.status} sur ${wsfunction}`, 'http', wsfunction);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new MoodleError(`Réponse illisible pour ${wsfunction}`, 'parse', wsfunction);
    }
    if (json && typeof json === 'object' && !Array.isArray(json) && json.exception) {
      throw new MoodleError(json.message || json.errorcode, json.errorcode, wsfunction);
    }
    return json;
  }

  /** Appel « tolérant » : renvoie `fallback` si la fonction n'existe pas sur ce Moodle ou est refusée. */
  async tryCall(wsfunction, args, fallback = null) {
    try {
      return await this.call(wsfunction, args);
    } catch (e) {
      if (isAuthError(e)) throw e;
      return fallback;
    }
  }

  /** Ajoute le jeton aux URL de fichiers Moodle pour pouvoir les télécharger. */
  fileUrl(url) {
    if (!url) return url;
    if (!url.includes('/pluginfile.php') && !url.includes('/webservice/pluginfile.php')) return url;
    const u = new URL(url.replace('/pluginfile.php', url.includes('/webservice/') ? '/pluginfile.php' : '/webservice/pluginfile.php'));
    u.searchParams.set('token', this.token);
    return u.toString();
  }
}

function isAuthError(e) {
  return e && ['invalidtoken', 'accessexception', 'servicerequireslogin', 'usernotfullysetup'].includes(e.code);
}

module.exports = { MoodleClient, MoodleError, normalizeSiteUrl, flattenParams, getPublicConfig, isAuthError };
