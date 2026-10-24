import { h, icon, btn, iconBtn, clear, toast, api, segmented, slider, switchEl, confirm } from '../ui.js';
import { state, on, saveSettings, refreshAccounts } from '../state.js';
import { ACCENTS, applyTheme, applyWallpaper } from '../theme.js';
import { openAddAccount } from './accounts.js';
import { openCreateDialog } from './create.js';
import { runOnboarding } from './onboarding.js';

const row = (title, sub, control) => h('div.set-row', {}, h('div.li-main', {}, h('div.li-title', {}, title), sub && h('div.li-sub', {}, sub)), control);

// Accent swatches + custom color picker; shared with onboarding.
export function accentPicker(onPick) {
  const el = h('div.swatches');
  const draw = () => {
    clear(el);
    for (const c of ACCENTS) el.append(h(`button.swatch${state.settings.accent === c ? '.on' : ''}`, { style: { background: c }, onclick: () => pick(c) }));
    const custom = h('input', { type: 'color', value: state.settings.accent, oninput: () => pick(custom.value, false) });
    el.append(h('label.swatch-custom', { title: 'Свой цвет' }, icon('colorize'), custom));
  };
  const pick = async (c, redraw = true) => {
    applyTheme({ ...state.settings, accent: c });
    await saveSettings({ accent: c });
    if (redraw) draw();
    onPick?.(c);
  };
  draw();
  return el;
}

export function themePicker() {
  return segmented(
    [
      { value: 'dark', label: 'Тёмная' },
      { value: 'light', label: 'Светлая' },
      { value: 'system', label: 'Системная' },
    ],
    state.settings.theme,
    (v) => saveSettings({ theme: v }),
  );
}

export function settingsView(page, params) {
  const s = state.settings;
  const sections = {};

  // Appearance
  const blurLabel = h('span.tag.primary', {}, `${s.blur}px`);
  const glassLabel = h('span.tag.primary', {}, `${Math.round(s.glass * 100)}%`);
  const live = (patch) => applyTheme({ ...state.settings, ...patch });
  const blur = slider({ min: 0, max: 60, value: s.blur, onInput: (v) => ((blurLabel.textContent = `${v}px`), live({ blur: v })) });
  blur.addEventListener('change', () => saveSettings({ blur: Number(blur.value) }));
  const glass = slider({ min: 0.15, max: 0.95, step: 0.01, value: s.glass, onInput: (v) => ((glassLabel.textContent = `${Math.round(v * 100)}%`), live({ glass: v })) });
  glass.addEventListener('change', () => saveSettings({ glass: Number(glass.value) }));

  sections.appearance = h(
    'div.set-card.glass',
    {},
    h('h3', {}, 'Внешний вид'),
    row('Тема', null, themePicker()),
    row('Акцентный цвет', 'Вся палитра Material 3 строится из него', accentPicker()),
    row(h('span.row', {}, 'Размытие стекла ', blurLabel), 'Сила эффекта frosted glass', h('div.ctl', {}, blur)),
    row(h('span.row', {}, 'Плотность панелей ', glassLabel), 'Насколько панели прозрачны', h('div.ctl', {}, glass)),
    row(
      'Обои',
      'Своя картинка за стеклом (иначе — живая аврора)',
      h(
        'div.row',
        {},
        btn('Выбрать', { kind: 'tonal', icon: 'wallpaper', onClick: async () => applyWallpaper(await api('settings:pickWallpaper')) }),
        btn('Сбросить', { kind: 'text', onClick: async () => (await saveSettings({ wallpaper: '' }), applyWallpaper(null)) }),
      ),
    ),
    row(
      'Меньше анимаций',
      'Отключить движение фона',
      switchEl(!!s.reduceMotion, (v) => (document.body.classList.toggle('reduce-motion', v), saveSettings({ reduceMotion: v }))),
    ),
  );

  // Java
  const memLabel = h('span.tag.primary', {}, `${(s.memoryMax / 1024).toFixed(1)} ГБ`);
  const mem = slider({ min: 1024, max: 32768, step: 512, value: s.memoryMax, onInput: (v) => (memLabel.textContent = `${(v / 1024).toFixed(1)} ГБ`) });
  mem.addEventListener('change', () => saveSettings({ memoryMax: Number(mem.value) }));
  const javaPath = h('input.input', { value: s.javaPath, placeholder: 'Автоматически', onchange: () => saveSettings({ javaPath: javaPath.value.trim() }) });
  const jvm = h('textarea.input', { value: s.jvmArgs, placeholder: 'Дополнительные аргументы для всех сборок', onchange: () => saveSettings({ jvmArgs: jvm.value.trim() }) });
  const javaList = h('div.col', { style: { padding: '0 22px 14px' } });
  sections.java = h(
    'div.set-card.glass',
    {},
    h('h3', {}, 'Java и память'),
    row(h('span.row', {}, 'Память по умолчанию ', memLabel), 'Рекомендуется 4–8 ГБ для модпаков', h('div.ctl', {}, mem)),
    row(
      'Java',
      'WayTester сам скачивает нужную Java (8, 17, 21…) под каждую версию',
      h(
        'div.ctl.row',
        {},
        javaPath,
        iconBtn('folder_open', { title: 'Выбрать', onClick: async () => {
          const p = await api('java:pick');
          if (p) (javaPath.value = p), saveSettings({ javaPath: p });
        } }),
      ),
    ),
    row('Аргументы JVM', null, h('div.ctl', {}, jvm)),
    row(
      'Найденные Java',
      null,
      btn('Найти', {
        kind: 'outlined',
        icon: 'search',
        onClick: async () => {
          clear(javaList).append(h('span.spinner.sm'));
          const list = await api('java:detect');
          clear(javaList).append(
            list.length
              ? list.map((j) => h('div.row', { style: { gap: '8px' } }, h('span.tag', {}, j.source), h('span.tag.primary', {}, j.version || '?'), h('span.small.muted.ellipsis.grow', { title: j.path }, j.path), btn('Использовать', { kind: 'text', onClick: () => ((javaPath.value = j.path), saveSettings({ javaPath: j.path }), toast('Java выбрана')) })))
              : h('div.muted.small', {}, 'Ничего не найдено — Java скачается автоматически'),
          );
        },
      }),
    ),
    javaList,
  );

  // Game
  const width = h('input.input', { type: 'number', value: s.width, onchange: () => saveSettings({ width: Number(width.value) || 1280 }) });
  const height = h('input.input', { type: 'number', value: s.height, onchange: () => saveSettings({ height: Number(height.value) || 720 }) });
  const threads = h('input.input', { type: 'number', min: 1, max: 64, value: s.concurrency, onchange: () => saveSettings({ concurrency: Math.max(1, Math.min(64, Number(threads.value) || 16)) }) });
  sections.game = h(
    'div.set-card.glass',
    {},
    h('h3', {}, 'Игра'),
    row('Размер окна игры', null, h('div.ctl.row', {}, width, h('span.muted', {}, '×'), height)),
    row('Скрывать лаунчер во время игры', 'Окно вернётся после выхода из игры', switchEl(s.closeOnLaunch, (v) => saveSettings({ closeOnLaunch: v }))),
    row('Потоки загрузки', 'Сколько файлов качать одновременно', h('div.ctl', { style: { width: '120px' } }, threads)),
  );

  // Accounts
  const accList = h('div');
  const drawAccounts = () => {
    clear(accList);
    for (const a of state.accounts.list) {
      accList.append(
        row(
          h('span.row', {}, a.name, a.id === state.accounts.selected && h('span.tag.primary', {}, 'Активный')),
          'Microsoft · лицензия',
          h(
            'div.row',
            {},
            a.id !== state.accounts.selected && btn('Выбрать', { kind: 'text', onClick: async () => (await api('accounts:select', a.id), refreshAccounts()) }),
            iconBtn('logout', {
              title: 'Удалить',
              onClick: async () => {
                if (!(await confirm('Выйти из аккаунта?', a.name, { okLabel: 'Выйти' }))) return;
                await api('accounts:remove', a.id);
                refreshAccounts();
              },
            }),
          ),
        ),
      );
    }
  };
  sections.accounts = h(
    'div.set-card.glass',
    {},
    h('h3', {}, 'Аккаунты'),
    accList,
    row('Добавить аккаунт', 'Лицензионный аккаунт Microsoft', btn('Добавить', { kind: 'tonal', icon: 'person_add', onClick: () => openAddAccount() })),
  );

  // Platforms
  const cfKey = h('input.input', { type: 'password', value: s.curseforgeKey, placeholder: 'Встроенный ключ', onchange: () => saveSettings({ curseforgeKey: cfKey.value.trim() }) });
  sections.platforms = h(
    'div.set-card.glass',
    {},
    h('h3', {}, 'Платформы'),
    row('Modrinth', 'Работает без настройки', h('span.tag.primary', {}, icon('check'), 'Подключено')),
    row(
      'CurseForge API key',
      'Работает без настройки. Необязательно: свой ключ с console.curseforge.com',
      h('div.ctl.row', {}, cfKey, iconBtn('open_in_new', { title: 'Получить ключ', onClick: () => api('app:openExternal', 'https://console.curseforge.com/') })),
    ),
  );

  sections.import = h(
    'div.set-card.glass',
    {},
    h('h3', {}, 'Импорт'),
    row('Сборки других лаунчеров', 'Prism, MultiMC, CurseForge App, Modrinth App, ATLauncher, GDLauncher, TLauncher/.minecraft', btn('Импортировать', { kind: 'tonal', icon: 'move_to_inbox', onClick: () => openCreateDialog({ tab: 'import' }) })),
  );

  sections.about = h(
    'div.set-card.glass',
    {},
    h('h3', {}, 'О программе'),
    row('WayTester', `Версия ${state.info.version} · ${state.info.platform}/${state.info.arch}`, btn('Знакомство', { kind: 'text', icon: 'waving_hand', onClick: () => runOnboarding() })),
    row('Папка данных', state.info.dataDir, btn('Открыть', { kind: 'outlined', icon: 'folder_open', onClick: () => api('app:openDataDir') })),
  );

  page.append(
    h('div.page-head', {}, h('div.grow', {}, h('h1.page-title', {}, 'Настройки'))),
    h('div.settings', {}, Object.values(sections)),
  );
  drawAccounts();
  if (params.section && sections[params.section]) setTimeout(() => sections[params.section].scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  return on('accounts', drawAccounts);
}
