const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const net = require('./net');
const tasks = require('./tasks');
const java = require('./java');
const mc = require('./minecraft');
const loaders = require('./loaders');
const accounts = require('./accounts');
const { readJson, writeJson, settings } = require('./store');

const CONTENT_DIRS = { mods: 'mods', resourcepacks: 'resourcepacks', shaderpacks: 'shaderpacks', datapacks: 'datapacks' };
const running = new Map();

const dirOf = (id) => path.join(paths.instances, id);
const gameDirOf = (id) => path.join(dirOf(id), 'minecraft');
const fileOf = (id) => path.join(dirOf(id), 'instance.json');

function slug(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'instance';
  let id = base;
  for (let i = 2; fs.existsSync(dirOf(id)); i++) id = `${base}-${i}`;
  return id;
}

function iconUrl(id) {
  const file = path.join(dirOf(id), 'icon.png');
  return fs.existsSync(file) ? `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` : null;
}

function get(id) {
  const data = readJson(fileOf(id), null);
  if (!data) return null;
  return { ...data, id, icon: iconUrl(id), running: running.has(id) };
}

function list() {
  return fs
    .readdirSync(paths.instances, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(fileOf(d.name)))
    .map((d) => get(d.name))
    .sort((a, b) => (b.lastPlayed || b.created || 0) - (a.lastPlayed || a.created || 0));
}

function save(id, patch) {
  const current = readJson(fileOf(id), {});
  const next = { ...current, ...patch };
  delete next.icon;
  delete next.running;
  delete next.id;
  writeJson(fileOf(id), next);
  return get(id);
}

async function setIcon(id, source) {
  const dest = path.join(dirOf(id), 'icon.png');
  if (!source) return fs.rmSync(dest, { force: true });
  if (Buffer.isBuffer(source)) return fs.writeFileSync(dest, source);
  if (/^https?:/.test(source)) {
    const res = await net.request(source);
    if (res.ok) fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return;
  }
  await fsp.copyFile(source, dest);
}

// opts: { name, gameVersion, loader, loaderVersion, optifine, icon, group }
async function create(opts) {
  const id = slug(opts.name || opts.gameVersion);
  await fsp.mkdir(gameDirOf(id), { recursive: true });
  writeJson(fileOf(id), {
    name: opts.name || opts.gameVersion,
    gameVersion: opts.gameVersion,
    loader: opts.loader || 'vanilla',
    loaderVersion: opts.loaderVersion || null,
    optifine: opts.optifine || null,
    group: opts.group || '',
    created: Date.now(),
    lastPlayed: 0,
    playtime: 0,
    installed: false,
    source: opts.source || null,
  });
  if (opts.icon) await setIcon(id, opts.icon).catch(() => {});
  return get(id);
}

async function remove(id) {
  if (running.has(id)) throw new Error('Сначала закройте игру');
  await fsp.rm(dirOf(id), { recursive: true, force: true });
}

async function duplicate(id) {
  const src = get(id);
  const copy = slug(`${src.name}-copy`);
  await fsp.cp(dirOf(id), dirOf(copy), { recursive: true });
  return save(copy, { name: `${src.name} (копия)`, created: Date.now(), lastPlayed: 0, playtime: 0 });
}

// Installs loader + game files; returns the version id to launch.
async function ensureInstalled(id, task) {
  const inst = get(id);
  const s = settings.get();
  let versionId = inst.versionId;
  const loaderChanged = inst.installedLoader !== `${inst.loader}:${inst.loaderVersion}:${inst.optifine || ''}`;
  if (!versionId || loaderChanged || !fs.existsSync(mc.versionJsonPath(versionId))) {
    task.update('Установка загрузчика', -1);
    if (inst.loader === 'vanilla' && inst.optifine) {
      versionId = await loaders.installOptiFineStandalone(inst.gameVersion, inst.optifine, task);
    } else {
      versionId = await loaders.installLoader(inst.loader, inst.gameVersion, inst.loaderVersion, task);
    }
    save(id, { versionId, installedLoader: `${inst.loader}:${inst.loaderVersion}:${inst.optifine || ''}` });
  }
  const version = await mc.installVersion(versionId, task, s.concurrency);

  // OptiFine on top of Forge/Fabric lives in the mods folder.
  if (inst.optifine && inst.loader !== 'vanilla') {
    const modsDir = path.join(gameDirOf(id), 'mods');
    const { file, entry } = await loaders.downloadOptiFine(inst.gameVersion, inst.optifine);
    await fsp.mkdir(modsDir, { recursive: true });
    const dest = path.join(modsDir, entry.filename);
    if (!fs.existsSync(dest)) await fsp.copyFile(file, dest);
  }
  save(id, { installed: true });
  return version;
}

// Old log4j configs print XML events; turn them back into plain lines.
function makeLogParser(emit) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    const out = [];
    for (;;) {
      const start = buffer.indexOf('<log4j:Event');
      if (start === -1) {
        const nl = buffer.lastIndexOf('\n');
        if (nl === -1) break;
        out.push(...buffer.slice(0, nl).split(/\r?\n/).filter(Boolean).map((text) => ({ text, level: guessLevel(text) })));
        buffer = buffer.slice(nl + 1);
        break;
      }
      if (start > 0) {
        out.push(...buffer.slice(0, start).split(/\r?\n/).filter((l) => l.trim()).map((text) => ({ text, level: guessLevel(text) })));
        buffer = buffer.slice(start);
        continue;
      }
      const end = buffer.indexOf('</log4j:Event>');
      if (end === -1) break;
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 14);
      const level = /level="(\w+)"/.exec(event)?.[1] || 'INFO';
      const thread = /thread="([^"]*)"/.exec(event)?.[1] || '';
      const time = Number(/timestamp="(\d+)"/.exec(event)?.[1] || Date.now());
      const msg = /<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Message>/.exec(event)?.[1] || '';
      const throwable = /<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]>/.exec(event)?.[1];
      const ts = new Date(time).toTimeString().slice(0, 8);
      out.push({ text: `[${ts}] [${thread}/${level}]: ${msg}`, level });
      if (throwable) out.push(...throwable.split(/\r?\n/).filter(Boolean).map((text) => ({ text, level: 'ERROR' })));
    }
    if (out.length) emit(out);
  };
}

function guessLevel(line) {
  if (/\/(ERROR|FATAL)\]|Exception|^\s+at /.test(line)) return 'ERROR';
  if (/\/WARN\]/.test(line)) return 'WARN';
  return 'INFO';
}

async function launch(id, { accountId, onClose, quickPlay } = {}) {
  if (running.has(id)) throw new Error('Игра уже запущена');
  const inst = get(id);
  const s = settings.get();
  return tasks.run(`Запуск «${inst.name}»`, async (task) => {
    const account = await accounts.prepareForLaunch(accountId || accounts.list().selected);
    const version = await ensureInstalled(id, task);
    task.update('Подготовка Java', -1);
    const javaBin = inst.javaPath || s.javaPath || (await java.ensureRuntime(version.javaVersion, task));
    const gameDir = gameDirOf(id);
    const { args } = await mc.buildLaunch({
      version,
      instance: { ...inst, joinServer: quickPlay || inst.joinServer },
      gameDir,
      account,
      settings: s,
    });

    task.update('Запуск игры', -1);
    const child = spawn(javaBin, args, { cwd: gameDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    const started = Date.now();
    running.set(id, child);
    save(id, { lastPlayed: started });
    tasks.emit('game:state', { id, running: true });
    const emit = (lines) => tasks.emit('game:log', { id, lines });
    emit([{ text: `[WayTester] ${javaBin} (${version.id})`, level: 'INFO' }]);
    const parse = makeLogParser(emit);
    child.stdout.setEncoding('utf8').on('data', parse);
    child.stderr.setEncoding('utf8').on('data', (d) => emit(d.split(/\r?\n/).filter(Boolean).map((text) => ({ text, level: 'ERROR' }))));
    child.on('error', (e) => emit([{ text: `[WayTester] ${e.message}`, level: 'ERROR' }]));
    child.on('close', (code) => {
      running.delete(id);
      const playtime = (readJson(fileOf(id), {}).playtime || 0) + Math.round((Date.now() - started) / 1000);
      save(id, { playtime });
      emit([{ text: `[WayTester] Игра завершилась с кодом ${code}`, level: code === 0 ? 'INFO' : 'ERROR' }]);
      tasks.emit('game:state', { id, running: false, code, crashed: code !== 0 && Date.now() - started > 0 });
      onClose?.(code);
    });
    return { pid: child.pid };
  });
}

function kill(id) {
  const child = running.get(id);
  if (!child) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
  else child.kill('SIGKILL');
}

// ---------- content (mods, resource packs, shaders) ----------

const metaFile = (id) => path.join(dirOf(id), 'content.json');

function readJarInfo(file) {
  try {
    const zip = new AdmZip(file);
    const text = (n) => zip.getEntry(n) && zip.readAsText(n);
    const fabric = text('fabric.mod.json') || text('quilt.mod.json');
    if (fabric) {
      const j = JSON.parse(fabric.replace(/[\u0000-\u001f]+/g, ' '));
      const q = j.quilt_loader?.metadata;
      return { name: j.name || q?.name || j.id, version: j.version || j.quilt_loader?.version, description: j.description || q?.description, authors: j.authors };
    }
    const toml = text('META-INF/neoforge.mods.toml') || text('META-INF/mods.toml');
    if (toml) {
      const pick = (k) => new RegExp(`^\\s*${k}\\s*=\\s*["']{1,3}([^"'\\n]+)`, 'm').exec(toml)?.[1];
      return { name: pick('displayName') || pick('modId'), version: pick('version'), description: pick('description') };
    }
    const mcmod = text('mcmod.info');
    if (mcmod) {
      const j = JSON.parse(mcmod);
      const m = Array.isArray(j) ? j[0] : j.modList?.[0];
      return { name: m?.name, version: m?.version, description: m?.description };
    }
  } catch {}
  return {};
}

async function listContent(id, kind) {
  const dir = path.join(gameDirOf(id), CONTENT_DIRS[kind]);
  const meta = readJson(metaFile(id), {});
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  let dirty = false;
  for (const e of entries) {
    const enabled = !e.name.endsWith('.disabled');
    const base = enabled ? e.name : e.name.slice(0, -9);
    if (kind === 'mods' && !/\.(jar|litemod)$/i.test(base)) continue;
    const full = path.join(dir, e.name);
    const stat = await fsp.stat(full);
    let info = meta[base];
    if (!info || info.size !== stat.size) {
      info = { ...(info?.source ? info : {}), size: stat.size, ...(kind === 'mods' ? readJarInfo(full) : {}) };
      meta[base] = info;
      dirty = true;
    }
    out.push({ file: base, enabled, isDir: e.isDirectory(), ...info });
  }
  if (dirty) writeJson(metaFile(id), meta);
  return out.sort((a, b) => (a.title || a.name || a.file).localeCompare(b.title || b.name || b.file));
}

function recordContent(id, file, info) {
  const meta = readJson(metaFile(id), {});
  meta[file] = { ...(meta[file] || {}), ...info };
  writeJson(metaFile(id), meta);
}

async function toggleContent(id, kind, file, enabled) {
  const dir = path.join(gameDirOf(id), CONTENT_DIRS[kind]);
  const on = path.join(dir, file);
  const off = `${on}.disabled`;
  if (enabled && fs.existsSync(off)) await fsp.rename(off, on);
  if (!enabled && fs.existsSync(on)) await fsp.rename(on, off);
}

async function removeContent(id, kind, file) {
  const dir = path.join(gameDirOf(id), CONTENT_DIRS[kind]);
  await fsp.rm(path.join(dir, file), { recursive: true, force: true });
  await fsp.rm(path.join(dir, `${file}.disabled`), { force: true });
  const meta = readJson(metaFile(id), {});
  delete meta[file];
  writeJson(metaFile(id), meta);
}

async function addContentFiles(id, kind, files) {
  const dir = path.join(gameDirOf(id), CONTENT_DIRS[kind]);
  await fsp.mkdir(dir, { recursive: true });
  for (const f of files) await fsp.cp(f, path.join(dir, path.basename(f)), { recursive: true });
}

// Identifies mods by hash on Modrinth so the list can show icons and check for updates.
async function identifyMods(id) {
  const dir = path.join(gameDirOf(id), 'mods');
  const items = await listContent(id, 'mods');
  const hashes = {};
  for (const item of items) {
    const full = path.join(dir, item.enabled ? item.file : `${item.file}.disabled`);
    hashes[await net.sha1File(full)] = item.file;
  }
  const res = await net.request('https://api.modrinth.com/v2/version_files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: Object.keys(hashes), algorithm: 'sha1' }),
  });
  if (!res.ok) return listContent(id, 'mods');
  const versions = await res.json();
  const projectIds = [...new Set(Object.values(versions).map((v) => v.project_id))];
  const projects = projectIds.length
    ? await net.getJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(projectIds))}`)
    : [];
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  for (const [hash, v] of Object.entries(versions)) {
    const p = byId[v.project_id];
    recordContent(id, hashes[hash], {
      source: 'modrinth',
      projectId: v.project_id,
      versionId: v.id,
      title: p?.title,
      iconUrl: p?.icon_url,
      versionNumber: v.version_number,
      sha1: hash,
    });
  }
  return listContent(id, 'mods');
}

async function checkUpdates(id) {
  const inst = get(id);
  const items = (await listContent(id, 'mods')).filter((m) => m.source === 'modrinth' && m.sha1);
  if (!items.length) return [];
  const loadersFor = { fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge'], neoforge: ['neoforge'] }[inst.loader] || [];
  const res = await net.request('https://api.modrinth.com/v2/version_files/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: items.map((m) => m.sha1), algorithm: 'sha1', loaders: loadersFor, game_versions: [inst.gameVersion] }),
  });
  if (!res.ok) return [];
  const latest = await res.json();
  return items
    .filter((m) => latest[m.sha1] && latest[m.sha1].id !== m.versionId)
    .map((m) => ({ file: m.file, title: m.title, from: m.versionNumber, to: latest[m.sha1].version_number, version: latest[m.sha1] }));
}

async function applyUpdate(id, update) {
  const primary = update.version.files.find((f) => f.primary) || update.version.files[0];
  const dir = path.join(gameDirOf(id), 'mods');
  await net.download({ url: primary.url, path: path.join(dir, primary.filename), sha1: primary.hashes.sha1, size: primary.size });
  if (primary.filename !== update.file) await removeContent(id, 'mods', update.file);
  recordContent(id, primary.filename, {
    source: 'modrinth',
    projectId: update.version.project_id,
    versionId: update.version.id,
    versionNumber: update.version.version_number,
    sha1: primary.hashes.sha1,
    title: update.title,
  });
}

async function listWorlds(id) {
  const dir = path.join(gameDirOf(id), 'saves');
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const worlds = [];
  for (const e of entries.filter((x) => x.isDirectory())) {
    const icon = path.join(dir, e.name, 'icon.png');
    const stat = await fsp.stat(path.join(dir, e.name));
    worlds.push({
      name: e.name,
      modified: stat.mtimeMs,
      icon: fs.existsSync(icon) ? `data:image/png;base64,${fs.readFileSync(icon).toString('base64')}` : null,
    });
  }
  return worlds.sort((a, b) => b.modified - a.modified);
}

// Packs an instance as .mrpack-like zip so it can be shared with other launchers.
async function exportInstance(id, dest) {
  const inst = get(id);
  const zip = new AdmZip();
  const deps = { minecraft: inst.gameVersion };
  const loaderKey = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }[inst.loader];
  if (loaderKey) deps[loaderKey] = inst.loaderVersion;
  zip.addFile(
    'modrinth.index.json',
    Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '1.0.0', name: inst.name, files: [], dependencies: deps }, null, 2)),
  );
  for (const sub of ['mods', 'config', 'resourcepacks', 'shaderpacks', 'options.txt', 'servers.dat', 'kubejs', 'defaultconfigs']) {
    const full = path.join(gameDirOf(id), sub);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) zip.addLocalFolder(full, `overrides/${sub}`);
    else zip.addLocalFile(full, 'overrides');
  }
  zip.writeZip(dest);
}

module.exports = {
  list,
  get,
  save,
  create,
  remove,
  duplicate,
  setIcon,
  launch,
  kill,
  ensureInstalled,
  listContent,
  recordContent,
  toggleContent,
  removeContent,
  addContentFiles,
  identifyMods,
  checkUpdates,
  applyUpdate,
  listWorlds,
  exportInstance,
  dirOf,
  gameDirOf,
  CONTENT_DIRS,
  isRunning: (id) => running.has(id),
  newId: () => crypto.randomUUID(),
};
