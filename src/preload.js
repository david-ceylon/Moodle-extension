'use strict';
// Pont sécurisé entre l'interface (renderer) et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('moodle', {
  platform: 'desktop',
  getState: () => invoke('state:get'),
  checkSite: (url) => invoke('auth:checkSite', url),
  login: (site) => invoke('auth:login', site),
  startDemo: () => invoke('demo:start'),
  logout: (opts) => invoke('auth:logout', opts),
  sync: () => invoke('sync:run'),
  markRead: (ids) => invoke('feed:markRead', ids),
  markUnread: (id) => invoke('feed:markUnread', id),
  openFile: (file) => invoke('file:open', file),
  saveFile: (file) => invoke('file:save', file),
  saveMany: (payload) => invoke('files:saveMany', payload),
  openInMoodle: (url) => invoke('moodle:open', url),
  openExternal: (url) => invoke('external:open', url),
  setSettings: (patch) => invoke('settings:set', patch),
  phonePairing: () => invoke('phone:pairing'),
  copy: (text) => invoke('clipboard:write', text),
  on: (channel, cb) => {
    const allowed = ['state', 'sync:progress', 'auth:expired', 'navigate'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
