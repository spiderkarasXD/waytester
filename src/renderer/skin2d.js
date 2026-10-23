// 2D renders of skin textures for avatars, library tiles and cape thumbnails.

const cache = new Map();

export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

function ctx2d(canvas, w, hgt) {
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, hgt);
  return ctx;
}

export async function drawHead(canvas, src) {
  const img = await loadImage(src);
  const ctx = ctx2d(canvas, 8, 8);
  if (!img) {
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(0, 0, 8, 8);
    return;
  }
  ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
  ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
}

// Front view of the whole body (16×32 texture pixels).
export async function drawBody(canvas, src, slim = false) {
  const img = await loadImage(src);
  const ctx = ctx2d(canvas, 16, 32);
  if (!img) return;
  const legacy = img.height === 32;
  const aw = slim ? 3 : 4;
  const part = (sx, sy, w, hh, dx, dy, mirror = false) => {
    if (mirror) {
      ctx.save();
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, w, hh, 0, 0, w, hh);
      ctx.restore();
    } else ctx.drawImage(img, sx, sy, w, hh, dx, dy, w, hh);
  };
  // base layer
  part(8, 8, 8, 8, 4, 0);
  part(20, 20, 8, 12, 4, 8);
  part(44, 20, aw, 12, 4 - aw, 8);
  if (legacy) part(44, 20, aw, 12, 12, 8, true);
  else part(36, 52, aw, 12, 12, 8);
  part(4, 20, 4, 12, 4, 20);
  if (legacy) part(4, 20, 4, 12, 8, 20, true);
  else part(20, 52, 4, 12, 8, 20);
  // overlay layer
  part(40, 8, 8, 8, 4, 0);
  if (!legacy) {
    part(20, 36, 8, 12, 4, 8);
    part(44, 36, aw, 12, 4 - aw, 8);
    part(52, 52, aw, 12, 12, 8);
    part(4, 36, 4, 12, 4, 20);
    part(4, 52, 4, 12, 8, 20);
  }
}

export async function drawCape(canvas, src) {
  const img = await loadImage(src);
  const ctx = ctx2d(canvas, 10, 16);
  if (!img) return;
  const k = img.width / 64;
  ctx.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, 10, 16);
}
