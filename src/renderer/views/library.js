import { h, icon, btn, clear, menu, confirm, toast, api, loaderTag, instanceIcon, fmtDate, fmtDuration } from '../ui.js';
import { state, on, refreshInstances } from '../state.js';
import { navigate, play } from '../app.js';
import { openCreateDialog } from './create.js';

export function instanceMenu(anchor, inst) {
  menu(anchor, [
    { icon: 'play_arrow', label: state.running.has(inst.id) ? 'Остановить' : 'Играть', onClick: () => play(inst.id) },
    { icon: 'folder_open', label: 'Открыть папку', onClick: () => api('instances:openFolder', inst.id) },
    { icon: 'extension', label: 'Добавить моды', onClick: () => navigate('browse', { instanceId: inst.id }) },
    '-',
    { icon: 'content_copy', label: 'Дублировать', onClick: async () => (await api('instances:duplicate', inst.id), refreshInstances()) },
    { icon: 'ios_share', label: 'Экспорт в .mrpack', onClick: () => api('instances:export', inst.id) },
    '-',
    {
      icon: 'delete',
      label: 'Удалить',
      danger: true,
      onClick: async () => {
        if (!(await confirm('Удалить сборку?', `«${inst.name}» будет удалена вместе с мирами и модами.`))) return;
        try {
          await api('instances:remove', inst.id);
          toast('Сборка удалена');
          await refreshInstances();
          navigate('library');
        } catch (e) {
          toast(e.message, { error: true });
        }
      },
    },
  ]);
}

function card(inst) {
  const running = state.running.has(inst.id);
  const el = h(
    'div.inst-card.glass',
    {
      onclick: () => navigate('instance', { id: inst.id }),
      oncontextmenu: (e) => {
        e.preventDefault();
        instanceMenu(el, inst);
      },
    },
    instanceIcon(inst),
    h(
      'button.play-fab' + (running ? '.running' : ''),
      { title: running ? 'Остановить' : 'Играть', onclick: (e) => (e.stopPropagation(), play(inst.id)) },
      icon(running ? 'stop' : 'play_arrow'),
    ),
    h(
      'div',
      {},
      h('div.row', {}, running && h('span.running-dot'), h('div.name.ellipsis.grow', {}, inst.name)),
      h('div.row.wrap', { style: { marginTop: '8px', gap: '6px' } }, h('span.tag', {}, inst.gameVersion), loaderTag(inst.loader), inst.optifine && h('span.tag.loader-optifine', {}, 'OptiFine')),
    ),
  );
  return el;
}

function hero(inst) {
  const running = state.running.has(inst.id);
  return h(
    'div.hero.glass',
    {},
    instanceIcon(inst, 'hero-icon'),
    h(
      'div.grow',
      {},
      h('div.hero-kicker', {}, running ? 'Сейчас в игре' : 'Продолжить игру'),
      h('div.hero-title', {}, inst.name),
      h('div.row.wrap', {}, h('span.tag', {}, inst.gameVersion), loaderTag(inst.loader, inst.loaderVersion), h('span.tag', {}, icon('schedule'), fmtDuration(inst.playtime)), h('span.tag', {}, icon('history'), fmtDate(inst.lastPlayed))),
    ),
    h(
      'div.col',
      { style: { alignItems: 'flex-end' } },
      btn(running ? 'Остановить' : 'Играть', { icon: running ? 'stop' : 'play_arrow', kind: running ? 'stop' : 'play', cls: 'lg', onClick: () => play(inst.id) }),
      btn('Подробнее', { kind: 'text', icon: 'arrow_forward', onClick: () => navigate('instance', { id: inst.id }) }),
    ),
  );
}

export function libraryView(page) {
  let group = 'all';
  let query = '';

  const render = () => {
    clear(page);
    const list = state.instances;
    page.append(
      h(
        'div.page-head',
        {},
        h('div.grow', {}, h('h1.page-title', {}, 'Библиотека'), h('div.page-sub', {}, list.length ? `${list.length} ${plural(list.length, 'сборка', 'сборки', 'сборок')}` : 'Здесь появятся ваши сборки')),
        btn('Импорт', { kind: 'outlined', icon: 'move_to_inbox', onClick: () => openCreateDialog({ tab: 'import' }) }),
        btn('Новая сборка', { kind: 'filled', icon: 'add', onClick: () => openCreateDialog() }),
      ),
    );

    if (!list.length) {
      page.append(
        h(
          'div.empty.glass',
          {},
          h('div.big-icon', {}, icon('deployed_code', 'fill')),
          h('h2', {}, 'Пока пусто'),
          h('p.muted', { style: { maxWidth: '440px', margin: 0, lineHeight: 1.5 } }, 'Создайте сборку с Fabric, Forge, NeoForge, Quilt или OptiFine, установите готовый модпак с Modrinth и CurseForge — или перенесите сборки из Prism, CurseForge App, Modrinth App и других лаунчеров.'),
          h('div.row', { style: { marginTop: '10px' } }, btn('Создать сборку', { icon: 'add', onClick: () => openCreateDialog() }), btn('Найти модпак', { kind: 'tonal', icon: 'explore', onClick: () => navigate('browse', { type: 'modpack' }) }), btn('Импорт', { kind: 'outlined', icon: 'move_to_inbox', onClick: () => openCreateDialog({ tab: 'import' }) })),
        ),
      );
      return;
    }

    const recent = [...list].filter((i) => i.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || list[0];
    page.append(hero(state.instances.find((i) => state.running.has(i.id)) || recent));

    const groups = [...new Set(list.map((i) => i.group).filter(Boolean))];
    const loadersUsed = [...new Set(list.map((i) => i.loader))];
    const search = h('input.input', { placeholder: 'Поиск по сборкам', value: query, oninput: () => ((query = search.value), drawGrid()) });
    page.append(
      h(
        'div.row.wrap',
        { style: { margin: '24px 0 14px', gap: '12px' } },
        h('div.chips.grow', {}, chip('all', 'Все'), groups.map((g) => chip(`g:${g}`, g, 'folder')), loadersUsed.length > 1 && loadersUsed.map((l) => chip(`l:${l}`, l[0].toUpperCase() + l.slice(1)))),
        h('div.search', { style: { maxWidth: '300px' } }, icon('search'), search),
      ),
    );
    const grid = h('div.grid');
    page.append(grid);
    const drawGrid = () => {
      clear(grid);
      const q = query.toLowerCase();
      const filtered = list.filter((i) => {
        if (group.startsWith('g:') && i.group !== group.slice(2)) return false;
        if (group.startsWith('l:') && i.loader !== group.slice(2)) return false;
        return !q || i.name.toLowerCase().includes(q) || i.gameVersion.includes(q);
      });
      grid.append(...filtered.map(card));
      if (!filtered.length) grid.append(h('div.muted', { style: { padding: '20px' } }, 'Ничего не найдено'));
    };
    drawGrid();
  };

  const chip = (value, label, ic) => h(`button.chip${group === value ? '.on' : ''}`, { onclick: () => ((group = value), render()) }, group === value ? icon('check') : ic && icon(ic), label);

  render();
  refreshInstances();
  const offs = [on('instances', render), on('running', render)];
  return () => offs.forEach((f) => f());
}

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
