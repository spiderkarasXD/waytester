// Generates Material 3–style tonal tokens from a single accent color.

function hexToHsl(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
  }
  return [hue, s * 100, l * 100];
}

const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360}, ${Math.max(0, Math.min(100, s))}%, ${l}%, ${a})`;

export const ACCENTS = ['#8ab4ff', '#a78bfa', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#94a3b8'];

let mediaListener = null;

export function applyTheme(settings) {
  const [h, sRaw] = hexToHsl(settings.accent || '#8ab4ff');
  const s = Math.max(35, Math.min(92, sRaw));
  const glass = settings.glass ?? 0.55;
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)');
  const light = settings.theme === 'light' || (settings.theme === 'system' && prefersLight.matches);

  if (mediaListener) prefersLight.removeEventListener('change', mediaListener);
  if (settings.theme === 'system') {
    mediaListener = () => applyTheme(settings);
    prefersLight.addEventListener('change', mediaListener);
  }

  const t = light
    ? {
        primary: hsl(h, s * 0.85, 38),
        'on-primary': '#ffffff',
        'primary-container': hsl(h, s, 89),
        'on-primary-container': hsl(h, s, 14),
        'secondary-container': hsl(h, 38, 86, 0.9),
        'on-secondary-container': hsl(h, 30, 16),
        tertiary: hsl(h + 60, 45, 44),
        surface: hsl(h, 35, 98, glass),
        'surface-low': hsl(h, 30, 96, glass * 0.9),
        'surface-high': hsl(h, 28, 95, Math.min(1, glass + 0.1)),
        'surface-highest': hsl(h, 22, 88, 0.85),
        'on-surface': hsl(h, 18, 11),
        'on-surface-variant': hsl(h, 9, 36),
        outline: 'rgba(20, 24, 40, 0.10)',
        'outline-strong': 'rgba(20, 24, 40, 0.22)',
        scrim: 'rgba(30, 34, 50, 0.25)',
        error: '#ba1a1a',
        'error-container': '#ffdad6',
        success: '#1f8a4c',
        warning: '#9a6a00',
        'bg-0': hsl(h, 32, 91),
        shine: 'rgba(255, 255, 255, 0.55)',
        'aurora-1': hsl(h, 85, 72),
        'aurora-2': hsl(h + 60, 75, 76),
        'aurora-3': hsl(h - 50, 75, 74),
      }
    : {
        primary: hsl(h, s, 80),
        'on-primary': hsl(h, s, 16),
        'primary-container': hsl(h, s * 0.55, 30),
        'on-primary-container': hsl(h, s, 91),
        'secondary-container': hsl(h, 20, 28, 0.9),
        'on-secondary-container': hsl(h, 32, 90),
        tertiary: hsl(h + 60, s * 0.65, 80),
        surface: hsl(h, 16, 10, glass),
        'surface-low': hsl(h, 16, 7, glass * 0.9),
        'surface-high': hsl(h, 16, 15, Math.min(1, glass + 0.08)),
        'surface-highest': hsl(h, 15, 23, 0.75),
        'on-surface': hsl(h, 18, 92),
        'on-surface-variant': hsl(h, 10, 72),
        outline: 'rgba(255, 255, 255, 0.10)',
        'outline-strong': 'rgba(255, 255, 255, 0.22)',
        scrim: 'rgba(4, 6, 10, 0.55)',
        error: '#ffb4ab',
        'error-container': '#93000a',
        success: '#8fdba6',
        warning: '#f3c56b',
        'bg-0': hsl(h, 28, 6),
        shine: 'rgba(255, 255, 255, 0.06)',
        'aurora-1': hsl(h, 75, 45),
        'aurora-2': hsl(h + 60, 65, 40),
        'aurora-3': hsl(h - 50, 65, 38),
      };

  const root = document.documentElement;
  for (const [k, v] of Object.entries(t)) root.style.setProperty(`--${k}`, v);
  root.style.setProperty('--blur', `${settings.blur ?? 28}px`);
  root.style.setProperty('--glass', glass);
  root.style.colorScheme = light ? 'light' : 'dark';
  document.body.classList.toggle('light', light);
}

export function applyWallpaper(dataUrl) {
  const el = document.querySelector('.wallpaper');
  if (dataUrl) {
    el.style.backgroundImage = `url("${dataUrl}")`;
    el.classList.add('on');
  } else {
    el.classList.remove('on');
    el.style.backgroundImage = '';
  }
  document.body.classList.toggle('has-wallpaper', !!dataUrl);
}
