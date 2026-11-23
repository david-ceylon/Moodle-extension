'use strict';
/**
 * Test de bout en bout : lance la vraie application Electron, se connecte au faux Moodle
 * en passant par la fenêtre de connexion + 2FA, puis fait des captures d'écran.
 *   xvfb-run -a node test/e2e.js [dossier-captures]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const mock = require('./mock-moodle-server');

(async () => {
  const outDir = process.argv[2] || path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const server = await mock.start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'moodleplus-'));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, '..'), '--no-sandbox'],
    env: { ...process.env, MOODLEPLUS_USER_DATA: userData },
  });
  const shot = async (page, name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, name + '.png') });
    console.log('📸', name);
  };
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1360, height: 880 });
    await win.waitForSelector('.login-card');
    await shot(win, '01-connexion');

    await win.fill('.login-card input', origin);
    await win.click('text=Continuer');
    await win.waitForSelector('text=Moodle Test (faux serveur)');

    const popupPromise = app.waitForEvent('window');
    await win.click('button:has-text("Se connecter")');
    const login = await popupPromise;
    await login.waitForSelector('input[name=username]');
    await shot(win, '02-attente-2fa');
    await login.fill('input[name=username]', 'etudiant');
    await login.fill('input[name=password]', 'secret');
    await login.click('button');
    await login.waitForSelector('input[name=code]');
    await login.fill('input[name=code]', '123456');
    await login.click('button');

    await win.waitForSelector('.feed-item', { timeout: 30000 });
    console.log('✅ connecté, fil chargé :', await win.locator('.feed-item').count(), 'éléments');
    await shot(win, '03-nouveautes');

    await win.click('.nav-item:has-text("Échéances")');
    await shot(win, '04-echeances');
    await win.click('.nav-item:has-text("Mes cours")');
    await shot(win, '05-cours');
    await win.click('.course-card >> nth=0');
    await shot(win, '06-cours-detail');
    await win.click('.tab:has-text("Fichiers")');
    await shot(win, '07-cours-fichiers');
    await win.click('.nav-item:has-text("Tous les fichiers")');
    await shot(win, '08-tous-fichiers');
    await win.keyboard.press('Control+K');
    await win.waitForSelector('.palette input:focus');
    await win.keyboard.type('corrige td2');
    await win.waitForSelector('.result');
    await shot(win, '09-recherche');
    await win.keyboard.press('Escape');

    // Nouvelle synchro : le faux Moodle « publie » un nouveau dossier
    await win.click('.nav-item:has-text("Nouveautés")');
    await win.click('text=Tout marquer comme lu');
    await fetch(origin + '/__publish');
    await win.click('button[title="Synchroniser maintenant"]');
    await win.waitForSelector('.toast');
    console.log('🔄', await win.locator('.toast').first().innerText());
    await shot(win, '10-apres-synchro');

    // Téléchargement d'un vrai fichier (via le jeton) dans le cache local
    await win.evaluate(async () => {
      const st = await window.moodle.getState();
      const f = st.data.courses[0].sections[1].modules[0].files[0];
      try { await window.moodle.openFile({ url: f.url, name: f.name }); } catch (e) { /* pas de lecteur PDF dans le conteneur */ }
    });
    const cached = fs.readdirSync(path.join(userData, 'fichiers')).flatMap((d) => fs.readdirSync(path.join(userData, 'fichiers', d)));
    console.log('⬇️  fichier téléchargé :', cached.join(', '));
    await win.click('.nav-item:has-text("Mes cours")');
    await win.click('button[title="Réglages"]');
    await shot(win, '11-reglages');
    const files = fs.readdirSync(userData);
    console.log('📁 userData :', files.join(', '));
    const store = JSON.parse(fs.readFileSync(path.join(userData, 'moodle-plus.json'), 'utf8'));
    console.log('🔐 jeton stocké chiffré :', store.token?.enc, '— valeur en clair absente :', !JSON.stringify(store).includes(server.TOKEN));
  } catch (e) {
    console.error('❌', e);
    process.exitCode = 1;
  } finally {
    await app.close();
    server.close();
  }
})();
