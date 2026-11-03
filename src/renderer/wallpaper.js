import { h, icon, btn, slider, segmented, api, toast } from './ui.js';
import { state, saveSettings, emit } from './state.js';
import { applyTheme, applyWallpaper, getWallpaper } from './theme.js';

// The preview uses the same material and theme tokens as the actual launcher.
export function wallpaperSettings() {
  const image = h('img', { alt: 'Выбранные обои', hidden: true });
  const empty = h('div.wallpaper-empty', {}, icon('wallpaper'), 'Выберите фон для своего лаунчера');
  const preview = h('div.wallpaper-preview.empty', {}, image, h('div.wallpaper-preview-scrim'), empty,
    h('div.preview-window', {},
      h('span.preview-icon', {}, icon('deployed_code')),
      h('div', {}, h('strong', {}, 'WayTester'), h('span.small', {}, 'Матовые панели поверх ваших обоев')),
      h('span.preview-play', {}, icon('play_arrow')),
    ),
  );
  const filename = h('span.wallpaper-filename.ellipsis');
  const choose = btn('Выбрать изображение', {
    kind: 'tonal', icon: 'add_photo_alternate',
    onClick: async () => {
      choose.disabled = true;
      try {
        const candidate = await api('settings:pickWallpaper');
        if (!candidate) return; // Cancel preserves both the saved and visible wallpaper.
        const decoded = new Image();
        decoded.src = candidate.data;
        try { await decoded.decode(); }
        catch { throw new Error('Не удалось прочитать изображение — выберите другой файл'); }
        const data = await api('settings:commitWallpaper', candidate.token);
        state.settings = await api('settings:get');
        emit('settings');
        applyWallpaper(data);
      } catch (error) {
        await api('settings:discardWallpaper').catch(() => {});
        toast(error.message, { error: true });
      } finally { choose.disabled = false; }
    },
  });
  const reset = btn('Убрать', {
    kind: 'text',
    onClick: async () => {
      reset.disabled = true;
      try {
        await saveSettings({ wallpaper: '', wallpaperName: '' });
        applyWallpaper('');
      } catch (error) { toast(error.message, { error: true }); }
      finally { draw(); }
    },
  });
  const draw = () => {
    const data = getWallpaper();
    image.hidden = !data;
    if (data) image.src = data;
    else image.removeAttribute('src');
    empty.hidden = !!data;
    preview.classList.toggle('empty', !data);
    reset.disabled = !data && !state.settings.wallpaper;
    filename.textContent = state.settings.wallpaperName || state.settings.wallpaper?.split(/[\\/]/).pop() || 'PNG, JPG или WebP · до 20 МБ';
    filename.title = filename.textContent;
  };
  const dimLabel = h('span', {}, `${Math.round((state.settings.wallpaperDim ?? 0.24) * 100)}%`);
  const dim = slider({ min: 0, max: 80, step: 1, value: Math.round((state.settings.wallpaperDim ?? 0.24) * 100), onInput: v => {
    dimLabel.textContent = `${v}%`;
    applyTheme({ ...state.settings, wallpaperDim: v / 100 });
  } });
  dim.setAttribute('aria-label', 'Затемнение обоев');
  dim.addEventListener('change', () => saveSettings({ wallpaperDim: Number(dim.value) / 100 }));
  const fit = segmented([
    { value: 'cover', label: 'Заполнить' },
    { value: 'contain', label: 'Вписать' },
  ], state.settings.wallpaperFit || 'cover', value => saveSettings({ wallpaperFit: value }));
  const element = h('div.wallpaper-settings', {},
    h('div.wallpaper-heading', {}, h('div.grow', {}, h('h4', {}, 'Обои'), h('p', {}, 'Свой фон за матовым стеклом'))),
    preview,
    h('div.wallpaper-actions', {}, choose, reset, filename),
    h('div.wallpaper-options', {},
      h('div.set-row', {}, h('div.li-main', {}, h('div.li-title', {}, 'Масштаб изображения')), fit),
      h('div.set-row', {}, h('div.li-main', {}, h('div.li-title.row', {}, 'Приглушение фона', dimLabel), h('div.li-sub', {}, 'Затемняет в тёмной теме, осветляет в светлой')), h('div.ctl', {}, dim)),
    ),
  );
  window.addEventListener('wallpaperchange', draw);
  draw();
  return { element, dispose: () => window.removeEventListener('wallpaperchange', draw) };
}
