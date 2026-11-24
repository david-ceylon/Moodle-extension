'use strict';
/**
 * Cœur commun de la web-app, de l'appli Android et de l'extension Chrome (page ET tâche de fond) :
 *  - stockage clé/valeur sur IndexedDB (même base partout : 'moodle-plus') ;
 *  - une synchronisation complète : récupération Moodle → détection des nouveautés → enregistrement.
 * Script « classique » (pas un module) : utilisable par une page et par un service worker (importScripts).
 */
(function () {
  function openKV(name = 'moodle-plus') {
    const dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = async (mode, fn) => {
      const db = await dbp;
      return new Promise((resolve, reject) => {
        const t = db.transaction('kv', mode);
        const r = fn(t.objectStore('kv'));
        t.oncomplete = () => resolve(r && r.result);
        t.onerror = () => reject(t.error);
      });
    };
    return {
      get: (k) => tx('readonly', (s) => s.get(k)),
      set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
      del: (k) => tx('readwrite', (s) => s.delete(k)),
      clear: () => tx('readwrite', (s) => s.clear()),
    };
  }

  /** Synchronise une fois et enregistre tout. Renvoie { data, newItems, prevSnap }. */
  async function syncOnce({ db, client, now = Math.floor(Date.now() / 1000), onProgress = () => {} }) {
    const S = globalThis.MoodleSync;
    const data = await S.fetchEverything(client, { now, onProgress });
    if (data.site.user.picture) data.site.user.picture = client.fileUrl(data.site.user.picture);
    const prevSnap = (await db.get('snapshot')) || null;
    const prevSync = (await db.get('lastSync')) || 0;
    const newItems = S.diff(data, prevSnap, prevSync, now);
    const feed = S.mergeFeed((await db.get('feed')) || [], newItems);
    await db.set('data', data);
    await db.set('snapshot', S.buildSnapshot(data));
    await db.set('feed', feed);
    await db.set('lastSync', now);
    return { data, newItems, prevSnap, feed };
  }

  globalThis.MoodleWebCore = { openKV, syncOnce };
})();
