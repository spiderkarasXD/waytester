const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const QRCode = require('qrcode');
const path = require('path');
const { safeStorage } = require('electron');
const paths = require('./paths');
const net = require('./net');
const { readJson, writeJson, settings } = require('./store');

const MS_SCOPE = 'XboxLive.signin offline_access';
const MS_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const MC_API = 'https://api.minecraftservices.com';

// ---------- storage (tokens encrypted with the OS keychain when available) ----------

function seal(value) {
  if (!value) return value;
  if (safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(value).toString('base64')}`;
  return value;
}

function unseal(value) {
  if (typeof value !== 'string' || !value.startsWith('enc:')) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
  } catch {
    return null;
  }
}

const SECRET_FIELDS = ['accessToken', 'refreshToken'];

function load() {
  const data = readJson(paths.accounts, { selected: null, list: [] });
  data.list = data.list.map((a) => {
    const out = { ...a };
    for (const f of SECRET_FIELDS) out[f] = unseal(a[f]);
    return out;
  });
  return data;
}

function save(data) {
  writeJson(paths.accounts, {
    selected: data.selected,
    list: data.list.map((a) => {
      const out = { ...a };
      for (const f of SECRET_FIELDS) out[f] = seal(a[f]);
      return out;
    }),
  });
}

// What the UI may see: no tokens.
function publicView(a) {
  const { accessToken, refreshToken, ...rest } = a;
  return rest;
}

function list() {
  const data = load();
  return { selected: data.selected, list: data.list.filter((a) => a.type === 'microsoft').map(publicView) };
}

function upsert(account) {
  const data = load();
  const i = data.list.findIndex((a) => a.id === account.id);
  if (i >= 0) data.list[i] = { ...data.list[i], ...account };
  else data.list.push(account);
  if (!data.selected) data.selected = account.id;
  save(data);
  return publicView(account);
}

function remove(id) {
  const data = load();
  data.list = data.list.filter((a) => a.id !== id);
  if (data.selected === id) data.selected = data.list[0]?.id || null;
  save(data);
}

function select(id) {
  const data = load();
  data.selected = id;
  save(data);
}

function get(id) {
  return load().list.find((a) => a.id === id) || null;
}

// ---------- Microsoft ----------

const pendingLogins = new Map();

// Client ID shipped with the build (oauth.json / env), overridable in settings for advanced users.
function msClientId() {
  let bundled = '';
  try {
    bundled = require('./oauth.json').clientId || '';
  } catch {}
  const id = (settings.get().msClientId || process.env.WAYTESTER_CLIENT_ID || bundled).trim();
  if (!id) {
    const err = new Error('В этой сборке WayTester не задан Microsoft Client ID (src/main/oauth.json)');
    err.code = 'NO_CLIENT_ID';
    throw err;
  }
  return id;
}

function hasClientId() {
  try {
    return !!msClientId();
  } catch {
    return false;
  }
}

async function postForm(url, form) {
  const res = await net.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function postJson(url, body, headers = {}) {
  const res = await net.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: data };
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const DONE_PAGE = (ok, text) => `<!doctype html><html lang="ru"><meta charset="utf-8"><title>WayTester</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:radial-gradient(circle at 30% 20%,#3b2d7a,#0d1017 60%);color:#e8e8f4">
<div style="text-align:center;padding:40px 48px;border-radius:28px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(20px)">
<div style="font-size:56px">${ok ? '&#9989;' : '&#9888;&#65039;'}</div><h1 style="font-weight:500;margin:10px 0 6px">${ok ? 'Вход выполнен' : 'Не получилось войти'}</h1>
<p style="opacity:.75;margin:0">${text}</p></div></body></html>`;

// Prism-style sign-in: the system browser does an auth-code (PKCE) login with a loopback redirect,
// while a device code + QR is offered in parallel for signing in from another device.
async function msStartLogin() {
  const clientId = msClientId();
  const loginId = crypto.randomUUID();
  const pending = { clientId, settled: false, server: null };
  pending.promise = new Promise((resolve, reject) => {
    pending.resolve = resolve;
    pending.reject = reject;
  });
  pending.promise.catch(() => {});
  pendingLogins.set(loginId, pending);

  // 1) system browser + loopback redirect
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const oauthState = b64url(crypto.randomBytes(16));
  const server = http.createServer();
  pending.server = server;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://localhost:${server.address().port}`;
  server.on('request', async (req, res) => {
    const url = new URL(req.url, redirectUri);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error_description') || url.searchParams.get('error');
    if (url.pathname !== '/' || url.searchParams.get('state') !== oauthState || (!code && !error)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (error) {
      res.end(DONE_PAGE(false, 'Закройте вкладку и попробуйте ещё раз в WayTester.'));
      settle(loginId, null, new Error(error));
      return;
    }
    res.end(DONE_PAGE(true, 'Можно закрыть вкладку и вернуться в WayTester.'));
    try {
      const { body } = await postForm(`${MS_BASE}/token`, {
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        scope: MS_SCOPE,
      });
      if (body.error) throw new Error(body.error_description || body.error);
      settle(loginId, await msFinish(body.access_token, body.refresh_token));
    } catch (e) {
      settle(loginId, null, e);
    }
  });
  const authUrl = `${MS_BASE}/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: MS_SCOPE,
    state: oauthState,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })}`;

  // 2) device code for another device (skipped if the app registration doesn't allow it)
  let device = null;
  const dc = await postForm(`${MS_BASE}/devicecode`, { client_id: clientId, scope: MS_SCOPE }).catch(() => null);
  if (dc?.status === 200) {
    const link = dc.body.verification_uri;
    device = {
      userCode: dc.body.user_code,
      url: link,
      qr: await QRCode.toDataURL(`${link}?otc=${dc.body.user_code}`, { margin: 1, width: 220, color: { dark: '#111318', light: '#ffffff' } }),
    };
    pollDeviceCode(loginId, dc.body).catch((e) => settle(loginId, null, e));
  }

  setTimeout(() => settle(loginId, null, new Error('Время на вход истекло')), 15 * 60 * 1000).unref?.();
  return { loginId, authUrl, device };
}

async function pollDeviceCode(loginId, dc) {
  const pending = pendingLogins.get(loginId);
  let interval = (dc.interval || 5) * 1000;
  const deadline = Date.now() + dc.expires_in * 1000;
  while (pending && !pending.settled && Date.now() < deadline) {
    await net.sleep(interval);
    if (pending.settled) return;
    const { body } = await postForm(`${MS_BASE}/token`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: pending.clientId,
      device_code: dc.device_code,
    });
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    if (body.error === 'expired_token') return;
    if (body.error) throw new Error(body.error_description || body.error);
    if (!pending.settled) settle(loginId, await msFinish(body.access_token, body.refresh_token));
    return;
  }
}

function settle(loginId, account, error) {
  const pending = pendingLogins.get(loginId);
  if (!pending || pending.settled) return;
  pending.settled = true;
  pending.server?.close();
  pendingLogins.delete(loginId);
  if (error) pending.reject(error);
  else pending.resolve(publicView(account));
}

function msCancel(loginId) {
  settle(loginId, null, new Error('Вход отменён'));
}

async function msWaitForLogin(loginId) {
  const pending = pendingLogins.get(loginId);
  if (!pending) throw new Error('Сессия входа не найдена');
  return pending.promise;
}

const XSTS_ERRORS = {
  2148916233: 'У этой учётной записи Microsoft нет профиля Xbox. Зайдите на xbox.com и создайте его.',
  2148916235: 'Xbox Live недоступен в вашей стране.',
  2148916236: 'Требуется подтверждение возраста на xbox.com.',
  2148916237: 'Требуется подтверждение возраста на xbox.com.',
  2148916238: 'Детский аккаунт: добавьте его в семью Microsoft.',
};

async function msFinish(msAccessToken, msRefreshToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  if (xbl.status !== 200) throw new Error('Xbox Live: ошибка авторизации');
  const uhs = xbl.body.DisplayClaims.xui[0].uhs;

  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.body.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  if (xsts.status !== 200) throw new Error(XSTS_ERRORS[xsts.body.XErr] || `XSTS: ошибка ${xsts.body.XErr || xsts.status}`);

  const login = await postJson(`${MC_API}/authentication/login_with_xbox`, {
    identityToken: `XBL3.0 x=${uhs};${xsts.body.Token}`,
  });
  if (login.status !== 200) {
    throw new Error(
      login.status === 403
        ? 'Minecraft API отклонил Client ID: приложение Azure должно быть одобрено Mojang (aka.ms/mce-reviewappid)'
        : `Minecraft: ошибка входа (${login.status})`,
    );
  }
  const mcToken = login.body.access_token;
  const profileRes = await net.request(`${MC_API}/minecraft/profile`, { headers: { Authorization: `Bearer ${mcToken}` } });
  if (profileRes.status === 404) throw new Error('На этом аккаунте не куплен Minecraft: Java Edition');
  const profile = await profileRes.json();
  const uuid = profile.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  return upsert({
    id: `ms:${profile.id}`,
    type: 'microsoft',
    name: profile.name,
    uuid,
    xuid: uhs,
    accessToken: mcToken,
    refreshToken: msRefreshToken,
    expiresAt: Date.now() + (login.body.expires_in - 60) * 1000,
    skins: profile.skins,
    capes: profile.capes,
    added: Date.now(),
  });
}

async function msRefresh(account) {
  const clientId = msClientId();
  const { body } = await postForm(`${MS_BASE}/token`, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: account.refreshToken,
    scope: MS_SCOPE,
  });
  if (body.error) throw new Error('Сессия Microsoft истекла — войдите заново');
  return msFinish(body.access_token, body.refresh_token);
}

// Returns an account with fresh tokens, ready for launching.
async function prepareForLaunch(id) {
  const account = get(id);
  if (!account) throw new Error('Выберите аккаунт');
  if (account.type !== 'microsoft') throw new Error('Поддерживаются только лицензионные аккаунты Microsoft');
  if (Date.now() < (account.expiresAt || 0)) return account;
  return get((await msRefresh(account)).id);
}

module.exports = {
  list,
  remove,
  select,
  get,
  upsert,
  msStartLogin,
  hasClientId,
  msWaitForLogin,
  msCancel,
  prepareForLaunch,
  MC_API,
};
