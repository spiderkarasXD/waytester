import { h, icon, btn, clear, api, loaderTag } from '../ui.js';
import { state, saveSettings, refreshInstances } from '../state.js';
import { navigate } from '../app.js';
import { accountForms } from './accounts.js';
import { accentPicker, themePicker } from './settings.js';
import { openCreateDialog } from './create.js';

// First-run wizard: welcome → look → account → import → done.
export function runOnboarding() {
  const root = h('div.onboarding');
  const card = h('div.ob-card.glass');
  root.append(card);
  document.body.append(root);

  const STEPS = 5;
  let step = 0;
  let found = null;
  const picked = new Set();

  const finish = async (then) => {
    await saveSettings({ onboarded: true });
    root.classList.add('closing');
    setTimeout(() => root.remove(), 340);
    await refreshInstances();
    then?.();
  };

  const nav = (actions) =>
    h('div.ob-nav', {}, h('div.ob-dots', {}, Array.from({ length: STEPS }, (_, i) => h(`span${i === step ? '.on' : ''}`))), ...actions);

  const next = () => go(step + 1);
  const back = () => go(step - 1);
  const go = (i) => {
    step = i;
    clear(card);
    card.append(render[i]());
  };

  const render = [
    () =>
      h(
        'div.ob-step',
        {},
        h('img.ob-logo', { src: 'icon.svg', alt: '' }),
        h('h1.ob-title', {}, 'Добро пожаловать в ', h('span.grad', {}, 'WayTester')),
        h('p.ob-text', {}, 'Красивый лаунчер Minecraft: моды и модпаки в пару кликов, любые загрузчики, 3D-примерка скинов и перенос сборок из других лаунчеров.'),
        h(
          'div.ob-features',
          {},
          [
            ['layers', 'Fabric, Forge, NeoForge, Quilt, OptiFine'],
            ['travel_explore', 'Modrinth и CurseForge'],
            ['checkroom', 'Скины и плащи в 3D'],
            ['move_to_inbox', 'Импорт из Prism, CurseForge, Modrinth App'],
            ['coffee', 'Java скачивается сама'],
            ['computer', 'Windows, Linux и macOS'],
          ].map(([ic, t]) => h('div.ob-feature', {}, icon(ic), h('span', {}, t))),
        ),
        h('div.grow'),
        nav([btn('Пропустить', { kind: 'text', onClick: () => finish() }), btn('Начать', { icon: 'arrow_forward', onClick: next })]),
      ),

    () =>
      h(
        'div.ob-step',
        {},
        h('h1.ob-title', { style: { fontSize: '32px' } }, 'Ваш стиль'),
        h('p.ob-text', {}, 'Выберите тему и акцентный цвет — палитра Material 3 и стеклянные панели подстроятся под него. Это можно поменять позже в настройках.'),
        h('div.field', {}, h('label', {}, 'Тема'), h('div', {}, themePicker())),
        h('div.field', {}, h('label', {}, 'Акцент'), accentPicker()),
        h(
          'div.row',
          { style: { gap: '10px', marginTop: '6px' } },
          h('div.glass', { style: { flex: 1, borderRadius: '20px', padding: '16px', display: 'flex', gap: '12px', alignItems: 'center' } }, h('div.inst-icon', { style: { width: '56px', height: '56px', borderRadius: '16px', fontSize: '26px', '--h': 200 } }, icon('texture')), h('div.grow', {}, h('div', { style: { fontWeight: 600 } }, 'Пример сборки'), h('div.row', { style: { gap: '6px', marginTop: '6px' } }, h('span.tag', {}, '1.21.1'), loaderTag('fabric'))), btn('Играть', { icon: 'play_arrow', kind: 'play' })),
        ),
        h('div.grow'),
        nav([btn('Назад', { kind: 'text', onClick: back }), btn('Далее', { icon: 'arrow_forward', onClick: next })]),
      ),

    () => {
      const host = h('div');
      const actions = h('div.row');
      const wrapper = h(
        'div.ob-step',
        {},
        h('h1.ob-title', { style: { fontSize: '32px' } }, 'Аккаунт'),
        h('p.ob-text', {}, state.accounts.list.length ? `Уже добавлено: ${state.accounts.list.map((a) => a.name).join(', ')}. Можно добавить ещё один.` : 'Войдите в лицензионный аккаунт Microsoft с купленной Minecraft: Java Edition — скин, плащи и онлайн-серверы подтянутся автоматически.'),
        host,
        h('div.grow'),
        nav([btn('Назад', { kind: 'text', onClick: back }), actions, btn(state.accounts.list.length ? 'Далее' : 'Пропустить', { kind: state.accounts.list.length ? 'filled' : 'text', icon: state.accounts.list.length ? 'arrow_forward' : null, onClick: next })]),
      );
      accountForms(host, () => next(), (list) => clear(actions).append(...list));
      return wrapper;
    },

    () => {
      const listEl = h('div.found-list', {}, h('div.row', { style: { padding: '24px', justifyContent: 'center' } }, h('span.spinner.sm'), h('span.muted', {}, 'Ищем сборки Prism, CurseForge, Modrinth App, ATLauncher, GDLauncher и .minecraft…')));
      const importBtn = btn('Импортировать выбранные', {
        icon: 'move_to_inbox',
        disabled: true,
        onClick: async () => {
          for (const f of found.filter((_, i) => picked.has(i))) api('import:folder', f).catch(() => {});
          next();
        },
      });
      const drawFound = () => {
        clear(listEl);
        if (!found.length) {
          listEl.append(h('div.muted', { style: { padding: '24px', textAlign: 'center' } }, 'Сборок других лаунчеров не найдено. Их всегда можно перетащить в окно WayTester.'));
          return;
        }
        found.forEach((f, i) => {
          const cb = h('input', { type: 'checkbox', checked: picked.has(i), style: { width: '18px', height: '18px', accentColor: 'var(--primary)' }, onchange: () => (cb.checked ? picked.add(i) : picked.delete(i), (importBtn.disabled = !picked.size)) });
          listEl.append(h('label.list-item', { style: { cursor: 'pointer' } }, cb, h('div.li-main', {}, h('div.li-title.ellipsis', {}, f.name), h('div.row.wrap', { style: { gap: '6px', marginTop: '4px' } }, h('span.tag.primary', {}, f.launcher), h('span.tag', {}, f.gameVersion), loaderTag(f.loader, f.loaderVersion)))));
        });
        importBtn.disabled = !picked.size;
      };
      (found ? Promise.resolve(found) : api('import:scan').catch(() => []))
        .then((list) => {
          found = list;
          drawFound();
        });
      return h(
        'div.ob-step',
        {},
        h('h1.ob-title', { style: { fontSize: '32px' } }, 'Перенести сборки'),
        h('p.ob-text', {}, 'WayTester нашёл на компьютере сборки других лаунчеров. Отметьте, какие скопировать — моды, миры и настройки переедут вместе с ними. Оригиналы останутся на месте.'),
        listEl,
        h('div.grow'),
        nav([btn('Назад', { kind: 'text', onClick: back }), btn('Пропустить', { kind: 'text', onClick: next }), importBtn]),
      );
    },

    () =>
      h(
        'div.ob-step',
        { style: { alignItems: 'center', textAlign: 'center', justifyContent: 'center' } },
        h('div.ob-logo', {}, icon('rocket_launch')),
        h('h1.ob-title', {}, 'Всё готово!'),
        h('p.ob-text', {}, 'Создайте первую сборку или установите модпак. Импорт, если вы его выбрали, продолжается в фоне — прогресс виден у значка загрузок.'),
        h(
          'div.row.wrap',
          { style: { justifyContent: 'center', gap: '10px', marginTop: '10px' } },
          btn('Создать сборку', { icon: 'add', cls: 'lg', kind: 'play', onClick: () => finish(() => openCreateDialog()) }),
          btn('Найти модпак', { icon: 'explore', cls: 'lg', kind: 'tonal', onClick: () => finish(() => navigate('browse', { type: 'modpack' })) }),
        ),
        h('div.grow'),
        nav([btn('В библиотеку', { kind: 'text', icon: 'grid_view', onClick: () => finish(() => navigate('library')) })]),
      ),
  ];

  go(0);
}
