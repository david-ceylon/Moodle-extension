'use strict';
/**
 * Test du parcours téléphone : connexion sur l'ordinateur (2FA) → QR code de jumelage
 * → ouverture du lien dans un navigateur de téléphone (émulation iPhone) → cours affichés.
 *   WEB_DEV=1 node scripts/build-web.js && xvfb-run -a node test/e2e-phone.js [dossier-captures]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { _electron: electron, chromium, devices } = require('playwright');
const mock = require('./mock-moodle-server');

(async () => {
  const outDir = process.argv[2] || path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const server = await mock.start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const web = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'serve-web.js'), '5199'], { stdio: 'inherit' });
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, '..'), '--no-sandbox'],
    env: { ...process.env, MOODLEPLUS_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'moodleplus-')) },
  });
  let browser;
  try {
    // 1. Connexion sur l'ordinateur
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1360, height: 880 });
    await win.fill('.login-card input', origin);
    await win.click('text=Continuer');
    const popupPromise = app.waitForEvent('window');
    await win.click('button:has-text("Se connecter")');
    const login = await popupPromise;
    await login.fill('input[name=username]', 'etudiant');
    await login.fill('input[name=password]', 'secret');
    await login.click('button');
    await login.fill('input[name=code]', '123456');
    await login.click('button');
    await win.waitForSelector('.feed-item', { timeout: 30000 });

    // 2. QR code de jumelage
    await win.click('button[title="Réglages"]');
    await win.click('text=Connecter mon téléphone');
    await win.waitForSelector('img.qr');
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(outDir, '20-qr-code.png') });
    const { link } = await win.evaluate(() => window.moodle.phonePairing());
    console.log('🔗 lien de jumelage :', link.slice(0, 60) + '…');
    const phoneLink = link.replace(/^[^#]+/, 'http://localhost:5199/');

    // 3. Le téléphone ouvre le lien
    browser = await chromium.launch();
    const phone = await browser.newPage({ ...devices['iPhone 13'] });
    phone.on('pageerror', (e) => console.error('page error:', e.message));
    await phone.goto('http://localhost:5199/');
    await phone.waitForSelector('.login-card');
    await phone.screenshot({ path: path.join(outDir, '21-tel-accueil.png') });
    await phone.goto(phoneLink);
    await phone.waitForSelector('.feed-item', { timeout: 30000 });
    console.log('📱 téléphone connecté, URL nettoyée :', !phone.url().includes('pair='), '—', await phone.locator('.feed-item').count(), 'nouveautés');
    await phone.waitForTimeout(400);
    await phone.screenshot({ path: path.join(outDir, '22-tel-nouveautes.png') });
    await phone.click('.bottom-nav button:has-text("Échéances")');
    await phone.waitForTimeout(300);
    await phone.screenshot({ path: path.join(outDir, '23-tel-echeances.png') });
    await phone.click('.bottom-nav button:has-text("Cours")');
    await phone.click('.course-card >> nth=0');
    await phone.waitForTimeout(400);
    await phone.screenshot({ path: path.join(outDir, '24-tel-cours.png') });

    // 4. Rechargement : les données sont restées sur le téléphone
    await phone.reload();
    await phone.waitForSelector('.bottom-nav');
    console.log('💾 après rechargement, toujours connecté :', (await phone.locator('.login-card').count()) === 0);
  } catch (e) {
    console.error('❌', e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await app.close();
    web.kill();
    server.close();
  }
})();
