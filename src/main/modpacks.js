const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const net = require('./net');
const instances = require('./instances');
const platforms = require('./platforms');
const { readJson, settings } = require('./store');

// Rejects archive paths that would escape the target folder ("zip slip").
function safeJoin(base, rel) {
  const target = path.resolve(base, rel);
  if (!target.startsWith(path.resolve(base) + path.sep)) throw new Error(`Небезопасный путь в архиве: ${rel}`);
  return target;
}

function extractPrefix(zip, prefix, dest) {
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const rel = entry.entryName.slice(prefix.length);
    if (!rel) continue;
    const target = safeJoin(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }
}

function loaderFromDeps(deps) {
  for (const [key, loader] of [
    ['neoforge', 'neoforge'],
    ['forge', 'forge'],
    ['quilt-loader', 'quilt'],
    ['fabric-loader', 'fabric'],
  ]) {
    if (deps[key]) return { loader, loaderVersion: deps[key] };
  }
  return { loader: 'vanilla', loaderVersion: null };
}

// ---------- .mrpack ----------

async function installMrpack(file, task, extra = {}) {
  const zip = new AdmZip(file);
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  const { loader, loaderVersion } = loaderFromDeps(index.dependencies);
  const inst = await instances.create({
    name: extra.name || index.name,
    gameVersion: index.dependencies.minecraft,
    loader,
    loaderVersion,
    icon: extra.icon,
    source: extra.source || { platform: 'modrinth', packVersion: index.versionId },
  });
  const gameDir = instances.gameDirOf(inst.id);
  const files = index.files
    .filter((f) => f.env?.client !== 'unsupported')
    .map((f) => ({ url: f.downloads[0], path: safeJoin(gameDir, f.path), sha1: f.hashes.sha1, size: f.fileSize }));
  await net.downloadAll(files, {
    concurrency: settings.get().concurrency,
    onProgress: (d, t) => task?.update(`Моды сборки: ${d}/${t}`, t ? d / t : 1),
  });
  task?.update('Распаковка настроек', -1);
  extractPrefix(zip, 'overrides/', gameDir);
  extractPrefix(zip, 'client-overrides/', gameDir);
  await instances.identifyMods(inst.id).catch(() => {});
  return instances.get(inst.id);
}

async function installModrinthPack(projectId, versionId, task) {
  const project = await platforms.project('modrinth', projectId);
  const version = versionId
    ? platforms.mrMapVersion(await net.getJson(`https://api.modrinth.com/v2/version/${versionId}`))
    : (await platforms.versions('modrinth', projectId))[0];
  task?.update(`Скачивание ${version.file.filename}`, -1);
  const file = path.join(paths.cache, 'packs', version.file.filename);
  await net.download({ url: version.file.url, path: file, sha1: version.file.sha1, size: version.file.size });
  return installMrpack(file, task, {
    name: project.title,
    icon: project.icon,
    source: { platform: 'modrinth', projectId, versionId: version.id, versionNumber: version.number },
  });
}

// ---------- CurseForge zip ----------

function parseCfLoader(id) {
  const [type, ...rest] = id.split('-');
  const loader = { forge: 'forge', neoforge: 'neoforge', fabric: 'fabric', quilt: 'quilt' }[type.toLowerCase()] || 'vanilla';
  let version = rest.join('-');
  if (loader === 'fabric' || loader === 'quilt') version = rest[0];
  if (loader === 'neoforge' && version.startsWith('1.20.1-')) version = version.slice(7);
  return { loader, loaderVersion: loader === 'vanilla' ? null : version };
}

async function installCurseForgeZip(file, task, extra = {}) {
  const zip = new AdmZip(file);
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  const primary = manifest.minecraft.modLoaders?.find((l) => l.primary) || manifest.minecraft.modLoaders?.[0];
  const { loader, loaderVersion } = primary ? parseCfLoader(primary.id) : { loader: 'vanilla', loaderVersion: null };
  const inst = await instances.create({
    name: extra.name || manifest.name,
    gameVersion: manifest.minecraft.version,
    loader,
    loaderVersion,
    icon: extra.icon,
    source: extra.source || { platform: 'curseforge', packVersion: manifest.version },
  });
  const gameDir = instances.gameDirOf(inst.id);

  const wanted = manifest.files.filter((f) => f.required !== false);
  task?.update('Получение списка модов', -1);
  const fileInfos = [];
  for (let i = 0; i < wanted.length; i += 500) {
    const chunk = wanted.slice(i, i + 500);
    const res = await platforms.cf('/mods/files', { method: 'POST', body: JSON.stringify({ fileIds: chunk.map((f) => f.fileID) }) });
    fileInfos.push(...res.data);
  }
  const modIds = [...new Set(fileInfos.map((f) => f.modId))];
  const mods = [];
  for (let i = 0; i < modIds.length; i += 500) {
    const res = await platforms.cf('/mods', { method: 'POST', body: JSON.stringify({ modIds: modIds.slice(i, i + 500) }) });
    mods.push(...res.data);
  }
  const classOf = Object.fromEntries(mods.map((m) => [m.id, m.classId]));
  const nameOf = Object.fromEntries(mods.map((m) => [m.id, { title: m.name, icon: m.logo?.thumbnailUrl }]));

  const tasks = fileInfos.map((f) => {
    const dir = platforms.CF_CLASS_DIR[classOf[f.modId]] || 'mods';
    return {
      url: platforms.cfCdnUrl(f),
      path: safeJoin(gameDir, path.join(dir, f.fileName)),
      sha1: f.hashes?.find((h) => h.algo === 1)?.value,
      size: f.fileLength,
      meta: { file: f.fileName, info: { source: 'curseforge', projectId: String(f.modId), versionId: String(f.id), versionNumber: f.displayName, title: nameOf[f.modId]?.title, iconUrl: nameOf[f.modId]?.icon } },
    };
  });
  await net.downloadAll(tasks, {
    concurrency: settings.get().concurrency,
    onProgress: (d, t) => task?.update(`Моды сборки: ${d}/${t}`, t ? d / t : 1),
  });
  for (const t of tasks) instances.recordContent(inst.id, t.meta.file, t.meta.info);
  task?.update('Распаковка настроек', -1);
  extractPrefix(zip, `${manifest.overrides || 'overrides'}/`, gameDir);
  return instances.get(inst.id);
}

async function installCurseForgePack(projectId, fileId, task) {
  const project = await platforms.project('curseforge', projectId);
  const version = fileId
    ? (await platforms.versions('curseforge', projectId)).find((v) => v.id === String(fileId))
    : (await platforms.versions('curseforge', projectId))[0];
  if (!version) throw new Error('Файл сборки не найден');
  const file = path.join(paths.cache, 'packs', version.file.filename);
  task?.update(`Скачивание ${version.file.filename}`, -1);
  await net.download({ url: version.file.url, path: file, size: version.file.size });
  return installCurseForgeZip(file, task, {
    name: project.title,
    icon: project.icon,
    source: { platform: 'curseforge', projectId, versionId: version.id, versionNumber: version.number },
  });
}

// ---------- import from other launchers ----------

function readIni(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([^=#\[]+)=(.*)$/.exec(line);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function firstExisting(...candidates) {
  return candidates.find((c) => c && fs.existsSync(c));
}

// Works out what kind of instance a folder is. Returns null when it doesn't look like one.
function describeFolder(dir) {
  const cfg = path.join(dir, 'instance.cfg');
  const pack = path.join(dir, 'mmc-pack.json');
  if (fs.existsSync(cfg)) {
    const ini = readIni(cfg);
    const components = readJson(pack, { components: [] }).components;
    const ver = (uid) => components.find((c) => c.uid === uid)?.version;
    let loader = 'vanilla';
    let loaderVersion = null;
    for (const [uid, l] of [
      ['net.neoforged', 'neoforge'],
      ['net.minecraftforge', 'forge'],
      ['org.quiltmc.quilt-loader', 'quilt'],
      ['net.fabricmc.fabric-loader', 'fabric'],
    ]) {
      if (ver(uid)) {
        loader = l;
        loaderVersion = ver(uid);
        break;
      }
    }
    const iconKey = ini.iconKey;
    const icon = firstExisting(iconKey && path.join(dir, `${iconKey}.png`), iconKey && path.join(dir, '..', '..', 'icons', `${iconKey}.png`));
    return {
      launcher: 'Prism / MultiMC',
      name: ini.name || path.basename(dir),
      gameVersion: ver('net.minecraft') || ini.IntendedVersion,
      loader,
      loaderVersion,
      gameDir: firstExisting(path.join(dir, '.minecraft'), path.join(dir, 'minecraft')) || path.join(dir, '.minecraft'),
      icon,
    };
  }

  const cf = path.join(dir, 'minecraftinstance.json');
  if (fs.existsSync(cf)) {
    const j = readJson(cf, {});
    const parsed = j.baseModLoader?.name ? parseCfLoader(j.baseModLoader.name) : { loader: 'vanilla', loaderVersion: null };
    return {
      launcher: 'CurseForge',
      name: j.name || path.basename(dir),
      gameVersion: j.gameVersion || j.baseModLoader?.minecraftVersion,
      ...parsed,
      gameDir: dir,
      icon: firstExisting(path.join(dir, 'instance.png')),
    };
  }

  const atl = path.join(dir, 'instance.json');
  if (fs.existsSync(atl)) {
    const j = readJson(atl, {});
    if (j.launcher) {
      const lv = j.launcher.loaderVersion;
      return {
        launcher: 'ATLauncher',
        name: j.launcher.name || path.basename(dir),
        gameVersion: j.id,
        loader: lv?.type ? lv.type.toLowerCase() : 'vanilla',
        loaderVersion: lv?.version || null,
        gameDir: dir,
        icon: firstExisting(path.join(dir, 'instance.png')),
      };
    }
    const std = j.game_configuration?.version?.Standard;
    if (std) {
      const ml = std.modloaders?.[0];
      return {
        launcher: 'GDLauncher',
        name: j.name || path.basename(dir),
        gameVersion: std.release,
        loader: ml ? ml.type_.toLowerCase() : 'vanilla',
        loaderVersion: ml?.version?.replace(`${std.release}-`, '') || null,
        gameDir: firstExisting(path.join(dir, 'instance')) || dir,
        icon: j.icon?.RelativePath ? firstExisting(path.join(dir, j.icon.RelativePath)) : null,
      };
    }
  }

  const gdl = path.join(dir, 'config.json');
  if (fs.existsSync(gdl)) {
    const j = readJson(gdl, {});
    if (j.loader?.mcVersion) {
      return {
        launcher: 'GDLauncher',
        name: path.basename(dir),
        gameVersion: j.loader.mcVersion,
        loader: (j.loader.loaderType || 'vanilla').toLowerCase(),
        loaderVersion: j.loader.loaderVersion?.replace(`${j.loader.mcVersion}-`, '') || null,
        gameDir: dir,
        icon: j.background ? firstExisting(path.join(dir, j.background)) : null,
      };
    }
  }

  const theseus = path.join(dir, 'profile.json');
  if (fs.existsSync(theseus)) {
    const m = readJson(theseus, {}).metadata;
    if (m) {
      return {
        launcher: 'Modrinth App',
        name: m.name || path.basename(dir),
        gameVersion: m.game_version,
        loader: m.loader || 'vanilla',
        loaderVersion: m.loader_version?.id || null,
        gameDir: dir,
        icon: m.icon ? firstExisting(m.icon) : null,
      };
    }
  }

  // Modrinth App 0.8+ keeps profile metadata in app.db next to the profiles folder.
  const db = path.join(dir, '..', '..', 'app.db');
  if (path.basename(path.dirname(dir)) === 'profiles' && fs.existsSync(db)) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const conn = new DatabaseSync(db, { readOnly: true });
      const row = conn.prepare('SELECT * FROM profiles WHERE path = ?').get(path.basename(dir));
      conn.close();
      if (row) {
        return {
          launcher: 'Modrinth App',
          name: row.name || path.basename(dir),
          gameVersion: row.game_version,
          loader: row.mod_loader || 'vanilla',
          loaderVersion: row.mod_loader_version || null,
          gameDir: dir,
          icon: row.icon_path ? firstExisting(row.icon_path) : null,
        };
      }
    } catch {}
  }

  return null;
}

// Installed versions inside a vanilla/TLauncher .minecraft folder.
function describeDotMinecraft(dir) {
  const versionsDir = path.join(dir, 'versions');
  if (!fs.existsSync(versionsDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(versionsDir)) {
    const json = readJson(path.join(versionsDir, name, `${name}.json`), null);
    if (!json) continue;
    const libs = (json.libraries || []).map((l) => l.name || '');
    const lib = (prefix) => libs.find((n) => n.startsWith(prefix))?.split(':')[2];
    let loader = 'vanilla';
    let loaderVersion = null;
    if (lib('net.neoforged:neoforge:')) [loader, loaderVersion] = ['neoforge', lib('net.neoforged:neoforge:')];
    else if (lib('net.minecraftforge:forge:') || lib('net.minecraftforge:fmlloader:')) {
      loader = 'forge';
      loaderVersion = (lib('net.minecraftforge:forge:') || lib('net.minecraftforge:fmlloader:')).split('-')[1];
    } else if (lib('org.quiltmc:quilt-loader:')) [loader, loaderVersion] = ['quilt', lib('org.quiltmc:quilt-loader:')];
    else if (lib('net.fabricmc:fabric-loader:')) [loader, loaderVersion] = ['fabric', lib('net.fabricmc:fabric-loader:')];
    const gameVersion = json.inheritsFrom || (loader === 'vanilla' ? json.id : null);
    if (!gameVersion) continue;
    out.push({ launcher: '.minecraft', name, gameVersion, loader, loaderVersion, gameDir: dir, shared: true });
  }
  return out;
}

function knownLocations() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const macSupport = path.join(home, 'Library', 'Application Support');
  const prismRoots = {
    win32: [path.join(appData, 'PrismLauncher')],
    linux: [path.join(xdg, 'PrismLauncher'), path.join(home, '.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher')],
    darwin: [path.join(macSupport, 'PrismLauncher')],
  }[process.platform] || [];
  const prismDirs = prismRoots.map((root) => {
    const cfg = path.join(root, 'prismlauncher.cfg');
    const custom = fs.existsSync(cfg) ? readIni(cfg).InstanceDir : null;
    return custom ? path.resolve(root, custom) : path.join(root, 'instances');
  });
  const per = {
    win32: [
      path.join(home, 'curseforge', 'minecraft', 'Instances'),
      path.join(appData, 'ModrinthApp', 'profiles'),
      path.join(appData, 'com.modrinth.theseus', 'profiles'),
      path.join(appData, 'ATLauncher', 'instances'),
      path.join(appData, 'gdlauncher_next', 'instances'),
      path.join(appData, 'gdlauncher_carbon', 'data', 'instances'),
    ],
    linux: [
      path.join(xdg, 'ModrinthApp', 'profiles'),
      path.join(xdg, 'com.modrinth.theseus', 'profiles'),
      path.join(xdg, 'atlauncher', 'instances'),
      path.join(home, '.var/app/com.atlauncher.ATLauncher/data/instances'),
      path.join(home, '.config', 'gdlauncher_next', 'instances'),
      path.join(home, '.config', 'gdlauncher_carbon', 'data', 'instances'),
    ],
    darwin: [
      path.join(macSupport, 'ModrinthApp', 'profiles'),
      path.join(macSupport, 'com.modrinth.theseus', 'profiles'),
      path.join(macSupport, 'ATLauncher', 'instances'),
      path.join(macSupport, 'gdlauncher_next', 'instances'),
    ],
  }[process.platform] || [];
  const dotMinecraft = {
    win32: path.join(appData, '.minecraft'),
    darwin: path.join(macSupport, 'minecraft'),
    linux: path.join(home, '.minecraft'),
  }[process.platform];
  return { instanceRoots: [...prismDirs, ...per], dotMinecraft };
}

// Finds instances of other launchers installed on this machine.
function scan() {
  const { instanceRoots, dotMinecraft } = knownLocations();
  const found = [];
  for (const root of instanceRoots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const info = describeFolder(dir);
      if (info?.gameVersion) found.push({ ...info, path: dir });
    }
  }
  if (dotMinecraft) for (const v of describeDotMinecraft(dotMinecraft)) found.push({ ...v, path: dotMinecraft });
  return found;
}

const SKIP = new Set(['logs', 'crash-reports', '.cache', 'natives', 'versions', 'libraries', 'assets', 'runtime', 'webcache', 'webcache2', '.fabric', '.mixin.out']);

async function importFolder(info, task) {
  if (!info.gameVersion) throw new Error('Не удалось определить версию Minecraft — укажите её вручную');
  const inst = await instances.create({
    name: info.name,
    gameVersion: info.gameVersion,
    loader: ['fabric', 'quilt', 'forge', 'neoforge'].includes(info.loader) ? info.loader : 'vanilla',
    loaderVersion: info.loaderVersion,
    icon: info.icon,
    source: { platform: 'import', launcher: info.launcher, path: info.path },
  });
  const dest = instances.gameDirOf(inst.id);
  if (fs.existsSync(info.gameDir)) {
    const entries = await fsp.readdir(info.gameDir, { withFileTypes: true });
    const toCopy = entries.filter((e) => !SKIP.has(e.name) && !e.name.endsWith('.log') && !/^(instance\.cfg|mmc-pack\.json|minecraftinstance\.json|instance\.json|profile\.json|launcher_.*\.json)$/.test(e.name));
    let done = 0;
    for (const e of toCopy) {
      task?.update(`Копирование ${e.name}`, done++ / toCopy.length);
      await fsp.cp(path.join(info.gameDir, e.name), path.join(dest, e.name), { recursive: true, force: true });
    }
  }
  await instances.identifyMods(inst.id).catch(() => {});
  return instances.get(inst.id);
}

// Imports a file (.mrpack, CurseForge .zip, Prism export .zip) or a folder.
async function importPath(source, task, overrides = {}) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    const info = describeFolder(source) || describeDotMinecraft(source)[0];
    if (!info && !overrides.gameVersion) {
      const err = new Error('Формат папки не распознан — укажите версию вручную');
      err.code = 'NEEDS_VERSION';
      throw err;
    }
    return importFolder({ ...(info || { launcher: 'Папка', name: path.basename(source), gameDir: source }), path: source, ...overrides }, task);
  }
  const zip = new AdmZip(source);
  const names = zip.getEntries().map((e) => e.entryName);
  if (names.includes('modrinth.index.json')) return installMrpack(source, task);
  if (names.includes('manifest.json')) {
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    if (manifest.minecraft) return installCurseForgeZip(source, task);
  }
  const cfg = names.find((n) => /(^|\/)instance\.cfg$/.test(n));
  if (cfg) {
    const tmp = path.join(paths.cache, 'import', String(Date.now()));
    zip.extractAllTo(tmp, true);
    try {
      return await importPath(path.join(tmp, path.dirname(cfg)), task, overrides);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  }
  throw new Error('Архив не похож на сборку (.mrpack, CurseForge или Prism)');
}

module.exports = {
  installMrpack,
  installModrinthPack,
  installCurseForgeZip,
  installCurseForgePack,
  importPath,
  importFolder,
  scan,
};
