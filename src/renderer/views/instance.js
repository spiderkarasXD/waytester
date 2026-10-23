import { h, icon, btn, iconBtn, clear, toast, api, loaderTag, instanceIcon, fmtDate, fmtDuration, fmtSize, field, slider, switchEl, busy, confirm, dialog, LOADERS } from '../ui.js';
import { state, on, refreshInstances } from '../state.js';
import { navigate, play } from '../app.js';
import { instanceMenu } from './library.js';
import { versionPicker } from './create.js';

const TABS = [
  ['mods', 'Моды', 'extension'],
  ['resourcepacks', 'Ресурспаки', 'texture'],
  ['shaderpacks', 'Шейдеры', 'wb_sunny'],
  ['worlds', 'Миры', 'public'],
  ['logs', 'Консоль', 'terminal'],
  ['settings', 'Настройки', 'settings'],
];
const BROWSE_TYPE = { mods: 'mod', resourcepacks: 'resourcepack', shaderpacks: 'shader' };

export function instanceView(page, params) {
  let inst = state.instances.find((i) => i.id === params.id);
  if (!inst) return navigate('library');
  let tab = params.tab || (inst.loader === 'vanilla' && !inst.optifine ? 'resourcepacks' : 'mods');
  const cleanups = [];

  const header = h('div');
  const tabsEl = h('div.tabs');
  const content = h('div');
  page.append(header, tabsEl, content);

  // Files dropped while this page is open go into the current content folder.
  params.onDrop = (files) => {
    if (!BROWSE_TYPE[tab]) return false;
    api('instances:dropContent', inst.id, tab, files.map((f) => f.path)).then(() => showTab(tab));
    return true;
  };

  const drawHeader = () => {
    const running = state.running.has(inst.id);
    const more = iconBtn('more_vert', { onClick: (e) => instanceMenu(e.currentTarget, inst), title: 'Ещё' });
    clear(header).append(
      h(
        'div.inst-header.glass',
        {},
        h('div', { title: 'Сменить иконку', onclick: async () => ((inst = await api('instances:pickIcon', inst.id)), refreshInstances()) }, instanceIcon(inst)),
        h(
          'div.grow',
          { style: { minWidth: 0 } },
          h('div.row', {}, iconBtn('arrow_back', { onClick: () => navigate('library'), cls: 'sm', title: 'Назад' }), h('span.muted.small', {}, inst.group || 'Библиотека')),
          h('h1.ellipsis', {}, inst.name),
          h(
            'div.row.wrap',
            { style: { gap: '6px' } },
            h('span.tag', {}, icon('deployed_code'), inst.gameVersion),
            loaderTag(inst.loader, inst.loaderVersion),
            inst.optifine && h('span.tag.loader-optifine', {}, icon('auto_awesome'), `OptiFine ${inst.optifine.replace(/_/g, ' ')}`),
            h('span.tag', {}, icon('schedule'), fmtDuration(inst.playtime)),
            h('span.tag', {}, icon('history'), fmtDate(inst.lastPlayed)),
            running && h('span.tag.primary', {}, h('span.running-dot'), 'Запущена'),
          ),
        ),
        h('div.row', {}, iconBtn('folder_open', { onClick: () => api('instances:openFolder', inst.id), title: 'Открыть папку' }), more, btn(running ? 'Остановить' : 'Играть', { icon: running ? 'stop' : 'play_arrow', kind: running ? 'stop' : 'play', cls: 'lg', onClick: () => (play(inst.id), running || showTab('logs')) })),
      ),
    );
  };

  const drawTabs = () => {
    clear(tabsEl);
    for (const [k, label, ic] of TABS) {
      if (k === 'mods' && inst.loader === 'vanilla') continue;
      tabsEl.append(h(`button.tab${tab === k ? '.on' : ''}`, { onclick: () => showTab(k) }, icon(ic), label));
    }
  };

  const showTab = (k) => {
    tab = k;
    drawTabs();
    clear(content);
    while (cleanups.length) cleanups.pop()();
    if (BROWSE_TYPE[k]) contentTab(content, inst, k);
    else if (k === 'worlds') worldsTab(content, inst);
    else if (k === 'logs') cleanups.push(logsTab(content, inst));
    else if (k === 'settings') settingsTab(content, inst, async (patch) => {
      inst = await api('instances:save', inst.id, patch);
      await refreshInstances();
      drawHeader();
    });
  };

  drawHeader();
  showTab(tab);
  const offs = [
    on('running', ({ id }) => id === inst.id && drawHeader()),
    on('instances', () => {
      const next = state.instances.find((i) => i.id === inst.id);
      if (next) {
        inst = next;
        drawHeader();
      }
    }),
  ];
  return () => {
    offs.forEach((f) => f());
    cleanups.forEach((f) => f());
  };
}

function contentTab(root, inst, kind) {
  let items = [];
  let filter = '';
  const list = h('div.list.glass');
  const search = h('input.input', { placeholder: 'Фильтр', oninput: () => ((filter = search.value.toLowerCase()), draw()) });
  const updatesBtn =
    kind === 'mods' &&
    btn('Обновления', {
      kind: 'outlined',
      icon: 'update',
      onClick: () =>
        busy(updatesBtn, async () => {
          await api('instances:identify', inst.id);
          const updates = await api('instances:checkUpdates', inst.id);
          if (!updates.length) return toast('Все моды актуальны');
          dialog({
            title: `Доступно обновлений: ${updates.length}`,
            icon: 'update',
            body: h('div.list', {}, updates.map((u) => h('div.list-item', {}, h('div.li-main', {}, h('div.li-title', {}, u.title || u.file), h('div.li-sub', {}, `${u.from} → ${u.to}`))))),
            actions: [
              { label: 'Позже', onClick: (c) => c() },
              {
                label: 'Обновить всё',
                kind: 'filled',
                icon: 'download',
                onClick: async (c) => {
                  c();
                  await api('instances:applyUpdates', inst.id, updates);
                  load();
                },
              },
            ],
          });
        }),
    });
  root.append(
    h(
      'div.row.wrap',
      { style: { marginBottom: '14px', gap: '10px' } },
      h('div.search', { style: { maxWidth: '320px' } }, icon('filter_list'), search),
      h('div.grow'),
      updatesBtn,
      btn('Из файла', { kind: 'outlined', icon: 'upload_file', onClick: async () => ((items = await api('instances:addContent', inst.id, kind)), draw()) }),
      btn(kind === 'mods' ? 'Найти моды' : kind === 'shaderpacks' ? 'Найти шейдеры' : 'Найти ресурспаки', { icon: 'travel_explore', onClick: () => navigate('browse', { instanceId: inst.id, type: BROWSE_TYPE[kind] }) }),
    ),
    list,
  );

  const draw = () => {
    clear(list);
    const shown = items.filter((m) => !filter || `${m.title || ''} ${m.name || ''} ${m.file}`.toLowerCase().includes(filter));
    if (!shown.length) {
      list.append(
        h(
          'div.empty',
          { style: { padding: '50px 20px' } },
          icon(kind === 'mods' ? 'extension' : 'texture'),
          h('div.muted', {}, items.length ? 'Ничего не найдено' : 'Пусто. Найдите контент в «Обзоре» или перетащите файлы в окно.'),
        ),
      );
      return;
    }
    for (const m of shown) {
      const row = h(
        `div.list-item${m.enabled ? '' : '.disabled'}`,
        {},
        h('div.li-icon', {}, m.iconUrl ? h('img', { src: m.iconUrl, alt: '', loading: 'lazy' }) : icon(kind === 'mods' ? 'extension' : 'image')),
        h(
          'div.li-main',
          {},
          h('div.li-title.ellipsis', {}, m.title || m.name || m.file.replace(/\.(jar|zip)$/, '')),
          h('div.li-sub.ellipsis', {}, [m.versionNumber || m.version, m.file, fmtSize(m.size)].filter(Boolean).join(' · ')),
        ),
        m.source && h('span.tag', {}, m.source === 'curseforge' ? 'CurseForge' : 'Modrinth'),
        switchEl(m.enabled, async (v) => {
          await api('instances:toggleContent', inst.id, kind, m.file, v);
          m.enabled = v;
          row.classList.toggle('disabled', !v);
        }),
        iconBtn('delete', {
          cls: 'sm',
          title: 'Удалить',
          onClick: async () => {
            if (!(await confirm('Удалить?', m.title || m.file))) return;
            await api('instances:removeContent', inst.id, kind, m.file);
            items = items.filter((x) => x !== m);
            draw();
          },
        }),
      );
      list.append(row);
    }
  };

  const load = async () => {
    list.append(h('div.row', { style: { padding: '24px', justifyContent: 'center' } }, h('span.spinner')));
    items = await api('instances:content', inst.id, kind).catch(() => []);
    draw();
    // Look unknown mods up on Modrinth in the background for icons/names.
    if (kind === 'mods' && items.some((m) => !m.source)) {
      api('instances:identify', inst.id)
        .then((next) => {
          items = next;
          draw();
        })
        .catch(() => {});
    }
  };
  load();
}

async function worldsTab(root, inst) {
  const worlds = await api('instances:worlds', inst.id).catch(() => []);
  root.append(
    h('div.row', { style: { marginBottom: '14px' } }, h('div.grow.muted', {}, worlds.length ? `${worlds.length} миров` : ''), btn('Папка сохранений', { kind: 'outlined', icon: 'folder_open', onClick: () => api('instances:openFolder', inst.id, 'saves') })),
  );
  if (!worlds.length) {
    root.append(h('div.empty.glass', {}, icon('public'), h('div.muted', {}, 'Миров пока нет — зайдите в игру и создайте первый.')));
    return;
  }
  root.append(
    h(
      'div.worlds',
      {},
      worlds.map((w) =>
        h('div.world.glass', {}, w.icon ? h('img', { src: w.icon }) : h('div.ph', {}, icon('landscape')), h('div.grow', { style: { minWidth: 0 } }, h('div.li-title.ellipsis', {}, w.name), h('div.li-sub', {}, fmtDate(w.modified)))),
      ),
    ),
  );
}

function logsTab(root, inst) {
  let filter = '';
  let follow = true;
  const consoleEl = h('div.console.glass');
  const search = h('input.input', { placeholder: 'Поиск в логе', oninput: () => ((filter = search.value.toLowerCase()), redraw()) });
  const lineEl = (l) => h(`div.${l.level || 'INFO'}`, {}, l.text);
  const redraw = () => {
    clear(consoleEl);
    const lines = (state.logs.get(inst.id) || []).filter((l) => !filter || l.text.toLowerCase().includes(filter));
    if (!lines.length) consoleEl.append(h('div.muted', {}, state.running.has(inst.id) ? 'Ожидание вывода…' : 'Лог появится после запуска игры.'));
    const frag = document.createDocumentFragment();
    for (const l of lines.slice(-3000)) frag.append(lineEl(l));
    consoleEl.append(frag);
    if (follow) consoleEl.scrollTop = consoleEl.scrollHeight;
  };
  consoleEl.addEventListener('scroll', () => {
    follow = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 40;
  });
  root.append(
    h(
      'div.row.wrap',
      { style: { marginBottom: '12px', gap: '10px' } },
      h('div.search', { style: { maxWidth: '340px' } }, icon('search'), search),
      h('div.grow'),
      btn('Копировать', { kind: 'outlined', icon: 'content_copy', onClick: () => (navigator.clipboard.writeText((state.logs.get(inst.id) || []).map((l) => l.text).join('\n')), toast('Лог скопирован')) }),
      btn('Очистить', { kind: 'text', icon: 'clear_all', onClick: () => (state.logs.set(inst.id, []), redraw()) }),
      btn('Папка логов', { kind: 'text', icon: 'folder_open', onClick: () => api('instances:openFolder', inst.id, 'logs') }),
    ),
    consoleEl,
  );
  redraw();
  return on('log', ({ id, lines }) => {
    if (id !== inst.id) return;
    if (filter) return redraw();
    if (consoleEl.firstChild?.classList?.contains('muted')) clear(consoleEl);
    for (const l of lines) consoleEl.append(lineEl(l));
    while (consoleEl.childElementCount > 3000) consoleEl.firstChild.remove();
    if (follow) consoleEl.scrollTop = consoleEl.scrollHeight;
  });
}

function settingsTab(root, inst, save) {
  const s = state.settings;
  const name = h('input.input', { value: inst.name, onchange: () => save({ name: name.value.trim() || inst.name }) });
  const group = h('input.input', { value: inst.group || '', placeholder: 'Без группы', onchange: () => save({ group: group.value.trim() }) });
  const memLabel = h('span.tag.primary');
  const custom = !!inst.memoryMax;
  const memVal = inst.memoryMax || s.memoryMax;
  memLabel.textContent = `${(memVal / 1024).toFixed(1)} ГБ`;
  const mem = slider({ min: 1024, max: 32768, step: 512, value: memVal, onInput: (v) => (memLabel.textContent = `${(v / 1024).toFixed(1)} ГБ`) });
  mem.addEventListener('change', () => save({ memoryMax: Number(mem.value) }));
  mem.disabled = !custom;
  const jvm = h('textarea.input', { placeholder: '-XX:+UseZGC …', value: inst.jvmArgs || '', onchange: () => save({ jvmArgs: jvm.value.trim() }) });
  const javaPath = h('input.input', { value: inst.javaPath || '', placeholder: 'Автоматически (скачается нужная версия)', onchange: () => save({ javaPath: javaPath.value.trim() }) });
  const width = h('input.input', { type: 'number', value: inst.width || '', placeholder: String(s.width), onchange: () => save({ width: Number(width.value) || null }) });
  const height = h('input.input', { type: 'number', value: inst.height || '', placeholder: String(s.height), onchange: () => save({ height: Number(height.value) || null }) });
  const server = h('input.input', { value: inst.joinServer || '', placeholder: 'mc.example.com', onchange: () => save({ joinServer: server.value.trim() }) });

  let picked = null;
  const picker = versionPicker(inst, (v) => (picked = v));
  const applyVersion = btn('Применить версию', {
    kind: 'tonal',
    icon: 'sync',
    onClick: async () => {
      if (!picked) return;
      if (!(await confirm('Сменить версию?', 'Моды могут оказаться несовместимы с новой версией. Сделайте копию сборки, если не уверены.', { okLabel: 'Сменить', danger: false }))) return;
      await save({ ...picked, installed: false });
      toast('Версия изменится при следующем запуске');
    },
  });

  root.append(
    h(
      'div.settings',
      {},
      h('div.set-card.glass', { style: { padding: '20px 22px' } }, h('div.form-grid', {}, field('Название', name), field('Группа', group))),
      h('div.set-card.glass', { style: { padding: '20px 22px' } }, h('h3', { style: { margin: '0 0 14px' } }, 'Версия и загрузчик'), picker.el, h('div', { style: { marginTop: '14px', textAlign: 'right' } }, applyVersion)),
      h(
        'div.set-card.glass',
        {},
        h('h3', {}, 'Java и память'),
        h(
          'div.set-row',
          {},
          h('div.li-main', {}, h('div.li-title', {}, 'Своя память для сборки'), h('div.li-sub', {}, `По умолчанию — ${(s.memoryMax / 1024).toFixed(1)} ГБ из общих настроек`)),
          switchEl(custom, (v) => {
            mem.disabled = !v;
            save({ memoryMax: v ? Number(mem.value) : null });
          }),
        ),
        h('div.set-row', {}, h('div.li-main', {}, h('div.li-title', {}, 'Максимум памяти'), memLabel), h('div.ctl', {}, mem)),
        h('div.set-row', {}, h('div.li-main', {}, h('div.li-title', {}, 'Путь к Java')), h('div.ctl', {}, javaPath)),
        h('div.set-row', {}, h('div.li-main', {}, h('div.li-title', {}, 'Аргументы JVM')), h('div.ctl', {}, jvm)),
      ),
      h(
        'div.set-card.glass',
        {},
        h('h3', {}, 'Игра'),
        h('div.set-row', {}, h('div.li-main', {}, h('div.li-title', {}, 'Размер окна')), h('div.ctl.row', {}, width, h('span.muted', {}, '×'), height)),
        h('div.set-row', {}, h('div.li-main', {}, h('div.li-title', {}, 'Сразу заходить на сервер'), h('div.li-sub', {}, 'Адрес сервера для автоподключения')), h('div.ctl', {}, server)),
        h(
          'div.set-row',
          {},
          h('div.li-main', {}, h('div.li-title', {}, 'Переустановить файлы игры'), h('div.li-sub', {}, 'Проверит и докачает повреждённые библиотеки и ассеты')),
          btn('Проверить', { kind: 'outlined', icon: 'build', onClick: () => api('instances:install', inst.id).catch(() => {}) }),
        ),
      ),
    ),
  );
}
