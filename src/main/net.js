const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const UA = 'WayTester/1.0.0 (Minecraft launcher)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, opts = {}, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} — ${url}`);
        await sleep(600 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function getJson(url, opts) {
  const res = await request(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${url}${body ? `: ${body.slice(0, 300)}` : ''}`);
  }
  return res.json();
}

async function getText(url, opts) {
  const res = await request(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.text();
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// A file counts as present when its size matches; the hash is only checked when no size is known.
async function isValid(file, sha1, size) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  if (size) return stat.size === size;
  if (sha1) return (await sha1File(file)) === sha1;
  return stat.size > 0;
}

async function download({ url, path: dest, sha1, size }, onBytes) {
  if (await isValid(dest, sha1, size)) return false;
  if (!url) throw new Error(`Нет ссылки для загрузки: ${path.basename(dest)}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.part`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await request(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
      const hash = crypto.createHash('sha1');
      const body = Readable.fromWeb(res.body);
      body.on('data', (chunk) => {
        hash.update(chunk);
        onBytes?.(chunk.length);
      });
      await pipeline(body, fs.createWriteStream(tmp));
      const digest = hash.digest('hex');
      if (sha1 && digest !== sha1) throw new Error(`Контрольная сумма не совпала: ${path.basename(dest)}`);
      await fsp.rename(tmp, dest);
      return true;
    } catch (e) {
      lastErr = e;
      await fsp.rm(tmp, { force: true });
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Downloads a list of files with a worker pool, reporting progress as (doneCount, total).
async function downloadAll(tasks, { concurrency = 16, onProgress } = {}) {
  const unique = [...new Map(tasks.map((t) => [t.path, t])).values()];
  let index = 0;
  let done = 0;
  const errors = [];
  onProgress?.(0, unique.length);
  async function worker() {
    while (index < unique.length) {
      const task = unique[index++];
      try {
        await download(task);
      } catch (e) {
        errors.push(e);
      }
      done++;
      onProgress?.(done, unique.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  if (errors.length) {
    const err = new Error(`Не удалось скачать ${errors.length} файл(ов): ${errors[0].message}`);
    err.errors = errors;
    throw err;
  }
}

module.exports = { UA, request, getJson, getText, download, downloadAll, sha1File, isValid, sleep };
