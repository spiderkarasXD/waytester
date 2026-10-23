const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const net = require('./net');
const java = require('./java');
const mc = require('./minecraft');
const { writeJson } = require('./store');

const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEO_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged';
const BMCLAPI = 'https://bmclapi2.bangbang93.com';

const memo = new Map();
async function cached(key, fn, ttl = 10 * 60 * 1000) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  memo.set(key, { value, at: Date.now() });
  return value;
}

function compareVersions(a, b) {
  const pa = a.split(/[.\-+]/).map((x) => (isNaN(x) ? x : Number(x)));
  const pb = b.split(/[.\-+]/).map((x) => (isNaN(x) ? x : Number(x)));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

// ---------- Fabric / Quilt ----------

async function listFabric(gameVersion) {
  const list = await cached(`fabric:${gameVersion}`, () => net.getJson(`${FABRIC_META}/versions/loader/${gameVersion}`));
  return list.map((e) => ({ version: e.loader.version, stable: e.loader.stable }));
}

async function listQuilt(gameVersion) {
  const list = await cached(`quilt:${gameVersion}`, () => net.getJson(`${QUILT_META}/versions/loader/${gameVersion}`));
  return list.map((e) => ({ version: e.loader.version, stable: !/beta|alpha|pre/.test(e.loader.version) }));
}

async function installProfileLoader(base, gameVersion, loaderVersion) {
  const profile = await net.getJson(`${base}/versions/loader/${gameVersion}/${loaderVersion}/profile/json`);
  writeJson(mc.versionJsonPath(profile.id), profile);
  return profile.id;
}

// ---------- Forge / NeoForge ----------

async function forgeIndex() {
  return cached('forge:index', async () => {
    const xml = await net.getText(`${FORGE_MAVEN}/maven-metadata.xml`);
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
    const promos = await net.getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json').catch(() => ({ promos: {} }));
    return { all, promos: promos.promos };
  });
}

async function listForge(gameVersion) {
  const { all, promos } = await forgeIndex();
  const recommended = promos[`${gameVersion}-recommended`];
  const latest = promos[`${gameVersion}-latest`];
  return all
    .filter((v) => v.startsWith(`${gameVersion}-`))
    .map((full) => {
      const version = full.slice(gameVersion.length + 1).replace(new RegExp(`-${gameVersion.replace(/\./g, '\\.')}$`), '');
      return { version, full, stable: version === recommended, latest: version === latest };
    })
    .sort((a, b) => compareVersions(b.version, a.version));
}

// NeoForge versions encode the Minecraft version: 21.1.77 -> 1.21.1, 20.4.80 -> 1.20.4, 26.1.0.5 -> 26.1
function neoforgeGameVersion(v) {
  const parts = v.split('-')[0].split('.');
  const major = Number(parts[0]);
  if (major >= 25) return parts.length >= 4 && parts[2] !== '0' ? `${parts[0]}.${parts[1]}.${parts[2]}` : `${parts[0]}.${parts[1]}`;
  return parts[1] === '0' ? `1.${parts[0]}` : `1.${parts[0]}.${parts[1]}`;
}

async function neoforgeIndex() {
  return cached('neoforge:index', async () => {
    const data = await net.getJson(`${NEO_API}/neoforge`);
    return data.versions;
  });
}

async function listNeoForge(gameVersion) {
  if (gameVersion === '1.20.1') {
    const legacy = await cached('neoforge:legacy', () => net.getJson(`${NEO_API}/forge`));
    return legacy.versions
      .filter((v) => v.startsWith('1.20.1-'))
      .map((full) => ({ version: full.slice(7), full, legacy: true, stable: true }))
      .sort((a, b) => compareVersions(b.version, a.version));
  }
  const all = await neoforgeIndex();
  return all
    .filter((v) => neoforgeGameVersion(v) === gameVersion)
    .map((v) => ({ version: v, full: v, stable: !/beta|alpha/.test(v) }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

function runJava(binary, args, { cwd, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: cwd || paths.meta, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail = [];
    const onData = (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        onLine?.(line);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Установщик завершился с кодом ${code}:\n${tail.slice(-6).join('\n')}`))));
  });
}

async function runForgeInstaller(installerUrl, cacheName, gameVersion, task) {
  const installer = path.join(paths.cache, 'installers', cacheName);
  task?.update('Скачивание установщика', -1);
  await net.download({ url: installerUrl, path: installer });
  const zip = new AdmZip(installer);
  const profile = JSON.parse(zip.readAsText('install_profile.json'));

  // Forge <= 1.12.2: the installer just carries a version json and a universal jar.
  if (profile.versionInfo) {
    const info = profile.versionInfo;
    const target = path.join(paths.libraries, mc.mavenPath(profile.install.path));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, zip.readFile(profile.install.filePath));
    info.libraries = info.libraries
      .filter((l) => l.clientreq === true || (l.clientreq === undefined && l.serverreq === undefined) || l.name === profile.install.path)
      .map((l) => ({
        ...l,
        url: l.url ? l.url.replace(/^https?:\/\/files\.minecraftforge\.net\/maven\/?/, 'https://maven.minecraftforge.net/') : undefined,
      }));
    writeJson(mc.versionJsonPath(info.id), info);
    return info.id;
  }

  const vanilla = await mc.installVersion(gameVersion, task);
  const javaBin = await java.ensureRuntime(vanilla.javaVersion, task);
  task?.update('Запуск установщика (это может занять пару минут)', -1);
  await runJava(javaBin, ['-jar', installer, '--installClient', paths.meta], {
    onLine: (line) => task?.update(line.slice(0, 140), -1),
  });
  const id = profile.version;
  if (!fs.existsSync(mc.versionJsonPath(id))) throw new Error(`Установщик не создал версию ${id}`);
  return id;
}

async function installForge(gameVersion, forgeVersion, task) {
  const list = await listForge(gameVersion);
  const full = list.find((v) => v.version === forgeVersion)?.full || `${gameVersion}-${forgeVersion}`;
  return runForgeInstaller(`${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`, `forge-${full}-installer.jar`, gameVersion, task);
}

async function installNeoForge(gameVersion, neoVersion, task) {
  if (gameVersion === '1.20.1') {
    const full = `1.20.1-${neoVersion}`;
    return runForgeInstaller(`${NEO_MAVEN}/forge/${full}/forge-${full}-installer.jar`, `neoforge-${full}-installer.jar`, gameVersion, task);
  }
  return runForgeInstaller(
    `${NEO_MAVEN}/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`,
    `neoforge-${neoVersion}-installer.jar`,
    gameVersion,
    task,
  );
}

// ---------- OptiFine ----------

async function listOptiFine(gameVersion) {
  const list = await cached('optifine:index', () => net.getJson(`${BMCLAPI}/optifine/versionList`));
  return list
    .filter((e) => e.mcversion === gameVersion)
    .map((e) => ({
      version: `${e.type}_${e.patch}`,
      type: e.type,
      patch: e.patch,
      filename: e.filename,
      forge: e.forge || '',
      stable: !/pre/i.test(e.patch),
    }))
    .reverse();
}

async function downloadOptiFine(gameVersion, version) {
  const entry = (await listOptiFine(gameVersion)).find((e) => e.version === version);
  if (!entry) throw new Error(`OptiFine ${version} для ${gameVersion} не найден`);
  const file = path.join(paths.cache, 'optifine', entry.filename);
  await net.download({ url: `${BMCLAPI}/optifine/${gameVersion}/${entry.type}/${entry.patch}`, path: file });
  return { file, entry };
}

// Standalone OptiFine runs through LaunchWrapper with a patched OptiFine jar, the same way its own installer sets it up.
async function installOptiFineStandalone(gameVersion, version, task) {
  const id = `${gameVersion}-OptiFine_${version}`;
  if (fs.existsSync(mc.versionJsonPath(id))) return id;
  task?.update(`Скачивание OptiFine ${version}`, -1);
  const { file } = await downloadOptiFine(gameVersion, version);
  const vanilla = await mc.installVersion(gameVersion, task);
  const zip = new AdmZip(file);

  let wrapper = { name: 'net.minecraft:launchwrapper:1.12' };
  const wrapperTxt = zip.getEntry('launchwrapper-of.txt');
  if (wrapperTxt) {
    const v = zip.readAsText(wrapperTxt).trim();
    const dest = path.join(paths.libraries, mc.mavenPath(`optifine:launchwrapper-of:${v}`));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, zip.readFile(`launchwrapper-of-${v}.jar`));
    wrapper = { name: `optifine:launchwrapper-of:${v}` };
  }

  const libName = `optifine:OptiFine:${gameVersion}_${version}`;
  const libFile = path.join(paths.libraries, mc.mavenPath(libName));
  await fsp.mkdir(path.dirname(libFile), { recursive: true });
  if (zip.getEntry('optifine/Patcher.class')) {
    task?.update('Патчинг OptiFine', -1);
    const javaBin = await java.ensureRuntime(vanilla.javaVersion, task);
    await runJava(javaBin, ['-cp', file, 'optifine.Patcher', mc.clientJarPath(gameVersion), file, libFile]);
  } else {
    await fsp.copyFile(file, libFile);
  }

  const parent = await mc.resolveVersion(gameVersion);
  const json = {
    id,
    inheritsFrom: gameVersion,
    type: 'release',
    time: new Date().toISOString(),
    releaseTime: new Date().toISOString(),
    mainClass: 'net.minecraft.launchwrapper.Launch',
    libraries: [{ name: libName }, wrapper],
  };
  if (parent.minecraftArguments) json.minecraftArguments = `${parent.minecraftArguments} --tweakClass optifine.OptiFineTweaker`;
  else json.arguments = { game: ['--tweakClass', 'optifine.OptiFineTweaker'], jvm: [] };
  writeJson(mc.versionJsonPath(id), json);
  return id;
}

// ---------- Availability (for the create dialog) ----------

async function supportedGameVersions(loader) {
  switch (loader) {
    case 'fabric':
      return cached('fabric:games', async () => (await net.getJson(`${FABRIC_META}/versions/game`)).map((g) => g.version));
    case 'quilt':
      return cached('quilt:games', async () => (await net.getJson(`${QUILT_META}/versions/game`)).map((g) => g.version));
    case 'forge': {
      const { all } = await forgeIndex();
      return [...new Set(all.map((v) => v.split('-')[0]))];
    }
    case 'neoforge':
      return ['1.20.1', ...new Set((await neoforgeIndex()).map(neoforgeGameVersion))];
    default:
      return null;
  }
}

async function listLoader(loader, gameVersion) {
  switch (loader) {
    case 'fabric':
      return listFabric(gameVersion);
    case 'quilt':
      return listQuilt(gameVersion);
    case 'forge':
      return listForge(gameVersion);
    case 'neoforge':
      return listNeoForge(gameVersion);
    case 'optifine':
      return listOptiFine(gameVersion);
    default:
      return [];
  }
}

// Installs the loader's version json (if missing) and returns the id to launch.
async function installLoader(loader, gameVersion, loaderVersion, task) {
  switch (loader) {
    case 'fabric':
      return installProfileLoader(FABRIC_META, gameVersion, loaderVersion);
    case 'quilt':
      return installProfileLoader(QUILT_META, gameVersion, loaderVersion);
    case 'forge':
      return installForge(gameVersion, loaderVersion, task);
    case 'neoforge':
      return installNeoForge(gameVersion, loaderVersion, task);
    default:
      await mc.ensureVanillaJson(gameVersion);
      return gameVersion;
  }
}

module.exports = {
  listLoader,
  installLoader,
  supportedGameVersions,
  installOptiFineStandalone,
  downloadOptiFine,
  compareVersions,
};
