const { app, BrowserWindow, ipcMain, protocol, net: electronNet, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const paths = require('./paths');
const tasks = require('./tasks');

// Keep Chromium's caches out of the launcher's own data folder.
app.setPath('userData', path.join(paths.root, 'electron'));
app.setName('WayTester');
const { settings } = require('./store');
const java = require('./java');
const mc = require('./minecraft');
const loaders = require('./loaders');
const instances = require('./instances');
const accounts = require('./accounts');
const skins = require('./skins');
const platforms = require('./platforms');
const modpacks = require('./modpacks');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
// Only these vendor folders are reachable from the page.
const VENDOR = {
  'vendor/skinview3d/': path.join(ROOT, 'node_modules', 'skinview3d', 'bundles'),
  'vendor/symbols/': path.join(ROOT, 'node_modules', 'material-symbols'),
  'vendor/roboto-flex/': path.join(ROOT, 'node_modules', '@fontsource-variable', 'roboto-flex'),
};

let win = null;

function resolveAppUrl(url) {
  const { pathname } = new URL(url);
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  for (const [prefix, dir] of Object.entries(VENDOR)) {
    if (rel.startsWith(prefix)) return path.join(dir, rel.slice(prefix.length));
  }
  return path.join(RENDERER, rel);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#0d1017',
    title: 'WayTester',
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL('app://render/index.html');
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('window:state', { maximized: true }));
  win.on('unmaximize', () => send('window:state', { maximized: false }));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

tasks.setBroadcaster(send);

// ---------- IPC ----------

const handlers = {
  'window:minimize': () => win.minimize(),
  'window:maximize': () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  'window:close': () => win.close(),
  'app:info': () => ({ platform: process.platform, arch: process.arch, version: app.getVersion(), dataDir: paths.root }),
  'app:openExternal': (url) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  },
  'app:openDataDir': () => shell.openPath(paths.root),

  'settings:get': () => settings.get(),
  'settings:set': (patch) => settings.set(patch),
  'settings:pickWallpaper': async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (r.canceled) return null;
    const ext = path.extname(r.filePaths[0]);
    const dest = path.join(paths.root, `wallpaper${ext}`);
    fs.copyFileSync(r.filePaths[0], dest);
    const data = `data:image/${ext.slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(dest).toString('base64')}`;
    settings.set({ wallpaper: dest });
    return data;
  },
  'settings:wallpaperData': () => {
    const file = settings.get().wallpaper;
    if (!file || !fs.existsSync(file)) return null;
    const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
  },
  'java:detect': () => java.detect(),
  'java:pick': async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Выберите java' });
    return r.canceled ? null : r.filePaths[0];
  },

  'versions:list': async () => (await mc.getManifest()).versions.map(({ id, type, releaseTime }) => ({ id, type, releaseTime })),
  'versions:loader': (loader, gameVersion) => loaders.listLoader(loader, gameVersion),
  'versions:loaderGames': (loader) => loaders.supportedGameVersions(loader),

  'instances:list': () => instances.list(),
  'instances:get': (id) => instances.get(id),
  'instances:create': (opts) => instances.create(opts),
  'instances:save': (id, patch) => instances.save(id, patch),
  'instances:remove': (id) => instances.remove(id),
  'instances:duplicate': (id) => instances.duplicate(id),
  'instances:pickIcon': async (id) => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!r.canceled) await instances.setIcon(id, r.filePaths[0]);
    return instances.get(id);
  },
  'instances:install': (id) => tasks.run(`Установка «${instances.get(id).name}»`, (t) => instances.ensureInstalled(id, t)).then(() => instances.get(id)),
  'instances:launch': async (id, opts = {}) => {
    const s = settings.get();
    const result = await instances.launch(id, {
      ...opts,
      onClose: () => {
        if (s.closeOnLaunch && win && !win.isDestroyed()) win.show();
      },
    });
    if (s.closeOnLaunch) win.hide();
    return result;
  },
  'instances:kill': (id) => instances.kill(id),
  'instances:openFolder': (id, sub) => {
    const dir = path.join(instances.gameDirOf(id), sub || '');
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  },
  'instances:content': (id, kind) => instances.listContent(id, kind),
  'instances:toggleContent': (id, kind, file, enabled) => instances.toggleContent(id, kind, file, enabled),
  'instances:removeContent': (id, kind, file) => instances.removeContent(id, kind, file),
  'instances:addContent': async (id, kind) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (!r.canceled) await instances.addContentFiles(id, kind, r.filePaths);
    return instances.listContent(id, kind);
  },
  'instances:dropContent': (id, kind, files) => instances.addContentFiles(id, kind, files),
  'instances:identify': (id) => instances.identifyMods(id),
  'instances:checkUpdates': (id) => instances.checkUpdates(id),
  'instances:applyUpdates': (id, updates) =>
    tasks.run('Обновление модов', async (t) => {
      for (const [i, u] of updates.entries()) {
        t.update(`${u.title || u.file}`, i / updates.length);
        await instances.applyUpdate(id, u);
      }
    }),
  'instances:worlds': (id) => instances.listWorlds(id),
  'instances:export': async (id) => {
    const inst = instances.get(id);
    const r = await dialog.showSaveDialog(win, { defaultPath: `${inst.name}.mrpack`, filters: [{ name: 'Modrinth pack', extensions: ['mrpack'] }] });
    if (r.canceled) return false;
    await tasks.run(`Экспорт «${inst.name}»`, () => instances.exportInstance(id, r.filePath));
    return true;
  },

  'accounts:list': () => accounts.list(),
  'accounts:select': (id) => accounts.select(id),
  'accounts:remove': (id) => accounts.remove(id),
  'accounts:msStart': () => accounts.msStartLogin(),
  'accounts:msWait': (loginId) => accounts.msWaitForLogin(loginId),
  'accounts:msCancel': (loginId) => accounts.msCancel(loginId),

  'skins:list': () => skins.list(),
  'skins:addFile': async (variant) => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Скин', extensions: ['png'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    return r.filePaths.map((f) => skins.addFile(f, variant));
  },
  'skins:addPath': (file, variant) => {
    if (!/\.png$/i.test(file)) throw new Error('Нужен PNG-файл');
    return skins.addFile(file, variant);
  },
  'skins:importName': (name) => skins.importByName(name),
  'skins:default': () => skins.defaultSkin(),
  'skins:update': (id, patch) => skins.update(id, patch),
  'skins:remove': (id) => skins.remove(id),
  'skins:current': (accountId) => skins.current(accountId),
  'skins:apply': (accountId, skinId) => skins.apply(accountId, skinId),
  'skins:setCape': (accountId, capeId) => skins.setCape(accountId, capeId),

  'content:search': (opts) => platforms.search(opts),
  'content:project': (platform, id) => platforms.project(platform, id),
  'content:versions': (platform, id, opts) => platforms.versions(platform, id, opts),
  'content:install': (instanceId, item) =>
    tasks.run(`Установка «${item.title || item.projectId}»`, (t) => platforms.install(instanceId, item, t)),
  'content:installPack': (platform, projectId, versionId, title) =>
    tasks.run(`Сборка «${title || projectId}»`, (t) =>
      platform === 'curseforge' ? modpacks.installCurseForgePack(projectId, versionId, t) : modpacks.installModrinthPack(projectId, versionId, t),
    ),

  'import:scan': () => modpacks.scan(),
  'import:folder': (info) => tasks.run(`Импорт «${info.name}»`, (t) => modpacks.importFolder(info, t)),
  'import:path': (p, overrides) => tasks.run(`Импорт ${path.basename(p)}`, (t) => modpacks.importPath(p, t, overrides)),
  'import:pick': async (kind) => {
    const r = await dialog.showOpenDialog(
      win,
      kind === 'folder'
        ? { properties: ['openDirectory'], title: 'Папка сборки' }
        : { properties: ['openFile'], filters: [{ name: 'Сборки', extensions: ['mrpack', 'zip'] }] },
    );
    return r.canceled ? null : r.filePaths[0];
  },
};

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message || String(e), code: e.code };
    }
  });
}

// ---------- lifecycle ----------

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const file = resolveAppUrl(req.url);
    const allowed = [RENDERER, ...Object.values(VENDOR)].some((d) => file.startsWith(d));
    if (!allowed) return new Response('Forbidden', { status: 403 });
    return electronNet.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
