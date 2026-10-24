const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { safeStorage, BrowserWindow, session } = require('electron');
const paths = require('./paths');
const net = require('./net');
const { readJson, writeJson } = require('./store');

const MS_OAUTH = require('./oauth.json');
const MS_AUTHORIZE = 'https://login.live.com/oauth20_authorize.srf';
const MS_TOKEN = 'https://login.live.com/oauth20_token.srf';
// Separate cookie jar for the sign-in window, so it can be wiped without touching the launcher.
const MS_PARTITION = 'persist:msa-oauth';
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
  clearMsSession();
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

// Wipes the embedded window's Microsoft cookies so the next sign-in starts from a clean account picker.
function clearMsSession() {
  const part = session.fromPartition(MS_PARTITION);
  return Promise.all([
    part.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'] }),
    part.clearCache(),
  ]).catch(() => {});
}

// Sign-in in an embedded window: login.live.com redirects to oauth20_desktop.srf with ?code=…,
// which we catch before the page loads and exchange for tokens.
async function msStartLogin() {
  const loginId = crypto.randomUUID();
  const pending = { settled: false, exchanging: false, window: null };
  pending.promise = new Promise((resolve, reject) => {
    pending.resolve = resolve;
    pending.reject = reject;
  });
  pending.promise.catch(() => {});
  pendingLogins.set(loginId, pending);

  const win = new BrowserWindow({
    width: 500,
    height: 640,
    title: 'Вход в Microsoft',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { partition: MS_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  pending.window = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    pending.window = null;
    if (!pending.exchanging) settle(loginId, null, new Error('Окно входа закрыто'));
  });

  const onNavigate = async (event, url) => {
    if (pending.exchanging || !url.startsWith(MS_OAUTH.redirectUri)) return;
    const params = new URL(url).searchParams;
    const code = params.get('code');
    const error = params.get('error_description') || params.get('error');
    if (!code && !error) return;
    event?.preventDefault?.();
    pending.exchanging = true;
    if (!win.isDestroyed()) win.destroy();
    if (error) return settle(loginId, null, new Error(error));
    try {
      const { body } = await postForm(MS_TOKEN, {
        client_id: MS_OAUTH.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: MS_OAUTH.redirectUri,
        scope: MS_OAUTH.scope,
      });
      if (body.error) throw new Error(body.error_description || body.error);
      settle(loginId, await msFinish(body.access_token, body.refresh_token));
    } catch (e) {
      settle(loginId, null, e);
    }
  };
  win.webContents.on('will-redirect', onNavigate);
  win.webContents.on('will-navigate', onNavigate);
  win.webContents.on('did-navigate', onNavigate);
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
    // -3 = ERR_ABORTED: navigation we cancelled ourselves on the redirect.
    if (!isMainFrame || errorCode === -3 || pending.exchanging) return;
    settle(loginId, null, new Error(`Не удалось открыть страницу входа Microsoft: ${errorDescription}`));
  });

  const authUrl = `${MS_AUTHORIZE}?${new URLSearchParams({
    client_id: MS_OAUTH.clientId,
    response_type: 'code',
    redirect_uri: MS_OAUTH.redirectUri,
    scope: MS_OAUTH.scope,
    prompt: 'select_account',
  })}`;
  win.loadURL(authUrl).catch(() => {});

  setTimeout(() => settle(loginId, null, new Error('Время на вход истекло')), 15 * 60 * 1000).unref?.();
  return { loginId };
}

function settle(loginId, account, error) {
  const pending = pendingLogins.get(loginId);
  if (!pending || pending.settled) return;
  pending.settled = true;
  if (pending.window && !pending.window.isDestroyed()) pending.window.destroy();
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
    throw new Error(`Minecraft: ошибка входа (${login.status})`);
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
  const { body } = await postForm(MS_TOKEN, {
    grant_type: 'refresh_token',
    client_id: MS_OAUTH.clientId,
    refresh_token: account.refreshToken,
    redirect_uri: MS_OAUTH.redirectUri,
    scope: MS_OAUTH.scope,
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
  msWaitForLogin,
  msCancel,
  prepareForLaunch,
  MC_API,
};
