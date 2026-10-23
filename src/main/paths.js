const path = require('path');
const os = require('os');
const fs = require('fs');

// Data root follows each platform's conventions (XDG on Linux).
function dataRoot() {
  if (process.env.WAYTESTER_HOME) return process.env.WAYTESTER_HOME;
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'WayTester');
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'WayTester');
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'waytester');
  }
}

const root = dataRoot();

const paths = {
  root,
  meta: path.join(root, 'meta'),
  versions: path.join(root, 'meta', 'versions'),
  libraries: path.join(root, 'meta', 'libraries'),
  assets: path.join(root, 'meta', 'assets'),
  runtimes: path.join(root, 'runtimes'),
  instances: path.join(root, 'instances'),
  skins: path.join(root, 'skins'),
  cache: path.join(root, 'cache'),
  config: path.join(root, 'config.json'),
  accounts: path.join(root, 'accounts.json'),
};

for (const key of ['meta', 'versions', 'libraries', 'assets', 'runtimes', 'instances', 'skins', 'cache']) {
  fs.mkdirSync(paths[key], { recursive: true });
}

// Forge/NeoForge installers refuse to run without this file in the target dir.
const profiles = path.join(paths.meta, 'launcher_profiles.json');
if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({ profiles: {} }, null, 2));

module.exports = paths;
