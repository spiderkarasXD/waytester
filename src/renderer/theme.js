// Material You tonal roles: quiet surfaces, one personal accent.
function hexToHsl(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return [h, s * 100, l * 100];
}
const clamp = (v, min, max, fallback) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : fallback));
const hsl = (h, s, l, a = 1) => 'hsla(' + h + ', ' + s + '%, ' + l + '%, ' + a + ')';

// Keep white labels readable even for bright yellow custom accents.
function accessibleLightTone(h, s) {
  for (let tone = 38; tone >= 16; tone--) {
    const l = tone / 100, a = s / 100 * Math.min(l, 1 - l);
    const rgb = [0, 8, 4].map(n => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    if (1.05 / (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] + 0.05) >= 4.5) return tone;
  }
  return 16;
}

export const ACCENTS = ['#a8c7a0', '#8ab4ff', '#c2b1e1', '#e9b6c3', '#e8b49a', '#ddc884', '#90cfc6', '#aab7c4'];
let mediaListener = null;
const prefersLight = window.matchMedia('(prefers-color-scheme: light)');

export function applyTheme(settings) {
  const accent = /^#[\da-f]{6}$/i.test(settings.accent) ? settings.accent : '#a8c7a0';
  const [h, rawS] = hexToHsl(accent), s = clamp(rawS, 24, 75, 35);
  const glass = clamp(settings.glass, 0.45, 0.95, 0.72);
  const dim = clamp(settings.wallpaperDim, 0, 0.8, 0.24);
  const light = settings.theme === 'light' || (settings.theme === 'system' && prefersLight.matches);
  if (mediaListener) prefersLight.removeEventListener('change', mediaListener);
  mediaListener = settings.theme === 'system' ? () => applyTheme(settings) : null;
  if (mediaListener) prefersLight.addEventListener('change', mediaListener);

  const t = light ? {
    primary: hsl(h, s, accessibleLightTone(h, s)), 'on-primary': '#ffffff',
    'primary-container': hsl(h, s * 0.6, 88), 'on-primary-container': hsl(h, 24, 18),
    'secondary-container': hsl(h, 16, 88, 0.96), 'on-secondary-container': hsl(h, 16, 22),
    surface: hsl(h, 8, 99, glass), 'surface-low': hsl(h, 6, 95, Math.min(1, glass + 0.04)),
    'surface-high': hsl(h, 6, 100, Math.min(1, glass + 0.14)), 'surface-highest': hsl(h, 6, 91, 0.96),
    'surface-overlay': hsl(h, 5, 98, 0.97),
    'on-surface': '#1b201c', 'on-surface-variant': '#505952', 'on-surface-muted': '#626d65',
    outline: 'rgba(27, 32, 28, 0.09)', 'outline-strong': 'rgba(27, 32, 28, 0.20)',
    scrim: 'rgba(18, 22, 19, 0.32)', error: '#a72e28', 'error-container': '#ffdad6',
    success: '#326b40', warning: '#795a13', 'bg-0': hsl(h, 7, 91),
    shine: 'rgba(20, 30, 24, 0.04)', 'wallpaper-scrim-color': 'rgba(245, 247, 244, ' + dim + ')',
  } : {
    primary: hsl(h, s, 80), 'on-primary': '#162018',
    'primary-container': hsl(h, s * 0.3, 25), 'on-primary-container': hsl(h, s * 0.6, 88),
    'secondary-container': hsl(h, 10, 26, 0.96), 'on-secondary-container': hsl(h, 16, 88),
    surface: hsl(h, 5, 11, glass), 'surface-low': hsl(h, 5, 8, Math.min(1, glass + 0.04)),
    'surface-high': hsl(h, 5, 16, Math.min(1, glass + 0.14)), 'surface-highest': hsl(h, 5, 22, 0.96),
    'surface-overlay': hsl(h, 5, 14, 0.97),
    'on-surface': '#e5e9e3', 'on-surface-variant': '#b8c0b7', 'on-surface-muted': '#9ca69b',
    outline: 'rgba(229, 233, 227, 0.09)', 'outline-strong': 'rgba(229, 233, 227, 0.20)',
    scrim: 'rgba(6, 9, 7, 0.58)', error: '#ffb4ab', 'error-container': '#70312c',
    success: '#9ac9a1', warning: '#e0c588', 'bg-0': hsl(h, 5, 7),
    shine: 'rgba(229, 233, 227, 0.05)', 'wallpaper-scrim-color': 'rgba(8, 12, 9, ' + dim + ')',
  };
  t.tertiary = t.primary;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t)) root.style.setProperty('--' + k, v);
  root.style.setProperty('--blur', clamp(settings.blur, 0, 60, 28) + 'px');
  root.style.setProperty('--glass', glass);
  root.style.setProperty('--wallpaper-fit', settings.wallpaperFit === 'contain' ? 'contain' : 'cover');
  root.style.colorScheme = light ? 'light' : 'dark';
  document.body.classList.toggle('light', light);
  document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);
}

let currentWallpaper = '';
let wallpaperLayer = 0;
export const getWallpaper = () => currentWallpaper;
export function applyWallpaper(dataUrl) {
  const next = typeof dataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,[\da-z+/=\s]+$/i.test(dataUrl) ? dataUrl : '';
  if (next === currentWallpaper) return;
  currentWallpaper = next;
  const layers = [...document.querySelectorAll('.wallpaper')];
  if (currentWallpaper) {
    wallpaperLayer = (wallpaperLayer + 1) % layers.length;
    const incoming = layers[wallpaperLayer];
    incoming.style.backgroundImage = 'url("' + currentWallpaper + '")';
    // Keep the entering image above the old one while it becomes opaque.
    layers.forEach(el => {
      el.style.zIndex = el === incoming ? '1' : '0';
      el.classList.toggle('on', el === incoming);
    });
  } else layers.forEach(el => el.classList.remove('on'));
  document.body.classList.toggle('has-wallpaper', !!currentWallpaper);
  window.dispatchEvent(new Event('wallpaperchange'));
}
