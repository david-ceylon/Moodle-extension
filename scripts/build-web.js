'use strict';
/**
 * Construit la web-app téléphone dans dist-web/ (publiée ensuite par GitHub Pages).
 * Elle réutilise exactement la même interface et la même logique que l'application de bureau.
 *   node scripts/build-web.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-web');
const build = Date.now().toString(36);
// NATIVE=1 : version embarquée dans l'appli Android (Capacitor injecte ses propres scripts,
// incompatibles avec la politique de sécurité stricte de la version web).
const NATIVE = !!process.env.NATIVE;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
fs.mkdirSync(path.join(out, 'shared'), { recursive: true });

const copy = (from, to) => fs.copyFileSync(path.join(root, from), path.join(out, to));
const write = (to, text) => fs.writeFileSync(path.join(out, to), text);

// Modules partagés avec l'ordinateur, isolés dans une fonction pour ne pas polluer la page
for (const f of ['moodle-client', 'sync', 'demo']) {
  const src = fs.readFileSync(path.join(root, 'src/main', f + '.js'), 'utf8');
  write(`shared/${f}.js`, `(function () {\n${src}\n})();\n`);
}

copy('node_modules/htm/preact/standalone.module.js', 'vendor/htm-preact.js');
copy('src/renderer/styles.css', 'styles.css');
copy('src/renderer/web-bridge.js', 'web-bridge.js');
write('app.js', fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8').replace('../../node_modules/htm/preact/standalone.module.js', './vendor/htm-preact.js'));
for (const f of fs.readdirSync(path.join(root, 'src/web'))) {
  if (f === 'sw.js') write(f, fs.readFileSync(path.join(root, 'src/web', f), 'utf8').replace('__BUILD__', build));
  else copy(`src/web/${f}`, f);
}

write('index.html', `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
${NATIVE ? '' : `  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:${process.env.WEB_DEV ? ' http:' : ''}" />\n`}  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="referrer" content="no-referrer" />
  <meta name="theme-color" content="#5b5bf0" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="Moodle+" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="icon" href="icon-192.png" />
  <link rel="apple-touch-icon" href="apple-touch-icon.png" />
  <title>Moodle+</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div id="app"></div>
  <script src="shared/moodle-client.js"></script>
  <script src="shared/sync.js"></script>
  <script src="shared/demo.js"></script>
  <script src="web-bridge.js"></script>
  <script type="module" src="app.js"></script>
</body>
</html>
`);
write('.nojekyll', '');
console.log('Web-app construite dans', path.relative(root, out));
