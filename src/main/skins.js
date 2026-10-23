const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');
const net = require('./net');
const accounts = require('./accounts');
const { readJson, writeJson } = require('./store');

const LIBRARY = path.join(paths.skins, 'library.json');

const toDataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function validateSkin(buf) {
  const size = pngSize(buf);
  if (!size || size.width !== 64 || (size.height !== 64 && size.height !== 32)) {
    throw new Error('Скин должен быть PNG 64×64 или 64×32');
  }
}

async function fetchImage(url) {
  const res = await net.request(url);
  if (!res.ok) throw new Error(`Не удалось загрузить текстуру (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function list() {
  return readJson(LIBRARY, []).map((s) => {
    const file = path.join(paths.skins, s.file);
    return { ...s, data: fs.existsSync(file) ? toDataUrl(fs.readFileSync(file)) : null };
  });
}

function addBuffer(buf, name, variant = 'classic') {
  validateSkin(buf);
  const id = crypto.randomUUID();
  const file = `${id}.png`;
  fs.writeFileSync(path.join(paths.skins, file), buf);
  const lib = readJson(LIBRARY, []);
  const entry = { id, name: name || 'Скин', variant, file, added: Date.now() };
  lib.unshift(entry);
  writeJson(LIBRARY, lib);
  return { ...entry, data: toDataUrl(buf) };
}

function addFile(filePath, variant) {
  return addBuffer(fs.readFileSync(filePath), path.basename(filePath, path.extname(filePath)), variant);
}

function update(id, patch) {
  const lib = readJson(LIBRARY, []);
  const entry = lib.find((s) => s.id === id);
  if (entry) Object.assign(entry, { name: patch.name ?? entry.name, variant: patch.variant ?? entry.variant });
  writeJson(LIBRARY, lib);
}

function remove(id) {
  const lib = readJson(LIBRARY, []);
  const entry = lib.find((s) => s.id === id);
  if (entry) fs.rmSync(path.join(paths.skins, entry.file), { force: true });
  writeJson(LIBRARY, lib.filter((s) => s.id !== id));
}

async function skinOfPlayer(name) {
  const user = await net.getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`).catch(() => null);
  if (!user?.id) throw new Error(`Игрок ${name} не найден`);
  const profile = await net.getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${user.id}`);
  const textures = JSON.parse(Buffer.from(profile.properties.find((p) => p.name === 'textures').value, 'base64').toString());
  const skin = textures.textures.SKIN;
  if (!skin) throw new Error('У игрока стандартный скин');
  const buf = await fetchImage(skin.url.replace('http://', 'https://'));
  return { name: user.name, buf, variant: skin.metadata?.model === 'slim' ? 'slim' : 'classic' };
}

// Copies any player's current skin by nickname into the library.
async function importByName(name) {
  const { name: realName, buf, variant } = await skinOfPlayer(name);
  return addBuffer(buf, realName, variant);
}

// Steve, for accounts without a skin (cached after the first fetch).
async function defaultSkin() {
  const file = path.join(paths.cache, 'steve.png');
  if (!fs.existsSync(file)) {
    const { buf } = await skinOfPlayer('MHF_Steve');
    fs.writeFileSync(file, buf);
  }
  return toDataUrl(fs.readFileSync(file));
}

async function mcProfile(account) {
  const res = await net.request(`${accounts.MC_API}/minecraft/profile`, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
  });
  if (!res.ok) throw new Error(`Не удалось получить профиль (${res.status})`);
  return res.json();
}

// Current skin and capes of the account as data URLs for the 3D preview.
async function current(accountId) {
  const stored = accounts.get(accountId);
  if (!stored) return null;
  if (stored.type !== 'microsoft') return null;
  const account = await accounts.prepareForLaunch(accountId);
  const profile = await mcProfile(account);
  accounts.upsert({ id: account.id, skins: profile.skins, capes: profile.capes });
  const active = profile.skins.find((s) => s.state === 'ACTIVE');
  const capes = await Promise.all(
    (profile.capes || []).map(async (c) => ({
      id: c.id,
      alias: c.alias,
      active: c.state === 'ACTIVE',
      data: toDataUrl(await fetchImage(c.url.replace('http://', 'https://')).catch(() => Buffer.alloc(0))),
    })),
  );
  return {
    editable: true,
    skin: active ? toDataUrl(await fetchImage(active.url.replace('http://', 'https://'))) : null,
    variant: active?.variant?.toLowerCase() === 'slim' ? 'slim' : 'classic',
    capes,
  };
}

async function apply(accountId, skinId) {
  const stored = accounts.get(accountId);
  const skin = readJson(LIBRARY, []).find((s) => s.id === skinId);
  if (!stored || !skin) throw new Error('Скин или аккаунт не найден');
  const account = await accounts.prepareForLaunch(accountId);
  const form = new FormData();
  form.append('variant', skin.variant);
  form.append('file', new Blob([fs.readFileSync(path.join(paths.skins, skin.file))], { type: 'image/png' }), 'skin.png');
  const res = await net.request(`${accounts.MC_API}/minecraft/profile/skins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.accessToken}` },
    body: form,
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'Слишком часто — подождите минуту' : `Mojang отклонил скин (${res.status})`);
  return current(accountId);
}

async function setCape(accountId, capeId) {
  const account = await accounts.prepareForLaunch(accountId);
  if (account.type !== 'microsoft') throw new Error('Плащи доступны только для аккаунтов Microsoft');
  const res = await net.request(`${accounts.MC_API}/minecraft/profile/capes/active`, {
    method: capeId ? 'PUT' : 'DELETE',
    headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
    body: capeId ? JSON.stringify({ capeId }) : undefined,
  });
  if (!res.ok) throw new Error(`Не удалось сменить плащ (${res.status})`);
  return current(accountId);
}

module.exports = { list, addFile, addBuffer, update, remove, importByName, defaultSkin, current, apply, setCape };
