const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['task:update', 'game:log', 'game:state', 'window:state']);

contextBridge.exposeInMainWorld('render', {
  platform: process.platform,
  async invoke(channel, ...args) {
    const res = await ipcRenderer.invoke(channel, ...args);
    if (!res.ok) {
      const err = new Error(res.error);
      err.code = res.code;
      throw err;
    }
    return res.value;
  },
  on(event, cb) {
    if (!EVENTS.has(event)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  // Real paths of files dropped onto the window.
  pathForFile: (file) => webUtils.getPathForFile(file),
});
