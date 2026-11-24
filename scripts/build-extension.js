'use strict';
/**
 * Construit l'extension Chrome dans dist-extension/ (à charger via chrome://extensions → « Charger l'extension non empaquetée »).
 * Même interface et même logique que la web-app : on part de la construction web, puis on ajoute
 * le manifeste, la tâche de fond et les icônes de l'extension.
 *   node scripts/build-extension.js          (EXT_DEV=1 : autorise aussi http://127.0.0.1 pour les tests)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const web = path.join(root, 'dist-web');
const out = path.join(root, 'dist-extension');

execFileSync(process.execPath, [path.join(__dirname, 'build-web.js')], { env: { ...process.env, EXTENSION: '1' }, stdio: 'inherit' });
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(web, out, { recursive: true });

// Fichiers propres à la web-app publique, inutiles dans l'extension
for (const f of ['sw.js', 'manifest.webmanifest', '.nojekyll', 'apple-touch-icon.png', 'icon-maskable.png']) fs.rmSync(path.join(out, f), { force: true });
// La page de l'extension : pas de balise CSP (Chrome applique déjà la sienne, stricte) ni de manifeste web
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
  .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace('href="icon-192.png"', 'href="icons/icon-32.png"');
fs.writeFileSync(path.join(out, 'app.html'), html);
fs.rmSync(path.join(out, 'index.html'));

fs.cpSync(path.join(root, 'extension', 'icons'), path.join(out, 'icons'), { recursive: true });
fs.copyFileSync(path.join(root, 'extension', 'background.js'), path.join(out, 'background.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
manifest.version = require(path.join(root, 'package.json')).version;
if (process.env.EXT_DEV) manifest.host_permissions.push('http://127.0.0.1/*', 'http://localhost/*');
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Extension construite dans', path.relative(root, out));
