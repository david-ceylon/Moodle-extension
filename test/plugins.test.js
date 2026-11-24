'use strict';
/**
 * Garde-fou : les noms de plugins natifs utilisés par l'appli Android doivent être EXACTEMENT ceux
 * enregistrés par les bibliothèques officielles (sinon l'appel échoue sans bruit sur le téléphone).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'src/renderer/web-bridge.js'), 'utf8');
const registered = (pkg) => {
  const src = fs.readFileSync(path.join(root, 'node_modules', pkg, 'dist/esm/index.js'), 'utf8');
  return /registerPlugin\('([^']+)'/.exec(src)[1];
};

test('nom du plugin d’arrière-plan = celui de @capacitor/background-runner', () => {
  assert.match(bridge, new RegExp(`PLUGIN_RUNNER = '${registered('@capacitor/background-runner')}'`));
});

test('nom du plugin App = celui de @capacitor/app', () => {
  assert.match(bridge, new RegExp(`PLUGIN_APP = '${registered('@capacitor/app')}'`));
});

test('l’icône de notification existe dans le projet Android', () => {
  const runner = fs.readFileSync(path.join(root, 'src/runner/background.js'), 'utf8');
  const icon = /smallIcon: '([^']+)'/.exec(runner)[1];
  for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    assert.ok(fs.existsSync(path.join(root, `android/app/src/main/res/drawable-${d}/${icon}.png`)), `${icon} manquant en ${d}`);
  }
});

test('la clé de configuration lue par le plugin Android est bien présente', () => {
  const kt = fs.readFileSync(path.join(root, 'node_modules/@capacitor/background-runner/android/src/main/java/io/ionic/backgroundrunner/plugin/BackgroundRunner.kt'), 'utf8');
  const key = /plugins\.getJSONObject\("([^"]+)"\)/.exec(kt)[1];
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  assert.ok(cfg.plugins[key], `capacitor.config.json doit contenir plugins.${key}`);
  assert.strictEqual(cfg.plugins[key].src, 'runners/background.js');
});
