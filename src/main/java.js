const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const paths = require('./paths');
const net = require('./net');

const MOJANG_RUNTIMES =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function mojangPlatform() {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  if (platform === 'linux') return arch === 'x64' ? 'linux' : arch === 'ia32' ? 'linux-i386' : null;
  return null;
}

function javaBinary(dir, console = false) {
  const exe = process.platform === 'win32' ? (console ? 'java.exe' : 'javaw.exe') : 'java';
  const candidates = [
    path.join(dir, 'bin', exe),
    path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', exe),
    path.join(dir, 'Contents', 'Home', 'bin', exe),
  ];
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

async function installMojangRuntime(component, dir, task) {
  const key = mojangPlatform();
  if (!key) return false;
  const all = await net.getJson(MOJANG_RUNTIMES);
  const entry = all[key]?.[component]?.[0];
  if (!entry) return false;
  const manifest = await net.getJson(entry.manifest.url);
  const files = [];
  const links = [];
  const executables = [];
  for (const [rel, info] of Object.entries(manifest.files)) {
    const target = path.join(dir, rel);
    if (info.type === 'directory') await fsp.mkdir(target, { recursive: true });
    else if (info.type === 'link') links.push([target, info.target]);
    else if (info.type === 'file') {
      const raw = info.downloads.raw;
      files.push({ url: raw.url, path: target, sha1: raw.sha1, size: raw.size });
      if (info.executable) executables.push(target);
    }
  }
  await net.downloadAll(files, {
    concurrency: 16,
    onProgress: (d, t) => task?.update(`Java ${entry.version.name}: ${d}/${t}`, d / t),
  });
  if (process.platform !== 'win32') {
    for (const file of executables) await fsp.chmod(file, 0o755);
    for (const [link, target] of links) {
      await fsp.rm(link, { force: true });
      await fsp.symlink(target, link).catch(() => {});
    }
  }
  return true;
}

// Fallback for platforms Mojang does not ship runtimes for (e.g. Linux ARM64).
async function installAdoptium(major, dir, task) {
  const osName = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64', ia32: 'x32', arm: 'arm' }[process.arch];
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
  const archive = path.join(paths.cache, `adoptium-${major}-${osName}-${arch}${process.platform === 'win32' ? '.zip' : '.tar.gz'}`);
  task?.update(`Скачивание Java ${major} (Adoptium)`, -1);
  await net.download({ url, path: archive });
  const tmp = `${dir}.extract`;
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  await new Promise((resolve, reject) =>
    execFile('tar', ['-xf', archive, '-C', tmp], (err) => (err ? reject(err) : resolve())),
  );
  const [top] = await fsp.readdir(tmp);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(path.join(tmp, top), dir);
  await fsp.rm(tmp, { recursive: true, force: true });
}

// Returns the java binary for a Minecraft version's javaVersion block, downloading it on first use.
async function ensureRuntime(javaVersion, task) {
  const component = javaVersion?.component || 'jre-legacy';
  const major = javaVersion?.majorVersion || 8;
  const dir = path.join(paths.runtimes, component);
  const marker = path.join(dir, '.render-ok');
  if (fs.existsSync(marker)) return javaBinary(dir);
  task?.update(`Установка Java ${major}`, -1);
  const ok = await installMojangRuntime(component, dir, task).catch(() => false);
  if (!ok) await installAdoptium(major, dir, task);
  fs.writeFileSync(marker, String(major));
  return javaBinary(dir);
}

function javaVersionOf(binary) {
  return new Promise((resolve) => {
    execFile(binary, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const m = /version "([^"]+)"/.exec(stderr || stdout);
      resolve(m ? m[1] : 'unknown');
    });
  });
}

// Lists runtimes WayTester downloaded plus anything found on PATH / JAVA_HOME.
async function detect() {
  const found = [];
  for (const name of await fsp.readdir(paths.runtimes).catch(() => [])) {
    const bin = javaBinary(path.join(paths.runtimes, name));
    if (fs.existsSync(bin)) found.push({ path: bin, source: 'WayTester', version: await javaVersionOf(bin) });
  }
  const extra = [];
  if (process.env.JAVA_HOME) extra.push(javaBinary(process.env.JAVA_HOME));
  if (process.platform === 'linux') {
    for (const d of await fsp.readdir('/usr/lib/jvm').catch(() => [])) extra.push(javaBinary(path.join('/usr/lib/jvm', d)));
  }
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Zulu']) {
      for (const d of await fsp.readdir(base).catch(() => [])) extra.push(javaBinary(path.join(base, d)));
    }
  }
  for (const bin of [...new Set(extra)]) {
    if (fs.existsSync(bin)) found.push({ path: bin, source: 'Система', version: await javaVersionOf(bin) });
  }
  return found;
}

module.exports = { ensureRuntime, detect, javaBinary, javaVersionOf };
