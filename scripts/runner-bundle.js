'use strict';
// Assemble le fichier de la tâche d'arrière-plan Android : remplaçants + logique partagée + tâche.
const fs = require('fs');
const path = require('path');

function bundleRunner(root = path.join(__dirname, '..')) {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  return [
    read('src/runner/polyfills.js'),
    ...['moodle-client', 'sync'].map((f) => `(function () {\n${read(`src/main/${f}.js`)}\n})();`),
    read('src/runner/background.js'),
  ].join('\n\n');
}

module.exports = { bundleRunner };
