import { h, icon, btn, iconBtn, clear, toast, api, segmented, busy, prompt, confirm } from '../ui.js';
import { state, on, refreshAccounts, selectedAccount } from '../state.js';
import { drawBody, drawCape } from '../skin2d.js';
import { openAddAccount } from './accounts.js';

export function skinsView(page, params) {
  const sv = window.skinview3d;
  let library = [];
  let current = null; // account's skin info from main
  let preview = null; // { data, variant, id? }
  let animation = 'idle';

  const canvas = h('canvas');
  const wrap = h('div.viewer-wrap', {}, canvas, h('div.pedestal'));
  const viewer = new sv.SkinViewer({ canvas, width: 360, height: 460, zoom: 0.82, fov: 50 });
  viewer.autoRotate = false;
  viewer.background = null;
  viewer.controls.enableZoom = true;
  const setAnimation = (name) => {
    animation = name;
    viewer.animation = name === 'walk' ? new sv.WalkingAnimation() : name === 'run' ? new sv.RunningAnimation() : name === 'fly' ? new sv.FlyingAnimation() : new sv.IdleAnimation();
    if (name === 'walk' || name === 'run') viewer.animation.speed = name === 'run' ? 0.7 : 0.9;
  };
  setAnimation('idle');

  const resize = () => {
    const r = wrap.getBoundingClientRect();
    if (r.width > 0) viewer.setSize(Math.min(r.width, 440), Math.max(360, Math.min(r.height, 560)));
  };
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  const showPreview = async (p) => {
    preview = p;
    try {
      await viewer.loadSkin(p?.data || state.defaultSkin, { model: p?.variant === 'slim' ? 'slim' : 'default' });
    } catch {}
    drawLibrary();
    drawControls();
  };

  const accountBar = h('div.row.wrap', { style: { gap: '8px' } });
  const banner = h('div');
  const controls = h('div.col', { style: { gap: '12px', position: 'relative' } });
  const capesSlot = h('div');
  const libGrid = h('div.skin-grid');

  page.append(
    h(
      'div.page-head',
      {},
      h('div.grow', {}, h('h1.page-title', {}, 'Скины'), h('div.page-sub', {}, 'Библиотека скинов, 3D-примерка и плащи')),
      btn('По нику', {
        kind: 'outlined',
        icon: 'person_search',
        onClick: async () => {
          const name = await prompt('Скин игрока', { label: 'Ник Minecraft', placeholder: 'Notch', okLabel: 'Добавить' });
          if (!name) return;
          try {
            const s = await api('skins:importName', name);
            library.unshift(s);
            showPreview(s);
          } catch (e) {
            toast(e.message, { error: true });
          }
        },
      }),
      btn('Загрузить PNG', {
        icon: 'upload',
        onClick: async () => {
          const added = await api('skins:addFile', 'classic').catch((e) => (toast(e.message, { error: true }), []));
          if (added.length) {
            library.unshift(...added);
            showPreview(added[0]);
          }
        },
      }),
    ),
    h(
      'div.skins-layout',
      {},
      h('div.viewer-card.glass', {}, wrap, controls),
      h('div.col', { style: { gap: '14px', minWidth: 0, overflowY: 'auto' } }, h('div.glass.card', { style: { padding: '16px' } }, accountBar, banner, capesSlot), h('div.section-title', { style: { margin: '6px 0 0' } }, icon('collections'), 'Библиотека'), libGrid),
    ),
  );

  const drawControls = () => {
    clear(controls);
    const acc = selectedAccount();
    const canApply = preview?.id && acc && current?.editable;
    const applyBtn = btn('Надеть', {
      icon: 'checkroom',
      kind: 'play',
      disabled: !canApply,
      onClick: () =>
        busy(applyBtn, async () => {
          current = await api('skins:apply', acc.id, preview.id);
          toast('Скин обновлён в Minecraft');
          refreshAccounts();
          drawLibrary();
        }),
    });
    controls.append(
      h(
        'div.row.wrap',
        { style: { justifyContent: 'center', gap: '8px' } },
        segmented(
          [
            { value: 'idle', label: 'Стоит' },
            { value: 'walk', label: 'Ходьба' },
            { value: 'run', label: 'Бег' },
            { value: 'fly', label: 'Полёт' },
          ],
          animation,
          setAnimation,
        ),
      ),
      h(
        'div.row',
        { style: { justifyContent: 'center', gap: '8px' } },
        preview?.id &&
          segmented(
            [
              { value: 'classic', label: 'Classic' },
              { value: 'slim', label: 'Slim' },
            ],
            preview.variant,
            async (v) => {
              preview.variant = v;
              await api('skins:update', preview.id, { variant: v });
              showPreview(preview);
            },
          ),
        iconBtn('3d_rotation', { title: 'Вращение', onClick: () => (viewer.autoRotate = !viewer.autoRotate) }),
        current?.skin && preview?.data !== current.skin && iconBtn('restart_alt', { title: 'Показать текущий скин', onClick: () => showPreview({ data: current.skin, variant: current.variant }) }),
      ),
      h('div.row', { style: { justifyContent: 'center' } }, applyBtn),
    );
  };

  const drawAccounts = async () => {
    clear(accountBar);
    clear(banner);
    clear(capesSlot);
    const acc = selectedAccount();
    for (const a of state.accounts.list) {
      accountBar.append(
        h(`button.chip${a.id === acc?.id ? '.on' : ''}`, { onclick: async () => (await api('accounts:select', a.id), refreshAccounts()) }, icon('verified'), a.name),
      );
    }
    accountBar.append(h('button.chip', { onclick: () => openAddAccount() }, icon('add'), 'Аккаунт'));
    if (!acc) {
      banner.append(h('p.muted', {}, 'Войдите в аккаунт Microsoft, чтобы менять скин и плащ.'));
      showPreview(null);
      return;
    }
    banner.append(h('div.row', { style: { marginTop: '12px' } }, h('span.spinner.sm'), h('span.muted', {}, 'Загрузка профиля…')));
    try {
      current = await api('skins:current', acc.id);
    } catch (e) {
      current = null;
      clear(banner).append(h('p', { style: { color: 'var(--error)' } }, e.message));
      return;
    }
    clear(banner);
    banner.append(h('p.muted.small', { style: { margin: '12px 2px 0', lineHeight: 1.5 } }, 'Скин и плащ меняются прямо в профиле Minecraft и видны всем на серверах.'));
    if (current?.capes?.length) {
      const capes = h('div.capes');
      const none = h(`button.cape${current.capes.some((c) => c.active) ? '' : '.on'}`, { title: 'Без плаща', onclick: () => setCape(null) }, icon('block'));
      capes.append(none);
      for (const c of current.capes) {
        const cv = h('canvas');
        drawCape(cv, c.data);
        capes.append(h(`button.cape${c.active ? '.on' : ''}`, { title: c.alias, onclick: () => setCape(c.id), onmouseenter: () => viewer.loadCape(c.data).catch(() => {}) }, cv));
      }
      capesSlot.append(h('div.section-title', { style: { margin: '16px 0 8px' } }, icon('flag'), 'Плащи'), capes);
    }
    const activeCape = current?.capes?.find((c) => c.active);
    viewer.loadCape(activeCape ? activeCape.data : null).catch(() => {});
    showPreview(current?.skin ? { data: current.skin, variant: current.variant } : null);
  };

  const setCape = async (id) => {
    try {
      current = await api('skins:setCape', selectedAccount().id, id);
      drawAccounts();
      toast('Плащ обновлён');
    } catch (e) {
      toast(e.message, { error: true });
    }
  };

  const drawLibrary = () => {
    clear(libGrid);
    if (!library.length) {
      libGrid.append(h('div.empty.glass', { style: { gridColumn: '1 / -1', padding: '40px' } }, icon('add_photo_alternate'), h('div.muted', {}, 'Загрузите PNG, перетащите файл в окно или добавьте скин по нику')));
      return;
    }
    const acc = selectedAccount();
    for (const s of library) {
      const cv = h('canvas');
      drawBody(cv, s.data, s.variant === 'slim');
      const isActive = current?.skin && current.skin === s.data;
      libGrid.append(
        h(
          `div.skin-tile.glass${preview?.id === s.id ? '.selected' : ''}`,
          { onclick: () => showPreview(s) },
          isActive && h('span.active-badge', {}, icon('check_circle', 'fill')),
          iconBtn('delete', {
            cls: 'sm del',
            title: 'Удалить',
            onClick: async (e) => {
              e.stopPropagation();
              if (!(await confirm('Удалить скин?', s.name))) return;
              await api('skins:remove', s.id);
              library = library.filter((x) => x.id !== s.id);
              drawLibrary();
            },
          }),
          cv,
          h('div.name.ellipsis', {}, s.name),
          h('div.muted.small', {}, s.variant === 'slim' ? 'Slim' : 'Classic'),
        ),
      );
    }
  };

  params.onDrop = (files) => {
    const pngs = files.filter((f) => /\.png$/i.test(f.name));
    if (!pngs.length) return false;
    (async () => {
      for (const f of pngs) {
        try {
          library.unshift(await api('skins:addPath', f.path, 'classic'));
        } catch (e) {
          toast(e.message, { error: true });
        }
      }
      showPreview(library[0]);
    })();
    return true;
  };

  (async () => {
    library = await api('skins:list');
    drawLibrary();
    drawControls();
    await drawAccounts();
  })();

  const off = on('accounts', drawAccounts);
  return () => {
    off();
    ro.disconnect();
    viewer.dispose();
  };
}
