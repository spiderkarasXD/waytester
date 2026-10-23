const fs = require('fs');
const path = require('path');
const paths = require('./paths');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Write to a temp file first so a crash never leaves half-written JSON behind.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const DEFAULT_SETTINGS = {
  accent: '#8ab4ff',
  theme: 'dark',
  blur: 28,
  glass: 0.55,
  wallpaper: '',
  memoryMin: 1024,
  memoryMax: 4096,
  jvmArgs: '',
  javaPath: '',
  width: 1280,
  height: 720,
  closeOnLaunch: false,
  showSnapshots: false,
  concurrency: 24,
  msClientId: '',
  curseforgeKey: '',
};

const settings = {
  get() {
    return { ...DEFAULT_SETTINGS, ...readJson(paths.config, {}) };
  },
  set(patch) {
    const next = { ...settings.get(), ...patch };
    writeJson(paths.config, next);
    return next;
  },
};

module.exports = { readJson, writeJson, settings };
