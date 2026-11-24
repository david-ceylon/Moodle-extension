// Remplaçants minimaux pour le moteur JavaScript d'arrière-plan d'Android (QuickJS),
// qui ne fournit ni URLSearchParams ni URL. Seul ce dont MoodleClient a besoin est implémenté.
if (typeof globalThis.URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = function URLSearchParams() { this._p = []; };
  globalThis.URLSearchParams.prototype.append = function (k, v) { this._p.push([String(k), String(v)]); };
  globalThis.URLSearchParams.prototype.toString = function () {
    return this._p.map(function (kv) { return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1]); }).join('&');
  };
}
