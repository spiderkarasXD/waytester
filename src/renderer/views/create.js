import { h, icon, btn, clear, dialog, toast, api, field, select, switchEl, LOADERS, loaderTag, busy } from '../ui.js';
import { state, refreshInstances } from '../state.js';
import { navigate } from '../app.js';

let versionsCache = null;
export async function gameVersions() {
  if (!versionsCache) versionsCache = await api('versions:list');
  return versionsCache;
}

const loaderGamesCache = new Map();
async function loaderGames(loader) {
  if (!loaderGamesCache.has(loader)) loaderGamesCache.set(loader, api('versions:loaderGames', loader).catch(() => null));
  return loaderGamesCache.get(loader);
}

// Version + loader picker, reused by the create dialog, instance settings and manual import.
export function versionPicker(initial = {}, onChange = () => {}) {
  const value = {
    gameVersion: initial.gameVersion || null,
    loader: initial.loader || 'vanilla',
    loaderVersion: initial.loaderVersion || null,
    optifine: initial.optifine || null,
  };
  let filter = 'release';
  const root = h('div.col', { style: { gap: '14px' } });
  const versionSlot = h('div');
  const loaderSlot = h('div.loader-grid');
  const loaderVersionSlot = h('div');
  const optifineSlot = h('div');

  const filters = h('div.chips');
  const drawFilters = () => {
    clear(filters);
    for (const [k, label] of [
      ['release', 'Релизы'],
      ['snapshot', 'Снапшоты'],
      ['old', 'Старые'],
    ]) {
      filters.append(h(`button.chip${filter === k ? '.on' : ''}`, { onclick: () => ((filter = k), drawFilters(), drawVersions()) }, filter === k && icon('check'), label));
    }
  };

  const drawVersions = async () => {
    const all = await gameVersions();
    const list = all.filter((v) => (filter === 'release' ? v.type === 'release' : filter === 'snapshot' ? v.type === 'snapshot' : v.type.startsWith('old')));
    if (!value.gameVersion) value.gameVersion = all.find((v) => v.type === 'release').id;
    const opts = list.map((v) => ({ value: v.id, label: v.id }));
    if (!list.some((v) => v.id === value.gameVersion)) opts.unshift({ value: value.gameVersion, label: value.gameVersion });
    clear(versionSlot).append(
      select(opts, value.gameVersion, (v) => {
        value.gameVersion = v;
        value.loaderVersion = null;
        value.optifine = null;
        drawLoaders();
        changed();
      }),
    );
  };

  const drawLoaders = async () => {
    clear(loaderSlot);
    for (const [key, l] of Object.entries(LOADERS)) {
      const opt = h(
        `div.loader-opt${value.loader === key ? '.on' : ''}`,
        {
          onclick: () => {
            value.loader = key;
            value.loaderVersion = null;
            drawLoaders();
            changed();
          },
        },
        h('div.lo-dot', { style: { background: `${l.color}26`, color: l.color } }, icon(l.icon)),
        l.label,
      );
      loaderSlot.append(opt);
      if (key !== 'vanilla') {
        loaderGames(key).then((games) => {
          if (games && !games.includes(value.gameVersion)) {
            opt.classList.add('unavailable');
            if (value.loader === key) {
              value.loader = 'vanilla';
              drawLoaders();
            }
          }
        });
      }
    }
    drawLoaderVersions();
    drawOptifine();
  };

  const drawLoaderVersions = async () => {
    clear(loaderVersionSlot);
    if (value.loader === 'vanilla') return;
    loaderVersionSlot.append(h('div.row', {}, h('span.spinner.sm'), h('span.muted', {}, 'Загрузка версий…')));
    try {
      const list = await api('versions:loader', value.loader, value.gameVersion);
      if (!list.length) throw new Error(`Нет версий ${LOADERS[value.loader].label} для ${value.gameVersion}`);
      const preferred = list.find((v) => v.stable) || list[0];
      if (!value.loaderVersion || !list.some((v) => v.version === value.loaderVersion)) value.loaderVersion = preferred.version;
      clear(loaderVersionSlot).append(
        field(
          `Версия ${LOADERS[value.loader].label}`,
          select(
            list.map((v) => ({ value: v.version, label: `${v.version}${v.stable && value.loader === 'forge' ? ' · рекомендуемая' : ''}${v.latest ? ' · последняя' : ''}${!v.stable && value.loader !== 'forge' ? ' · бета' : ''}` })),
            value.loaderVersion,
            (v) => ((value.loaderVersion = v), changed()),
          ),
        ),
      );
      changed();
    } catch (e) {
      clear(loaderVersionSlot).append(h('div.muted.small', {}, e.message));
    }
  };

  const drawOptifine = async () => {
    clear(optifineSlot);
    if (value.loader === 'neoforge' || value.loader === 'quilt') {
      value.optifine = null;
      return;
    }
    const list = await api('versions:loader', 'optifine', value.gameVersion).catch(() => []);
    if (!list.length) {
      value.optifine = null;
      return;
    }
    const ver = select(list.map((v) => ({ value: v.version, label: `${v.version.replace(/_/g, ' ')}${v.forge ? ` · ${v.forge}` : ''}` })), value.optifine || list[0].version, (v) => ((value.optifine = v), changed()));
    ver.style.display = value.optifine ? '' : 'none';
    optifineSlot.append(
      h(
        'div.col',
        {},
        h(
          'div.row',
          {},
          h('div.lo-dot', { style: { width: '28px', height: '28px', borderRadius: '9px', display: 'grid', placeItems: 'center', background: '#96dca026', color: '#96dca0' } }, icon('auto_awesome')),
          h('div.grow', {}, h('div', { style: { fontWeight: 600 } }, 'OptiFine'), h('div.muted.small', {}, value.loader === 'fabric' ? 'Для Fabric лучше Sodium + Iris; OptiFine будет положен в mods' : 'Шейдеры и оптимизация')),
          switchEl(!!value.optifine, (on) => {
            value.optifine = on ? ver.value : null;
            ver.style.display = on ? '' : 'none';
            changed();
          }),
        ),
        ver,
      ),
    );
  };

  const changed = () => onChange({ ...value });

  root.append(field('Версия Minecraft', h('div.col', {}, filters, versionSlot)), field('Загрузчик', loaderSlot), loaderVersionSlot, optifineSlot);
  drawFilters();
  drawVersions().then(drawLoaders);
  return { el: root, get: () => ({ ...value }) };
}

function newTab(d) {
  const name = h('input.input', { placeholder: 'Название сборки' });
  const group = h('input.input', { placeholder: 'Без группы', list: 'groups-list' });
  const groups = h('datalist', { id: 'groups-list' }, [...new Set(state.instances.map((i) => i.group).filter(Boolean))].map((g) => h('option', { value: g })));
  let installNow = true;
  const picker = versionPicker({}, (v) => {
    name.placeholder = `${LOADERS[v.loader].label} ${v.gameVersion}`;
  });
  const body = h('div.col', { style: { gap: '16px' } }, field('Название', name), picker.el, field('Группа', h('div', {}, group, groups)), h('div.row', {}, h('div.grow', {}, h('div', { style: { fontWeight: 550 } }, 'Скачать сразу'), h('div.muted.small', {}, 'Иначе файлы загрузятся при первом запуске')), switchEl(true, (v) => (installNow = v))));
  const createBtn = btn('Создать', {
    icon: 'add',
    onClick: () =>
      busy(createBtn, async () => {
        const v = picker.get();
        if (!v.gameVersion) throw new Error('Выберите версию');
        if (v.loader !== 'vanilla' && !v.loaderVersion) throw new Error('Выберите версию загрузчика');
        const inst = await api('instances:create', { ...v, name: name.value.trim() || name.placeholder, group: group.value.trim() });
        await refreshInstances();
        d.close();
        navigate('instance', { id: inst.id });
        if (installNow) api('instances:install', inst.id).then(refreshInstances).catch(() => {});
      }),
  });
  return { body, actions: [btn('Отмена', { kind: 'text', onClick: () => d.close() }), createBtn] };
}

function manualImport(d, folder) {
  const picker = versionPicker();
  const go = btn('Импортировать', {
    icon: 'move_to_inbox',
    onClick: () =>
      busy(go, async () => {
        const v = picker.get();
        await api('import:path', folder, { gameVersion: v.gameVersion, loader: v.loader, loaderVersion: v.loaderVersion });
        await refreshInstances();
        d.close();
        toast('Сборка импортирована');
      }),
  });
  return {
    body: h('div.col', { style: { gap: '14px' } }, h('div.muted', {}, 'Не удалось определить версию по папке ', h('b', {}, folder), '. Укажите её вручную — моды, миры и настройки будут скопированы.'), picker.el),
    actions: [btn('Назад', { kind: 'text', onClick: () => d.close() }), go],
  };
}

function importTab(d) {
  const foundSlot = h('div.found-list', {}, h('div.row', { style: { padding: '20px', justifyContent: 'center' } }, h('span.spinner.sm'), h('span.muted', {}, 'Ищем сборки других лаунчеров…')));
  const importFrom = async (kind) => {
    const p = await api('import:pick', kind);
    if (!p) return;
    try {
      d.close();
      await api('import:path', p);
      await refreshInstances();
    } catch (e) {
      if (e.code === 'NEEDS_VERSION') openCreateDialog({ tab: 'import', folder: p });
    }
  };
  api('import:scan')
    .then((found) => {
      clear(foundSlot);
      if (!found.length) {
        foundSlot.append(h('div.muted', { style: { padding: '22px', textAlign: 'center' } }, 'Сборок других лаунчеров не найдено. Укажите папку или файл вручную.'));
        return;
      }
      for (const f of found) {
        const b = btn('Импорт', {
          kind: 'tonal',
          onClick: () =>
            busy(b, async () => {
              await api('import:folder', f);
              await refreshInstances();
              b.replaceWith(h('span.tag.primary', {}, icon('check'), 'Готово'));
            }),
        });
        foundSlot.append(
          h(
            'div.list-item',
            {},
            h('div.li-icon', {}, icon(f.launcher === '.minecraft' ? 'grass' : 'inventory_2')),
            h('div.li-main', {}, h('div.li-title.ellipsis', {}, f.name), h('div.row.wrap', { style: { gap: '6px', marginTop: '4px' } }, h('span.tag.primary', {}, f.launcher), h('span.tag', {}, f.gameVersion), loaderTag(f.loader, f.loaderVersion))),
            b,
          ),
        );
      }
    })
    .catch((e) => clear(foundSlot).append(h('div.muted', { style: { padding: '20px' } }, e.message)));

  const body = h(
    'div.col',
    { style: { gap: '12px' } },
    h(
      'div.row',
      { style: { gap: '10px' } },
      h('button.option-card', { onclick: () => importFrom('file') }, h('div.oc-icon', {}, icon('folder_zip')), h('div', {}, h('div', { style: { fontWeight: 600 } }, 'Файл сборки'), h('div.muted.small', {}, '.mrpack, CurseForge .zip, экспорт Prism'))),
      h('button.option-card', { onclick: () => importFrom('folder') }, h('div.oc-icon', {}, icon('folder_open')), h('div', {}, h('div', { style: { fontWeight: 600 } }, 'Папка сборки'), h('div.muted.small', {}, 'Prism, MultiMC, CurseForge, ATLauncher, GDLauncher, .minecraft'))),
    ),
    h('div.section-title', { style: { margin: '10px 0 0' } }, icon('travel_explore'), 'Найдено на этом компьютере'),
    foundSlot,
    h('div.muted.small', {}, 'Можно просто перетащить файл или папку сборки в окно WayTester.'),
  );
  return { body, actions: [btn('Закрыть', { kind: 'text', onClick: () => d.close() })] };
}

export function openCreateDialog({ tab = 'new', folder } = {}) {
  const d = dialog({ title: folder ? 'Импорт папки' : 'Добавить сборку', icon: folder ? 'move_to_inbox' : 'add_box', body: h('div') });
  const tabsEl = h('div.tabs', { style: { margin: '0 0 6px' } });
  const content = h('div');
  const show = (t) => {
    tab = t;
    clear(tabsEl);
    for (const [k, label, ic] of [
      ['new', 'Новая', 'add'],
      ['import', 'Импорт', 'move_to_inbox'],
      ['packs', 'Модпаки', 'explore'],
    ]) {
      tabsEl.append(h(`button.tab${k === t ? '.on' : ''}`, { onclick: () => (k === 'packs' ? (d.close(), navigate('browse', { type: 'modpack' })) : show(k)) }, icon(ic), label));
    }
    const view = t === 'new' ? newTab(d) : importTab(d);
    clear(content).append(view.body);
    d.setActions(view.actions);
  };
  if (folder) {
    const view = manualImport(d, folder);
    d.body.append(view.body);
    d.setActions(view.actions);
    return;
  }
  tabsEl.style.margin = '0 -4px';
  d.body.before(tabsEl);
  d.body.append(content);
  show(tab);
}
