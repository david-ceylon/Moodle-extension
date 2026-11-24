'use strict';
/**
 * Tâche d'arrière-plan Android exécutée dans un bac à sable qui imite le moteur QuickJS du plugin :
 * pas d'URL, pas d'URLSearchParams, pas d'Intl, pas de DOM — seulement fetch, CapacitorKV,
 * CapacitorNotifications, CapacitorDevice et addEventListener.
 */
const test = require('node:test');
const assert = require('node:assert');
const { makeRunner } = require('./runner-sandbox');
const { MoodleClient } = require('../src/main/moodle-client');
const { fetchEverything, buildSnapshot } = require('../src/main/sync');
const mock = require('./mock-moodle-server');

test('la tâche d’arrière-plan se charge sans URL/URLSearchParams/Intl et déclare ses événements', () => {
  const r = makeRunner();
  assert.deepStrictEqual(Object.keys(r.handlers).sort(), ['checkMoodle', 'logout', 'settings', 'syncState', 'test']);
});

test('arrière-plan : rappels, nouveautés, pas de doublon, session expirée, déconnexion', async () => {
  const server = await mock.start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = makeRunner();
    assert.deepStrictEqual(await r.dispatch('checkMoodle', {}), { skipped: 'non connecté' });

    // L'appli vient de se synchroniser et transmet son état
    const data = await fetchEverything(new MoodleClient(origin, server.TOKEN));
    const res = await r.dispatch('syncState', {
      account: { siteUrl: origin, token: server.TOKEN },
      snapshot: buildSnapshot(data),
      lastSync: Math.floor(Date.now() / 1000),
      settings: { notifications: true },
      deadlines: data.deadlines,
      courses: data.courses.map((c) => ({ id: c.id, shortname: c.shortname, fullname: c.fullname })),
    });
    // Le faux Moodle a un quiz à rendre dans 18 h → rappel « moins de 24 h »
    assert.strictEqual(res.reminders, 1);
    assert.match(r.notifications[0].title, /Quiz/);
    assert.match(r.notifications[0].body, /À rendre dans 17 h|À rendre dans 18 h/);

    // Rien de neuf → aucune notification
    r.notifications.length = 0;
    assert.deepStrictEqual(await r.dispatch('checkMoodle', {}), { newItems: 0, reminders: 0 });
    assert.strictEqual(r.notifications.length, 0);

    // Un enseignant publie quelque chose → notification
    await fetch(origin + '/__publish');
    const out = await r.dispatch('checkMoodle', {});
    assert.strictEqual(out.newItems, 1);
    assert.strictEqual(r.notifications.length, 1);
    assert.match(r.notifications[0].title, /Nouveau (fichier|dossier)|Nouvelle activité/);
    assert.ok(Number.isInteger(r.notifications[0].id) && r.notifications[0].id > 0);

    // … et pas une deuxième fois
    r.notifications.length = 0;
    await r.dispatch('checkMoodle', {});
    assert.strictEqual(r.notifications.length, 0);

    // Réglage « annonces / contenus désactivés » respecté
    await r.dispatch('settings', { settings: { notifyContent: false } });
    await fetch(origin + '/__publish');
    assert.strictEqual((await r.dispatch('checkMoodle', {})).newItems, 0);

    // Jeton refusé → une seule notification « reconnexion »
    const st = JSON.parse(r.kv.get('mp.state'));
    st.account.token = 'perime';
    r.kv.set('mp.state', JSON.stringify(st));
    await r.dispatch('checkMoodle', {});
    await r.dispatch('checkMoodle', {});
    assert.strictEqual(r.notifications.filter((n) => /reconnexion/.test(n.title)).length, 1);

    await r.dispatch('logout', {});
    assert.strictEqual(r.kv.size, 0);
  } finally {
    server.close();
  }
});
