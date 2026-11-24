'use strict';
/**
 * Test de l'extension Chrome réelle : chargée dans Chromium, connexion au faux Moodle par la fenêtre
 * de connexion (mot de passe + 2FA), capture du jeton, compteur sur l'icône, synchro de fond et notifications.
 *   EXT_DEV=1 node scripts/build-extension.js && xvfb-run -a node test/e2e-extension.js [dossier-captures]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const mock = require('./mock-moodle-server');

(async () => {
  const outDir = process.argv[2] || path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const ext = path.join(__dirname, '..', 'dist-extension');
  const server = await mock.start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-ext-')), {
    headless: false,
    viewport: { width: 1360, height: 880 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;
    console.log('🧩 extension chargée, identifiant :', extId);
    // À l'installation, l'extension ouvre elle-même son onglet
    let page = context.pages().find((p) => p.url().includes('app.html'));
    if (!page) page = await context.waitForEvent('page', { predicate: (p) => p.url().includes('app.html'), timeout: 10000 }).catch(() => null);
    if (!page) { page = await context.newPage(); await page.goto(`chrome-extension://${extId}/app.html`); }
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.waitForSelector('.login-card input');
    console.log('🏫 site pré-rempli :', await page.inputValue('.login-card input'));
    await page.screenshot({ path: path.join(outDir, '40-extension-connexion.png') });

    await page.fill('.login-card input', origin);
    await page.click('text=Continuer');
    await page.waitForSelector('text=Moodle Test (faux serveur)');
    const popupPromise = context.waitForEvent('page');
    await page.click('button:has-text("Se connecter")');
    const login = await popupPromise;
    if (process.env.DEBUG) {
      login.on('framenavigated', (f) => f === login.mainFrame() && console.log('  popup →', f.url().slice(0, 100)));
      login.on('close', () => console.log('  popup fermée'));
      page.on('console', (m) => console.log('  console:', m.text()));
    }
    await login.waitForSelector('input[name=username]');
    await login.fill('input[name=username]', 'etudiant');
    await login.fill('input[name=password]', 'secret');
    await login.click('button');
    await login.waitForSelector('input[name=code]');
    await login.fill('input[name=code]', '123456');
    await login.click('button');

    await page.waitForSelector('.feed-item', { timeout: 15000 }).catch(async (e) => {
      await page.screenshot({ path: path.join(outDir, 'debug-ext.png') });
      if (!login.isClosed()) await login.screenshot({ path: path.join(outDir, 'debug-ext-popup.png') });
      throw e;
    });
    console.log('✅ connecté depuis l’extension :', await page.locator('.feed-item').count(), 'nouveautés — fenêtre de connexion fermée :', login.isClosed());
    await page.waitForTimeout(500);
    console.log('🔢 compteur sur l’icône :', await sw.evaluate(() => chrome.action.getBadgeText({})));
    console.log('⏰ vérification programmée :', JSON.stringify(await sw.evaluate(async () => (await chrome.alarms.getAll()).map((a) => [a.name, a.periodInMinutes]))));
    await page.screenshot({ path: path.join(outDir, '41-extension-nouveautes.png') });

    // Synchro de fond (onglet ouvert ou non) : un enseignant publie, la tâche de fond le voit et notifie
    await fetch(origin + '/__publish');
    const res = await sw.evaluate(() => check());
    const notifs = await sw.evaluate(() => new Promise((r) => chrome.notifications.getAll(r)));
    console.log('🔔 tâche de fond :', JSON.stringify(res), '— notifications affichées :', Object.keys(notifs).join(', '));
    await page.waitForTimeout(500);
    console.log('🔄 l’onglet s’est rafraîchi tout seul :', (await page.locator('.feed-item.unread').count()) > 0, '— compteur :', await sw.evaluate(() => chrome.action.getBadgeText({})));

    // Tout marquer comme lu → compteur vidé
    await page.click('text=Tout marquer comme lu');
    await page.waitForTimeout(300);
    console.log('✔️  après « tout lu », compteur :', JSON.stringify(await sw.evaluate(() => chrome.action.getBadgeText({}))));

    // Téléchargement groupé via Chrome
    await page.evaluate(async () => {
      const st = await window.moodle.getState();
      const folder = st.data.courses[0].sections[1].modules.find((m) => m.modname === 'folder');
      await window.moodle.saveMany({ files: folder.files, folderName: 'INF301 TD 1' });
    });
    await page.waitForTimeout(1500);
    const dls = await sw.evaluate(() => new Promise((r) => chrome.downloads.search({}, r)));
    console.log('⬇️  téléchargements :', dls.map((d) => path.basename(d.filename) + ' (' + d.state + ')').join(', '));

    // Hébreu
    await page.click('.user-card button');
    await page.click('.modal .lang-switch button[lang=he]');
    await page.click('.modal button[title]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '42-extension-hebreu.png') });
    console.log('🌍 hébreu dans l’extension :', await page.evaluate(() => document.documentElement.dir), '—', await page.locator('.topbar h1').innerText());
  } catch (e) {
    console.error('❌', e);
    process.exitCode = 1;
  } finally {
    await context.close();
    server.close();
  }
})();
