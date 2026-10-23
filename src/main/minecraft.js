const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const net = require('./net');
const { readJson, writeJson } = require('./store');

const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const LIBRARIES_URL = 'https://libraries.minecraft.net/';
const RESOURCES_URL = 'https://resources.download.minecraft.net/';

let manifestCache = null;
let manifestAt = 0;

async function getManifest(force = false) {
  const cacheFile = path.join(paths.cache, 'version_manifest_v2.json');
  if (!force && manifestCache && Date.now() - manifestAt < 15 * 60 * 1000) return manifestCache;
  try {
    manifestCache = await net.getJson(VERSION_MANIFEST);
    writeJson(cacheFile, manifestCache);
  } catch (e) {
    manifestCache = readJson(cacheFile, null);
    if (!manifestCache) throw e;
  }
  manifestAt = Date.now();
  return manifestCache;
}

const osName = () => ({ win32: 'windows', darwin: 'osx', linux: 'linux' })[process.platform];
const archName = () => (process.arch === 'ia32' ? 'x86' : process.arch);

function ruleAllows(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allow = false;
  for (const rule of rules) {
    let match = true;
    if (rule.os) {
      if (rule.os.name && rule.os.name !== osName()) match = false;
      if (rule.os.arch && rule.os.arch !== archName()) match = false;
      if (rule.os.version) {
        try {
          if (!new RegExp(rule.os.version).test(os.release())) match = false;
        } catch {}
      }
    }
    if (rule.features) {
      for (const [k, v] of Object.entries(rule.features)) if (!!features[k] !== v) match = false;
    }
    if (match) allow = rule.action === 'allow';
  }
  return allow;
}

// "group:artifact:version[:classifier][@ext]" -> relative maven path
function mavenPath(name) {
  let [coords, ext = 'jar'] = name.split('@');
  const [group, artifact, version, classifier] = coords.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return path.posix.join(...group.split('.'), artifact, version, file);
}

function libraryKey(name) {
  const [group, artifact, , classifier] = name.split('@')[0].split(':');
  return `${group}:${artifact}${classifier ? `:${classifier}` : ''}`;
}

const versionJsonPath = (id) => path.join(paths.versions, id, `${id}.json`);

async function ensureVanillaJson(id) {
  const file = versionJsonPath(id);
  const manifest = await getManifest().catch(() => null);
  const entry = manifest?.versions.find((v) => v.id === id);
  if (fs.existsSync(file)) {
    if (!entry || (await net.sha1File(file)) === entry.sha1) return readJson(file);
  }
  if (!entry) {
    if (fs.existsSync(file)) return readJson(file);
    throw new Error(`Версия ${id} не найдена`);
  }
  await net.download({ url: entry.url, path: file, sha1: entry.sha1 });
  return readJson(file);
}

function merge(parent, child) {
  const merged = { ...parent, ...child };
  merged.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    };
  }
  for (const key of ['assetIndex', 'assets', 'downloads', 'javaVersion', 'logging']) {
    merged[key] = child[key] || parent[key];
  }
  merged.baseId = parent.baseId || parent.id;
  delete merged.inheritsFrom;
  return merged;
}

// Loads a version json and folds in everything it inherits from.
async function resolveVersion(id) {
  let json = fs.existsSync(versionJsonPath(id)) ? readJson(versionJsonPath(id)) : await ensureVanillaJson(id);
  if (!json) throw new Error(`Не удалось прочитать версию ${id}`);
  if (json.inheritsFrom) {
    const parent = await resolveVersion(json.inheritsFrom);
    json = merge(parent, json);
  } else {
    json.baseId = json.id;
  }
  return json;
}

// Turns the library list into download tasks, classpath entries and native jars.
function collectLibraries(version) {
  const downloads = [];
  const classpath = [];
  const natives = [];
  const seen = new Set();
  const arch = archName();
  const libs = version.libraries.filter((l) => ruleAllows(l.rules));
  const hasArm64 = new Set(libs.filter((l) => /natives-[a-z]+-arm64$/.test(l.name)).map((l) => l.name.replace(/-arm64$/, '')));

  for (const lib of libs) {
    const name = lib.name;
    const classifier = name.split('@')[0].split(':')[3] || '';
    const archSuffix = /natives-[a-z]+-(arm64|x86|aarch_64)$/.exec(classifier)?.[1];
    if (archSuffix && archSuffix.replace('aarch_64', 'arm64') !== arch) continue;
    if (!archSuffix && arch === 'arm64' && hasArm64.has(name)) continue;

    const key = libraryKey(name);
    if (seen.has(key)) continue;
    seen.add(key);

    const artifact = lib.downloads?.artifact;
    if (artifact || !lib.natives) {
      const rel = artifact?.path || mavenPath(name);
      const file = path.join(paths.libraries, rel);
      let url = artifact ? artifact.url : `${(lib.url || LIBRARIES_URL).replace(/\/?$/, '/')}${rel}`;
      if (artifact && !artifact.url) url = null; // produced locally by an installer
      if (url) downloads.push({ url, path: file, sha1: artifact?.sha1 || lib.sha1, size: artifact?.size || lib.size });
      classpath.push(file);
      if (classifier.startsWith('natives-')) natives.push({ file, exclude: lib.extract?.exclude || [] });
    }

    if (lib.natives) {
      const nativeClassifier = lib.natives[osName()]?.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
      if (!nativeClassifier) continue;
      const info = lib.downloads?.classifiers?.[nativeClassifier];
      const rel = info?.path || mavenPath(`${name}:${nativeClassifier}`);
      const file = path.join(paths.libraries, rel);
      downloads.push({
        url: info?.url || `${(lib.url || LIBRARIES_URL).replace(/\/?$/, '/')}${rel}`,
        path: file,
        sha1: info?.sha1,
        size: info?.size,
      });
      natives.push({ file, exclude: lib.extract?.exclude || [] });
    }
  }
  return { downloads, classpath, natives };
}

async function assetTasks(version) {
  const index = version.assetIndex;
  if (!index) return { tasks: [], index: null };
  const indexFile = path.join(paths.assets, 'indexes', `${index.id}.json`);
  await net.download({ url: index.url, path: indexFile, sha1: index.sha1, size: index.size });
  const data = readJson(indexFile);
  const tasks = Object.values(data.objects).map(({ hash, size }) => ({
    url: `${RESOURCES_URL}${hash.slice(0, 2)}/${hash}`,
    path: path.join(paths.assets, 'objects', hash.slice(0, 2), hash),
    sha1: hash,
    size,
  }));
  return { tasks, index: data };
}

function clientJarPath(id) {
  return path.join(paths.versions, id, `${id}.jar`);
}

// Downloads everything a version needs to launch. Safe to call before every launch.
async function installVersion(id, task, concurrency = 24) {
  task?.update(`Подготовка ${id}`, -1);
  const version = await resolveVersion(id);
  const base = await ensureVanillaJson(version.baseId).catch(() => null);
  const client = (base || version).downloads?.client;
  const tasks = [];
  if (client) tasks.push({ url: client.url, path: clientJarPath(version.baseId), sha1: client.sha1, size: client.size });
  const libs = collectLibraries(version);
  tasks.push(...libs.downloads);
  const logging = version.logging?.client?.file;
  if (logging) {
    tasks.push({ url: logging.url, path: path.join(paths.assets, 'log_configs', logging.id), sha1: logging.sha1, size: logging.size });
  }
  task?.update('Проверка ассетов', -1);
  const assets = await assetTasks(version);
  tasks.push(...assets.tasks);
  await net.downloadAll(tasks, {
    concurrency,
    onProgress: (d, t) => task?.update(`Загрузка файлов игры: ${d}/${t}`, t ? d / t : 1),
  });
  for (const lib of collectLibraries(version).classpath) {
    if (!fs.existsSync(lib)) throw new Error(`Отсутствует библиотека ${path.basename(lib)} — переустановите загрузчик`);
  }
  return version;
}

// Legacy asset layouts (pre-1.7) expect plain files instead of hashed objects.
async function materializeLegacyAssets(version, gameDir) {
  const index = readJson(path.join(paths.assets, 'indexes', `${version.assetIndex.id}.json`), null);
  if (!index || (!index.virtual && !index.map_to_resources)) return null;
  const target = index.map_to_resources ? path.join(gameDir, 'resources') : path.join(paths.assets, 'virtual', version.assetIndex.id);
  for (const [name, { hash }] of Object.entries(index.objects)) {
    const dest = path.join(target, name);
    if (fs.existsSync(dest)) continue;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(path.join(paths.assets, 'objects', hash.slice(0, 2), hash), dest);
  }
  return target;
}

async function extractNatives(natives, dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const nativeExt = /\.(so|dll|dylib|jnilib)$/i;
  for (const { file, exclude } of natives) {
    if (!fs.existsSync(file)) continue;
    const zip = new AdmZip(file);
    for (const entry of zip.getEntries()) {
      const name = entry.entryName;
      if (entry.isDirectory || exclude.some((e) => name.startsWith(e)) || name.startsWith('META-INF/')) continue;
      // Modern LWJGL keeps natives in nested folders; flatten them so java.library.path finds them.
      if (name.includes('/') && !nativeExt.test(name)) continue;
      if (name.includes('/') && process.arch === 'x64' && /\/(x86|arm64|arm32)\//.test(name)) continue;
      fs.writeFileSync(path.join(dir, path.basename(name)), entry.getData());
    }
  }
}

function substitute(arg, vars) {
  return arg.replace(/\$\{([^}]+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

function expandArgs(list, vars, features) {
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') out.push(substitute(item, vars));
    else if (ruleAllows(item.rules, features)) {
      const values = Array.isArray(item.value) ? item.value : [item.value];
      out.push(...values.map((v) => substitute(v, vars)));
    }
  }
  return out;
}

// Builds the full java command line for a version.
async function buildLaunch({ version, instance, gameDir, account, settings }) {
  const launchId = version.id;
  const sep = process.platform === 'win32' ? ';' : ':';
  const libs = collectLibraries(version);

  // Forge/NeoForge expect the client jar under the launched version's own name (see -DignoreList).
  const baseJar = clientJarPath(version.baseId);
  const launchJar = clientJarPath(launchId);
  if (launchId !== version.baseId && fs.existsSync(baseJar)) {
    const same = fs.existsSync(launchJar) && fs.statSync(launchJar).size === fs.statSync(baseJar).size;
    if (!same) {
      await fsp.mkdir(path.dirname(launchJar), { recursive: true });
      await fsp.copyFile(baseJar, launchJar);
    }
  }
  const classpath = [...libs.classpath, fs.existsSync(launchJar) ? launchJar : baseJar];

  const nativesDir = path.join(path.dirname(gameDir), 'natives');
  await extractNatives(libs.natives, nativesDir);
  const legacyAssets = version.assetIndex ? await materializeLegacyAssets(version, gameDir) : null;

  const width = instance.width || settings.width;
  const height = instance.height || settings.height;
  const features = { has_custom_resolution: true };
  const vars = {
    auth_player_name: account.name,
    version_name: launchId,
    game_directory: gameDir,
    assets_root: paths.assets,
    game_assets: legacyAssets || paths.assets,
    assets_index_name: version.assetIndex?.id || version.assets,
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: account.accessToken || '0',
    auth_session: account.accessToken ? `token:${account.accessToken}:${account.uuid.replace(/-/g, '')}` : '-',
    auth_xuid: account.xuid || '0',
    clientid: account.clientId || '0',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: version.type || 'release',
    natives_directory: nativesDir,
    launcher_name: 'WayTester',
    launcher_version: '1.0.0',
    classpath: classpath.join(sep),
    classpath_separator: sep,
    library_directory: paths.libraries,
    resolution_width: String(width),
    resolution_height: String(height),
  };

  const memMax = instance.memoryMax || settings.memoryMax;
  const memMin = Math.min(instance.memoryMin || settings.memoryMin, memMax);
  const jvm = [`-Xms${memMin}M`, `-Xmx${memMax}M`];
  if (process.platform === 'darwin') jvm.push('-XstartOnFirstThread');
  jvm.push(
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+UseG1GC',
    '-XX:G1NewSizePercent=20',
    '-XX:G1ReservePercent=20',
    '-XX:MaxGCPauseMillis=50',
    '-XX:G1HeapRegionSize=32M',
    '-Dlog4j2.formatMsgNoLookups=true',
    '-Dminecraft.launcher.brand=WayTester',
    '-Dminecraft.launcher.version=1.0.0',
  );
  const custom = `${settings.jvmArgs || ''} ${instance.jvmArgs || ''}`.trim();
  if (custom) jvm.push(...custom.split(/\s+/));

  if (version.arguments?.jvm) jvm.push(...expandArgs(version.arguments.jvm, vars, features));
  else jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', vars.classpath);

  const logging = version.logging?.client;
  if (logging?.file) {
    const cfg = path.join(paths.assets, 'log_configs', logging.file.id);
    if (fs.existsSync(cfg)) jvm.push(logging.argument.replace('${path}', cfg));
  }

  let game;
  if (version.arguments?.game) game = expandArgs(version.arguments.game, vars, features);
  else {
    game = substitute(version.minecraftArguments || '', vars).split(' ').filter(Boolean);
    game.push('--width', vars.resolution_width, '--height', vars.resolution_height);
  }
  if (instance.joinServer) game.push(...(version.arguments ? ['--quickPlayMultiplayer', instance.joinServer] : ['--server', instance.joinServer]));

  return { args: [...jvm, version.mainClass, ...game], nativesDir };
}

module.exports = {
  getManifest,
  resolveVersion,
  installVersion,
  ensureVanillaJson,
  buildLaunch,
  mavenPath,
  versionJsonPath,
  clientJarPath,
  ruleAllows,
};
