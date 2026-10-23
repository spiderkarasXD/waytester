import { h, icon, btn, iconBtn, clear, toast, api, fmtNum, fmtDate, segmented, select, sheet, busy, loaderTag } from '../ui.js';
import { state, refreshInstances } from '../state.js';
import { navigate } from '../app.js';
import { markdown, sanitize } from '../markdown.js';

const TYPES = [
  ['mod', 'Моды', 'extension'],
  ['modpack', 'Модпаки', 'inventory_2'],
  ['resourcepack', 'Ресурспаки', 'texture'],
  ['shader', 'Шейдеры', 'wb_sunny'],
];
const SORTS = [
  ['relevance', 'По релевантности'],
  ['downloads', 'По загрузкам'],
  ['follows', 'По популярности'],
  ['newest', 'Новые'],
  ['updated', 'Обновлённые'],
];
const PAGE = 24;

// Remembered between visits.
const memory = { platform: 'modrinth', type: 'mod', sort: 'relevance', query: '', instanceId: null };

export function browseView(page, params) {
  Object.assign(memory, { type: params.type || memory.type, instanceId: params.instanceId ?? memory.instanceId });
  if (!state.instances.some((i) => i.id === memory.instanceId)) memory.instanceId = null;
  let offset = 0;
  let searchTimer = null;
  let token = 0;

  const instance = () => state.instances.find((i) => i.id === memory.instanceId) || null;

  const head = h('div.page-head', {}, h('div.grow', {}, h('h1.page-title', {}, 'Обзор'), h('div.page-sub', {}, 'Моды, модпаки, ресурспаки и шейдеры с Modrinth и CurseForge')));
  const platformSeg = segmented(
    [
      { value: 'modrinth', label: 'Modrinth' },
      { value: 'curseforge', label: 'CurseForge' },
    ],
    memory.platform,
    (v) => ((memory.platform = v), reset()),
  );
  head.append(platformSeg);

  const typeChips = h('div.chips');
  const drawTypes = () => {
    clear(typeChips);
    for (const [k, label, ic] of TYPES) typeChips.append(h(`button.chip${memory.type === k ? '.on' : ''}`, { onclick: () => ((memory.type = k), drawTypes(), drawTarget(), reset()) }, icon(memory.type === k ? 'check' : ic), label));
  };

  const searchInput = h('input.input', {
    placeholder: 'Поиск…',
    value: memory.query,
    oninput: () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => ((memory.query = searchInput.value), reset()), 300);
    },
  });
  const sortSel = select(
    SORTS.map(([v, l]) => ({ value: v, label: l })),
    memory.sort,
    (v) => ((memory.sort = v), reset()),
  );
  sortSel.style.width = '200px';
  sortSel.style.height = '52px';
  sortSel.style.borderRadius = '26px';

  const targetSlot = h('div');
  const drawTarget = () => {
    clear(targetSlot);
    if (memory.type === 'modpack') return;
    const opts = [{ value: '', label: 'Все версии (без сборки)' }, ...state.instances.map((i) => ({ value: i.id, label: `${i.name} · ${i.gameVersion} ${i.loader !== 'vanilla' ? i.loader : ''}` }))];
    const sel = select(opts, memory.instanceId || '', (v) => ((memory.instanceId = v || null), reset()));
    sel.style.width = '280px';
    sel.style.height = '52px';
    sel.style.borderRadius = '26px';
    targetSlot.append(sel);
  };

  const results = h('div.results');
  const pager = h('div.pager');
  page.append(
    head,
    h('div.browse-bar', {}, h('div.search', {}, icon('search'), searchInput), sortSel, targetSlot),
    h('div.row', { style: { marginBottom: '16px' } }, typeChips),
    results,
    pager,
  );

  const reset = () => {
    offset = 0;
    load();
  };

  const load = async () => {
    const my = ++token;
    clear(results).append(...Array.from({ length: 6 }, () => h('div.result.glass', { style: { opacity: 0.5 } }, h('div.ricon'), h('div.grow', {}, h('div.progress.indeterminate', {}, h('div'))))));
    clear(pager);
    const inst = instance();
    try {
      const res = await api('content:search', {
        platform: memory.platform,
        type: memory.type,
        query: memory.query,
        sort: memory.sort,
        offset,
        limit: PAGE,
        gameVersion: memory.type !== 'modpack' ? inst?.gameVersion : undefined,
        loader: memory.type === 'mod' ? inst?.loader : undefined,
      });
      if (my !== token) return;
      clear(results);
      if (!res.hits.length) results.append(h('div.empty.glass', { style: { gridColumn: '1 / -1' } }, icon('search_off'), h('div.muted', {}, 'Ничего не нашлось')));
      for (const hit of res.hits) results.append(resultCard(hit));
      drawPager(res.total);
    } catch (e) {
      if (my !== token) return;
      clear(results).append(
        h(
          'div.empty.glass',
          { style: { gridColumn: '1 / -1' } },
          h('div.big-icon', {}, icon(memory.platform === 'curseforge' ? 'key' : 'cloud_off')),
          h('div', {}, e.message),
          memory.platform === 'curseforge' && btn('Открыть настройки', { kind: 'tonal', onClick: () => navigate('settings', { section: 'platforms' }) }),
        ),
      );
    }
  };

  const drawPager = (total) => {
    clear(pager);
    const pages = Math.ceil(total / PAGE);
    if (pages <= 1) return;
    const cur = Math.floor(offset / PAGE) + 1;
    pager.append(
      iconBtn('chevron_left', { onClick: () => cur > 1 && ((offset -= PAGE), load(), page.scrollTo({ top: 0, behavior: 'smooth' })) }),
      h('span.muted', {}, `${cur} из ${pages}`),
      iconBtn('chevron_right', { onClick: () => cur < pages && ((offset += PAGE), load(), page.scrollTo({ top: 0, behavior: 'smooth' })) }),
    );
  };

  const resultCard = (hit) => {
    const installBtn = h(
      'button.add-fab',
      {
        title: memory.type === 'modpack' ? 'Установить модпак' : instance() ? `Добавить в «${instance().name}»` : 'Установить',
        onclick: (e) => {
          e.stopPropagation();
          quickInstall(installBtn, hit);
        },
      },
      icon('download'),
    );
    return h(
      'div.result.glass',
      { onclick: () => openProject(hit) },
      h('div.ricon', {}, hit.icon ? h('img', { src: hit.icon, alt: '', loading: 'lazy' }) : icon('extension')),
      h(
        'div.grow',
        { style: { minWidth: 0 } },
        h('div.rtitle.ellipsis', {}, hit.title),
        h('div.small.muted.ellipsis', {}, hit.author ? `от ${hit.author}` : ''),
        h('div.rdesc', {}, hit.description),
        h('div.stats', {}, h('span', {}, icon('download'), ' ', fmtNum(hit.downloads)), hit.follows != null && h('span', {}, icon('favorite'), ' ', fmtNum(hit.follows)), h('span', {}, icon('update'), ' ', fmtDate(hit.updated))),
      ),
      installBtn,
    );
  };

  const quickInstall = (button, hit) =>
    busy(button, async () => {
      if (memory.type === 'modpack') {
        const inst = await api('content:installPack', hit.platform, hit.id, null, hit.title);
        await refreshInstances();
        toast(`«${inst.name}» установлена`, { action: { label: 'Открыть', onClick: () => navigate('instance', { id: inst.id }) } });
        return;
      }
      const inst = instance();
      if (!inst) return pickInstance(hit);
      await api('content:install', inst.id, { platform: hit.platform, projectId: hit.id, type: memory.type, title: hit.title });
      if (button.classList.contains('add-fab')) button.replaceWith(h('button.add-fab.done', { title: 'Установлено' }, icon('check')));
      else button.replaceWith(h('span.tag.primary', {}, icon('check'), 'Установлено'));
    });

  const pickInstance = (hit, versionId) => {
    const s = sheet({ content: h('div') });
    const compatible = state.instances;
    s.panel.append(
      h('div.dialog-head', {}, h('h2', {}, `Куда установить «${hit.title}»?`), iconBtn('close', { onClick: s.close })),
      h(
        'div.sheet-body',
        {},
        h(
          'div.list.glass',
          {},
          compatible.length
            ? compatible.map((i) => {
                const b = btn('Установить', {
                  kind: 'tonal',
                  onClick: () =>
                    busy(b, async () => {
                      await api('content:install', i.id, { platform: hit.platform, projectId: hit.id, versionId, type: memory.type, title: hit.title });
                      b.replaceWith(h('span.tag.primary', {}, icon('check'), 'Готово'));
                    }),
                });
                return h('div.list-item', {}, h('div.li-main', {}, h('div.li-title', {}, i.name), h('div.row', { style: { gap: '6px', marginTop: '4px' } }, h('span.tag', {}, i.gameVersion), loaderTag(i.loader))), b);
              })
            : h('div.muted', { style: { padding: '20px' } }, 'Сначала создайте сборку'),
        ),
      ),
    );
  };

  const openProject = async (hit) => {
    const body = h('div.sheet-body', {}, h('div.row', { style: { justifyContent: 'center', padding: '60px' } }, h('span.spinner')));
    const s = sheet({ content: [h('div.dialog-head', {}, h('div.ricon', { style: { width: '56px', height: '56px', borderRadius: '14px', overflow: 'hidden', background: 'var(--surface-highest)' } }, hit.icon && h('img', { src: hit.icon, style: { width: '100%', height: '100%' } })), h('div.grow', {}, h('h2', {}, hit.title), h('div.muted.small', {}, hit.author ? `от ${hit.author}` : '')), iconBtn('close', { onClick: () => s.close() })), body] });
    try {
      const inst = instance();
      const [project, versions] = await Promise.all([
        api('content:project', hit.platform, hit.id),
        api('content:versions', hit.platform, hit.id, memory.type === 'modpack' ? {} : { gameVersion: inst?.gameVersion, loaders: inst && inst.loader !== 'vanilla' && memory.type === 'mod' ? (inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]) : undefined }),
      ]);
      const tabs = h('div.tabs');
      const tabBody = h('div');
      const show = (k) => {
        clear(tabs);
        for (const [key, label] of [
          ['about', 'Описание'],
          ['versions', `Версии (${versions.length})`],
          ['gallery', 'Галерея'],
        ]) {
          if (key === 'gallery' && !project.gallery?.length) continue;
          tabs.append(h(`button.tab${k === key ? '.on' : ''}`, { onclick: () => show(key) }, label));
        }
        clear(tabBody);
        if (k === 'about') tabBody.append(h('div.md', { html: sanitize(project.bodyIsHtml ? project.body : markdown(project.body)) }));
        if (k === 'gallery') tabBody.append(h('div.col', {}, project.gallery.map((g) => h('img', { src: g, style: { width: '100%', borderRadius: '16px' }, loading: 'lazy' }))));
        if (k === 'versions') {
          const list = h('div.list.glass');
          for (const v of versions.slice(0, 60)) {
            const b = btn(memory.type === 'modpack' ? 'Установить' : 'Добавить', {
              kind: 'tonal',
              icon: 'download',
              onClick: () =>
                busy(b, async () => {
                  if (memory.type === 'modpack') {
                    const created = await api('content:installPack', hit.platform, hit.id, v.id, project.title);
                    await refreshInstances();
                    s.close();
                    navigate('instance', { id: created.id });
                    return;
                  }
                  if (!inst) return pickInstance(hit, v.id);
                  await api('content:install', inst.id, { platform: hit.platform, projectId: hit.id, versionId: v.id, type: memory.type, title: project.title });
                  b.replaceWith(h('span.tag.primary', {}, icon('check'), 'Готово'));
                }),
            });
            list.append(
              h(
                'div.list-item',
                {},
                h('div.li-main', {}, h('div.li-title.ellipsis', {}, v.name), h('div.li-sub.ellipsis', {}, [v.gameVersions.slice(0, 4).join(', '), v.loaders.join(', '), fmtDate(v.date)].filter(Boolean).join(' · '))),
                h(`span.tag${v.type === 'release' ? '.primary' : ''}`, {}, { release: 'Релиз', beta: 'Бета', alpha: 'Альфа' }[v.type] || v.type),
                b,
              ),
            );
          }
          if (!versions.length) list.append(h('div.muted', { style: { padding: '20px' } }, inst ? `Нет версий для ${inst.gameVersion} ${inst.loader}` : 'Нет версий'));
          tabBody.append(list);
        }
      };
      const main = btn(memory.type === 'modpack' ? 'Установить модпак' : inst ? `Добавить в «${inst.name}»` : 'Установить', {
        icon: 'download',
        kind: 'play',
        onClick: () => quickInstall(main, hit),
      });
      clear(body).append(
        h('p.muted', { style: { marginTop: 0, lineHeight: 1.5 } }, project.description),
        h(
          'div.row.wrap',
          { style: { gap: '8px', marginBottom: '6px' } },
          main,
          project.links?.page && btn('На сайте', { kind: 'outlined', icon: 'open_in_new', onClick: () => api('app:openExternal', project.links.page) }),
          project.links?.source && btn('Исходники', { kind: 'text', icon: 'code', onClick: () => api('app:openExternal', project.links.source) }),
          project.links?.discord && btn('Discord', { kind: 'text', icon: 'forum', onClick: () => api('app:openExternal', project.links.discord) }),
        ),
        h('div.row.wrap', { style: { gap: '6px' } }, (project.categories || []).slice(0, 8).map((c) => h('span.tag', {}, c)), h('span.tag', {}, icon('download'), fmtNum(project.downloads))),
        tabs,
        tabBody,
      );
      show('about');
    } catch (e) {
      clear(body).append(h('div.muted', { style: { padding: '30px' } }, e.message));
    }
  };

  drawTypes();
  drawTarget();
  load();
}
