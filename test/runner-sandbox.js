'use strict';
/**
 * Exécute la tâche d'arrière-plan Android dans un bac à sable qui imite le moteur QuickJS du plugin
 * (pas d'URL, URLSearchParams, Intl ni DOM ; seulement fetch, CapacitorKV, CapacitorNotifications,
 * CapacitorDevice et addEventListener).
 */
const vm = require('node:vm');
const { bundleRunner } = require('../scripts/runner-bundle');

function makeRunner() {
  const kv = new Map();
  const notifications = [];
  const handlers = {};
  const ctx = vm.createContext({
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    setTimeout, clearTimeout,
    // fetch « pauvre », comme celui du plugin : status, ok, text(), json()
    fetch: async (url, opts) => {
      const r = await fetch(url, opts);
      const text = await r.text();
      return { status: r.status, ok: r.ok, text: async () => text, json: async () => JSON.parse(text) };
    },
    CapacitorKV: { get: (k) => (kv.has(k) ? { value: kv.get(k) } : undefined), set: (k, v) => kv.set(k, v), remove: (k) => kv.delete(k) },
    CapacitorNotifications: { schedule: (list) => notifications.push(...list) },
    CapacitorDevice: { getNetworkStatus: () => ({ connected: true }) },
    addEventListener: (name, fn) => (handlers[name] = fn),
  });
  vm.runInContext('delete globalThis.Intl; delete globalThis.URL; delete globalThis.URLSearchParams;', ctx);
  vm.runInContext(bundleRunner(), ctx, { filename: 'background.js' });
  // JSON aller-retour : les objets du bac à sable ont d'autres prototypes que ceux du test
  const dispatch = (event, args) => new Promise((resolve, reject) => handlers[event]((v) => resolve(JSON.parse(JSON.stringify(v))), reject, JSON.parse(JSON.stringify(args))));
  return { kv, notifications, handlers, dispatch };
}

module.exports = { makeRunner };
