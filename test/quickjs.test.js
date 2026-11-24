'use strict';
/**
 * La tâche d'arrière-plan Android exécutée dans le VRAI moteur QuickJS (version WebAssembly),
 * le même moteur que le plugin Capacitor Background Runner : pas d'URL, d'URLSearchParams ni d'Intl.
 * Les API natives (CapacitorKV, CapacitorNotifications, CapacitorDevice, fetch) sont fournies par le test.
 */
const test = require('node:test');
const assert = require('node:assert');
const { getQuickJS } = require('quickjs-emscripten');
const { bundleRunner } = require('../scripts/runner-bundle');
const { MoodleClient } = require('../src/main/moodle-client');
const { fetchEverything, buildSnapshot } = require('../src/main/sync');
const mock = require('./mock-moodle-server');

async function makeQuickJSRunner() {
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();
  const kv = new Map();
  const notifications = [];
  const pending = new Set();

  const fn = (name, impl) => {
    const h = vm.newFunction(name, impl);
    vm.setProp(vm.global, name, h);
    h.dispose();
  };
  fn('__kvGet', (k) => (kv.has(vm.getString(k)) ? vm.newString(kv.get(vm.getString(k))) : vm.null));
  fn('__kvSet', (k, v) => { kv.set(vm.getString(k), vm.getString(v)); });
  fn('__kvRemove', (k) => { kv.delete(vm.getString(k)); });
  fn('__notify', (json) => { notifications.push(...JSON.parse(vm.getString(json))); });
  fn('__log', () => {});
  fn('__hostFetch', (urlH, optsH) => {
    const url = vm.getString(urlH);
    const opts = JSON.parse(vm.getString(optsH));
    const deferred = vm.newPromise();
    const p = fetch(url, opts)
      .then(async (r) => ({ status: r.status, body: await r.text() }))
      .catch((e) => ({ status: 0, body: String(e) }))
      .then((res) => {
        const s = vm.newString(JSON.stringify(res));
        deferred.resolve(s);
        s.dispose();
        deferred.dispose();
        pending.delete(p);
      });
    pending.add(p);
    return deferred.handle;
  });

  const prelude = `
    var __handlers = {};
    globalThis.addEventListener = function (name, f) { __handlers[name] = f; };
    globalThis.console = { log: __log, info: __log, warn: __log, error: __log, debug: __log };
    globalThis.CapacitorKV = {
      get: function (k) { var v = __kvGet(k); return v === null ? undefined : { value: v }; },
      set: function (k, v) { __kvSet(k, v); },
      remove: function (k) { __kvRemove(k); },
    };
    globalThis.CapacitorNotifications = { schedule: function (list) { __notify(JSON.stringify(list)); } };
    globalThis.CapacitorDevice = { getNetworkStatus: function () { return { connected: true }; } };
    globalThis.fetch = async function (url, opts) {
      var r = JSON.parse(await __hostFetch(url, JSON.stringify(opts || {})));
      return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async function () { return r.body; }, json: async function () { return JSON.parse(r.body); } };
    };
    globalThis.__dispatch = function (name, json) {
      globalThis.__result = undefined;
      __handlers[name](function (v) { globalThis.__result = JSON.stringify(v === undefined ? null : v); },
                       function (e) { globalThis.__result = JSON.stringify({ rejected: String(e) }); },
                       JSON.parse(json));
    };`;
  const check = (r) => { if (r.error) { const e = vm.dump(r.error); r.error.dispose(); throw new Error(JSON.stringify(e)); } r.value.dispose(); };
  check(vm.evalCode(prelude, 'prelude.js'));
  check(vm.evalCode(bundleRunner(), 'background.js'));

  const handlers = () => { const h = vm.evalCode('Object.keys(__handlers).join(",")'); const v = vm.getString(h.value); h.value.dispose(); return v.split(','); };
  const hasGlobal = (name) => { const h = vm.evalCode(`typeof ${name}`); const v = vm.getString(h.value); h.value.dispose(); return v !== 'undefined'; };

  async function dispatch(name, args = {}) {
    check(vm.evalCode(`__dispatch(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(args))})`));
    for (let i = 0; i < 2000; i++) {
      const jobs = vm.runtime.executePendingJobs();
      if (jobs.error) { const e = vm.dump(jobs.error); jobs.error.dispose(); throw new Error(JSON.stringify(e)); }
      const r = vm.evalCode('globalThis.__result');
      const v = vm.dump(r.value);
      r.value.dispose();
      if (v !== undefined) return JSON.parse(v);
      if (pending.size) await Promise.race(pending); else await new Promise((res) => setImmediate(res));
    }
    throw new Error('la tâche ne s’est jamais terminée (resolve jamais appelé)');
  }
  return { vm, kv, notifications, dispatch, handlers, hasGlobal };
}

test('QuickJS : la tâche d’arrière-plan se charge dans le vrai moteur (sans URL / Intl)', async () => {
  const r = await makeQuickJSRunner();
  assert.strictEqual(r.hasGlobal('URL'), false, 'QuickJS ne doit pas fournir URL (comme Android)');
  assert.strictEqual(r.hasGlobal('Intl'), false);
  assert.deepStrictEqual(r.handlers().sort(), ['checkMoodle', 'logout', 'settings', 'syncState', 'test']);
  assert.deepStrictEqual(await r.dispatch('test'), { sent: true });
  assert.strictEqual(r.notifications[0].smallIcon, 'ic_stat_moodleplus');
  assert.ok(Number.isInteger(r.notifications[0].id));
  r.vm.dispose();
});

test('QuickJS : scénario complet contre le faux Moodle (rappel, nouveauté, hébreu)', async () => {
  const server = await mock.start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await makeQuickJSRunner();
    const data = await fetchEverything(new MoodleClient(origin, server.TOKEN));
    const res = await r.dispatch('syncState', {
      account: { siteUrl: origin, token: server.TOKEN },
      snapshot: buildSnapshot(data),
      lastSync: Math.floor(Date.now() / 1000),
      settings: { notifications: true, lang: 'he' },
      deadlines: data.deadlines,
      courses: data.courses.map((c) => ({ id: c.id, shortname: c.shortname, fullname: c.fullname })),
    });
    assert.strictEqual(res.reminders, 1);
    assert.match(r.notifications[0].body, /להגשה בעוד/);

    await fetch(origin + '/__publish');
    const out = await r.dispatch('checkMoodle');
    assert.strictEqual(out.newItems, 1, JSON.stringify(out));
    assert.match(r.notifications[1].title, /חדש|חדשה/);
    r.vm.dispose();
  } finally {
    server.close();
  }
});
