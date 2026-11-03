const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nativeImage } = require('electron');
const paths = require('./paths');
const { settings } = require('./store');

const LIMIT = 20 * 1024 * 1024;
const TYPES = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' };
let pending = null;

function readImage(file) {
  const ext = path.extname(file).toLowerCase();
  if (!TYPES[ext]) throw new Error('Выберите PNG, JPG или WebP');
  if (fs.statSync(file).size > LIMIT) throw new Error('Изображение должно быть не больше 20 МБ');
  const bytes = fs.readFileSync(file);
  if (bytes.length > LIMIT) throw new Error('Изображение должно быть не больше 20 МБ');
  // nativeImage handles PNG/JPEG; Chromium validates WebP before commit.
  const valid = ext === '.webp'
    ? bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    : !nativeImage.createFromBuffer(bytes).isEmpty();
  if (!valid) throw new Error('Не удалось прочитать изображение — выберите другой файл');
  return { ext, bytes, data: `data:image/${TYPES[ext]};base64,${bytes.toString('base64')}` };
}

function stageWallpaper(source) {
  pending = { ...readImage(source), name: path.basename(source), token: crypto.randomUUID() };
  return { token: pending.token, data: pending.data };
}

function commitWallpaper(token) {
  if (!pending || pending.token !== token) throw new Error('Выберите изображение заново');
  const { ext, bytes, data, name } = pending;
  pending = null;
  const previous = settings.get().wallpaper;
  const dest = path.join(paths.root, `wallpaper-${crypto.randomUUID()}${ext}`);
  try {
    fs.writeFileSync(dest, bytes, { flag: 'wx' });
    settings.set({ wallpaper: dest, wallpaperName: name });
  } catch (error) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    throw error;
  }
  // Only obsolete copies created by the launcher can be removed.
  if (previous && path.dirname(path.resolve(previous)) === path.resolve(paths.root) &&
      /^wallpaper(?:-[0-9a-f-]{36})?\.(png|jpe?g|webp)$/i.test(path.basename(previous))) {
    try { fs.unlinkSync(previous); } catch { /* The new wallpaper is already saved. */ }
  }
  return data;
}

function wallpaperData() {
  const file = settings.get().wallpaper;
  if (!file || !fs.existsSync(file)) return null;
  try { return readImage(file).data; } catch { return null; }
}

module.exports = { stageWallpaper, commitWallpaper, discardWallpaper: () => { pending = null; }, wallpaperData };
