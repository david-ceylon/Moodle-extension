'use strict';
/**
 * Test de la logique de l'appli Android SANS émulateur : on charge la version « native » de l'interface
 * dans un Chrome mobile, en simulant les deux briques natives (navigateur intégré InAppBrowser et
 * bouton retour). La connexion passe par les vraies pages du faux Moodle (mot de passe + 2FA),
 * et la redirection finale moodlemobile://token=… est transmise comme le ferait Android.
 *   NATIVE=1 node scripts/build-web.js && node test/e2e-android.js [dossier-captures]
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium, devices } = require('playwright');
const mock = require('./mock-moodle-server');
const { makeRunner } = require('./runner-sandbox');

const STUB = `
  window.__runnerCalls = [];
  window.Capacitor = { isNativePlatform: () => true, Plugins: {
    App: {
      addListener(ev, cb) { (window.__appListeners = window.__appListeners || {})[ev] = cb; },
      minimizeApp() { window.__minimized = true; },
    },
    BackgroundRunner: {
      async dispatchEvent(o) { window.__runnerCalls.push(JSON.parse(JSON.stringify(o))); return {}; },
      async requestPermissions() { window.__permAsked = true; return { notifications: 'granted' }; },
    },
  } };
  window.cordova = { InAppBrowser: { open(url, target, opts) {
    (window.__iabCalls = window.__iabCalls || []).push({ url, target });
    const listeners = {};
    const win = target === '_blank' ? window.open(url, 'iab') : null;
    window.__iabEmit = (type, e) => (listeners[type] || []).forEach((cb) => cb(e));
    return {
      addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
      close() { if (win) win.close(); },
      executeScript(o, cb) { if (cb) cb(['']); },
    };
  } } };`;

(async () => {
  const outDir = process.argv[2] || path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const server = await mock.start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const web = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'serve-web.js'), '5198'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 500));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    await context.addInitScript(STUB);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    if (process.env.DEBUG) page.on('console', (m) => console.log('console:', m.text()));
    if (process.env.DEBUG) context.on('requestfailed', (r) => console.log('failed:', r.url().slice(0, 80), r.failure()?.errorText));
    await page.goto('http://localhost:5198/');
    await page.waitForSelector('.login-card input');
    console.log('🏫 site pré-rempli :', await page.inputValue('.login-card input'));
    await page.screenshot({ path: path.join(outDir, '30-android-connexion.png') });

    await page.fill('.login-card input', origin);
    await page.click('text=Continuer');
    await page.waitForSelector('text=Moodle Test (faux serveur)');

    // Le « navigateur intégré » : on transmet la redirection moodlemobile:// à l'appli, comme Android
    await context.route('**/admin/tool/mobile/launch.php*', async (route) => {
      const resp = await route.fetch({ maxRedirects: 0, headers: await route.request().allHeaders() });
      const loc = resp.headers()['location'] || '';
      if (process.env.DEBUG) console.log('launch.php →', resp.status(), loc.slice(0, 60));
      if (loc.startsWith('moodlemobile://')) {
        await page.evaluate((u) => window.__iabEmit('customscheme', { url: u }), loc);
        return route.fulfill({ status: 200, body: 'ok' });
      }
      return route.fulfill({ response: resp });
    });
    const popupPromise = context.waitForEvent('page');
    await page.click('button:has-text("Se connecter")');
    const iab = await popupPromise;
    await iab.waitForSelector('input[name=username]');
    await page.screenshot({ path: path.join(outDir, '31-android-attente-2fa.png') });
    await iab.fill('input[name=username]', 'etudiant');
    await iab.fill('input[name=password]', 'secret');
    await iab.click('button');
    await iab.fill('input[name=code]', '123456');
    await iab.click('button');

    await page.waitForSelector('.feed-item', { timeout: 15000 }).catch(async (e) => { await page.screenshot({ path: path.join(outDir, 'debug.png') }); throw e; });
    console.log('✅ connecté directement depuis le « téléphone » :', await page.locator('.feed-item').count(), 'nouveautés');
    const calls = await page.evaluate(() => window.__iabCalls);
    console.log('🌐 page ouverte dans le navigateur intégré :', calls[0].url.replace(origin, '<moodle>').slice(0, 90));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '32-android-nouveautes.png') });

    // L'appli a transmis son état à la tâche d'arrière-plan (et demandé l'autorisation de notifier)
    await page.waitForFunction(() => window.__runnerCalls.some((c) => c.event === 'syncState'));
    const call = (await page.evaluate(() => window.__runnerCalls)).find((c) => c.event === 'syncState');
    console.log('🔔 état envoyé à l’arrière-plan :', call.label, '— jeton', call.details.account.token === server.TOKEN ? 'OK' : 'KO',
      '— photo de', Object.keys(call.details.snapshot).length, 'éléments —', call.details.deadlines.length, 'échéances — autorisation demandée :', await page.evaluate(() => !!window.__permAsked));
    // … et la VRAIE tâche d'arrière-plan comprend ce message
    const bg = makeRunner();
    const res = await bg.dispatch('syncState', call.details);
    await fetch(origin + '/__publish');
    const check = await bg.dispatch('checkMoodle', {});
    console.log('📲 tâche d’arrière-plan : rappels =', res.reminders, '; puis nouveautés détectées =', check.newItems, '→', bg.notifications.map((n) => n.title).join(' | '));

    // Réglages : choix des notifications + bouton de test
    await page.click('.topbar button[title="Réglages"]');
    await page.click('.notify-option:has-text("Annonces") .switch');
    await page.click('text=Tester une notification');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '33-android-reglages.png') });
    const events = (await page.evaluate(() => window.__runnerCalls)).map((c) => c.event);
    const sett = (await page.evaluate(() => window.__runnerCalls)).filter((c) => c.event === 'settings').pop();
    console.log('⚙️  événements envoyés :', [...new Set(events)].join(', '), '— annonces désactivées transmises :', sett && sett.details.settings.notifyAnnouncements === false);
    await page.click('.modal button:has(svg) >> nth=0');

    // Bouton retour Android
    await page.click('.bottom-nav button:has-text("Échéances")');
    await page.evaluate(() => window.__appListeners.backButton());
    await page.waitForTimeout(200);
    const title = await page.locator('.topbar h1').innerText();
    await page.evaluate(() => window.__appListeners.backButton());
    console.log('⬅️  retour : revenu sur', JSON.stringify(title), '— appli réduite au 2e appui :', await page.evaluate(() => !!window.__minimized));

    // Ouvrir un fichier → navigateur système
    await page.evaluate(async () => {
      const st = await window.moodle.getState();
      await window.moodle.openFile(st.data.courses[0].sections[1].modules[0].files[0]);
    });
    const last = (await page.evaluate(() => window.__iabCalls)).pop();
    console.log('📄 fichier ouvert avec', last.target, '(jeton présent :', last.url.includes('token='), ')');

    // Les données restent après redémarrage de l'appli
    await page.reload();
    await page.waitForSelector('.bottom-nav');
    console.log('💾 toujours connecté après redémarrage :', (await page.locator('.login-card').count()) === 0);
  } catch (e) {
    console.error('❌', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    web.kill();
    server.close();
  }
})();
