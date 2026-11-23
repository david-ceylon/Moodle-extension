'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MoodleClient, normalizeSiteUrl, flattenParams } = require('../src/main/moodle-client');
const { fetchEverything, buildSnapshot, diff, mergeFeed } = require('../src/main/sync');
const { decodeTokenUrl } = require('../src/main/auth');
const { createDemoClient } = require('../src/main/demo');
const mock = require('./mock-moodle-server');

test('normalizeSiteUrl nettoie les adresses tapées', () => {
  assert.strictEqual(normalizeSiteUrl('moodle.univ.fr'), 'https://moodle.univ.fr');
  assert.strictEqual(normalizeSiteUrl('https://moodle.univ.fr/my/'), 'https://moodle.univ.fr');
  assert.strictEqual(normalizeSiteUrl('https://elearn.univ.fr/moodle/login/index.php'), 'https://elearn.univ.fr/moodle');
  assert.strictEqual(normalizeSiteUrl('https://elearn.univ.fr/moodle/course/view.php?id=3'), 'https://elearn.univ.fr/moodle');
});

test('flattenParams produit le format de tableaux Moodle', () => {
  const p = flattenParams({ courseids: [3, 4], options: { a: true }, x: 'y' });
  assert.strictEqual(p.toString(), 'courseids%5B0%5D=3&courseids%5B1%5D=4&options%5Ba%5D=1&x=y');
  assert.deepStrictEqual(mock.unflatten(new URLSearchParams(p.toString())), { courseids: [3, 4], options: { a: 1 }, x: 'y' });
});

test('decodeTokenUrl décode le jeton renvoyé par launch.php', () => {
  const b64 = Buffer.from('abc:::TOKEN123:::PRIV').toString('base64');
  assert.deepStrictEqual(decodeTokenUrl(`moodlemobile://token=${b64}`), { signature: 'abc', token: 'TOKEN123', privateToken: 'PRIV' });
  assert.strictEqual(decodeTokenUrl('moodlemobile://autre'), null);
});

test('fileUrl ajoute le jeton et passe par webservice/pluginfile.php', () => {
  const c = new MoodleClient('https://m.fr', 'T');
  assert.strictEqual(c.fileUrl('https://m.fr/pluginfile.php/1/a.pdf'), 'https://m.fr/webservice/pluginfile.php/1/a.pdf?token=T');
  assert.strictEqual(c.fileUrl('https://m.fr/webservice/pluginfile.php/1/a.pdf?forcedownload=1'), 'https://m.fr/webservice/pluginfile.php/1/a.pdf?forcedownload=1&token=T');
  assert.strictEqual(c.fileUrl('https://youtube.com/x'), 'https://youtube.com/x');
});

test('1re synchro : seuls les éléments récents (< 14 j) arrivent dans le fil', async () => {
  const now = Math.floor(Date.now() / 1000);
  const data = await fetchEverything(createDemoClient(), { now });
  assert.strictEqual(data.courses.length, 6);
  const items = diff(data, null, 0, now);
  assert.ok(items.length > 0);
  for (const i of items) assert.ok(i.time >= now - 14 * 86400, `${i.title} est trop ancien`);
  assert.ok(items.some((i) => i.type === 'announcement'));
  assert.ok(items.some((i) => i.type === 'grade'));
});

test('synchro suivante : détecte un dossier ajouté, des fichiers ajoutés et modifiés', async () => {
  const now = Math.floor(Date.now() / 1000);
  const before = await fetchEverything(createDemoClient(), { now });
  const snap = buildSnapshot(before);
  const after = JSON.parse(JSON.stringify(before));
  const sec = after.courses[0].sections[1];
  sec.modules.push({ id: 999999, name: 'Annales', modname: 'folder', url: 'u', description: '', visible: true, dates: [], files: [{ name: 'a.pdf', path: '/a.pdf', time: now }, { name: 'b.pdf', path: '/b.pdf', time: now }], lastModified: now });
  const folder = sec.modules.find((m) => m.modname === 'folder' && m.id !== 999999);
  folder.files.push({ name: 'nouveau.pdf', path: '/nouveau.pdf', time: now });
  folder.files[0].time = now;

  const items = diff(after, snap, now - 60, now);
  const types = items.map((i) => i.type).sort();
  assert.deepStrictEqual(types, ['new_files', 'new_module', 'updated_files']);
  const added = items.find((i) => i.type === 'new_module');
  assert.strictEqual(added.files.length, 2);
  assert.strictEqual(items.find((i) => i.type === 'new_files').files[0].name, 'nouveau.pdf');

  // Rien de neuf si on resynchronise sans changement
  assert.deepStrictEqual(diff(after, buildSnapshot(after), now, now + 10), []);
});

test('mergeFeed évite les doublons et garde l\'état lu', () => {
  const feed = [{ id: 'a', time: 1, read: true }];
  const merged = mergeFeed(feed, [{ id: 'a', time: 1, read: false }, { id: 'b', time: 2, read: false }]);
  assert.deepStrictEqual(merged.map((i) => [i.id, i.read]), [['b', false], ['a', true]]);
});

test('client REST contre le faux serveur Moodle (jeton, erreurs, fichiers)', async () => {
  const server = await mock.start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = new MoodleClient(origin, 'mauvais');
    await assert.rejects(() => bad.call('core_webservice_get_site_info'), (e) => e.code === 'invalidtoken');
    const c = new MoodleClient(origin, server.TOKEN);
    const data = await fetchEverything(c);
    assert.strictEqual(data.courses.length, 6);
    const f = data.courses[0].sections[1].modules[0].files[0];
    assert.ok(f.url.startsWith(origin) && f.url.includes('token='));
    const res = await fetch(f.url);
    assert.ok((await res.text()).startsWith('%PDF'));
  } finally {
    server.close();
  }
});
