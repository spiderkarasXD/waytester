// Small DOM toolkit: element builder, dialogs, menus, toasts.

export const api = (channel, ...args) => window.render.invoke(channel, ...args);

export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const icon = (name, cls = '') => h(`span.icon${cls ? `.${cls}` : ''}`, {}, name);

export function btn(label, { icon: ic, kind = 'filled', onClick, cls = '', title, disabled } = {}) {
  return h(`button.btn.${kind}${ic ? '.has-icon' : ''}${cls ? `.${cls}` : ''}`, { onclick: onClick, title, disabled }, ic && icon(ic), label);
}

export function iconBtn(name, { onClick, title, cls = '' } = {}) {
  return h(`button.icon-btn${cls ? `.${cls}` : ''}`, { onclick: onClick, title }, icon(name));
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// Runs an async action while showing a spinner on the button; reports errors as a toast.
export async function busy(button, fn) {
  const prev = [...button.childNodes];
  button.disabled = true;
  clear(button).append(h('span.spinner.sm'));
  try {
    return await fn();
  } catch (e) {
    toast(e.message, { error: true });
  } finally {
    button.disabled = false;
    clear(button).append(...prev);
  }
}

// ---------- toasts ----------

export function toast(message, { error = false, action, timeout = error ? 7000 : 3800 } = {}) {
  const host = document.getElementById('toasts');
  const el = h(
    `div.toast${error ? '.error' : ''}`,
    {},
    icon(error ? 'error' : 'check_circle'),
    h('div.grow', {}, cleanError(message)),
    action && btn(action.label, { kind: 'text', onClick: () => (action.onClick(), close()) }),
    h('button.icon-btn.sm', { onclick: () => close() }, icon('close')),
  );
  host.append(el);
  const close = () => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 200);
  };
  setTimeout(close, timeout);
}

export function cleanError(msg) {
  return String(msg || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------- dialogs ----------

export function dialog({ title, icon: ic, body, actions = [], wide = false, onClose, dismissable = true }) {
  const overlays = document.getElementById('overlays');
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    scrim.classList.add('closing');
    setTimeout(() => scrim.remove(), 180);
    document.removeEventListener('keydown', onKey);
    onClose?.(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) close();
  };
  const bodyEl = h('div.dialog-body', {}, body);
  const actionsEl = h('div.dialog-actions');
  const box = h(
    `div.dialog.glass${wide ? '.wide' : ''}`,
    { onclick: (e) => e.stopPropagation() },
    h('div.dialog-head', {}, ic && h('div.oc-icon', { style: { width: '40px', height: '40px', borderRadius: '12px', display: 'grid', placeItems: 'center', background: 'var(--secondary-container)', color: 'var(--on-secondary-container)' } }, icon(ic)), h('h2', {}, title), dismissable && iconBtn('close', { onClick: () => close() })),
    bodyEl,
    actionsEl,
  );
  const setActions = (list) => {
    clear(actionsEl);
    for (const a of list) actionsEl.append(a instanceof Node ? a : btn(a.label, { kind: a.kind || 'text', icon: a.icon, onClick: () => a.onClick(close) }));
    actionsEl.style.display = list.length ? '' : 'none';
  };
  setActions(actions);
  const scrim = h('div.scrim', { onmousedown: (e) => e.target === scrim && dismissable && close() }, box);
  overlays.append(scrim);
  document.addEventListener('keydown', onKey);
  return { close, body: bodyEl, box, setActions };
}

export function confirm(title, text, { okLabel = 'Удалить', danger = true } = {}) {
  return new Promise((resolve) => {
    dialog({
      title,
      body: h('p.muted', { style: { margin: 0, lineHeight: 1.5 } }, text),
      actions: [
        { label: 'Отмена', onClick: (c) => c(false) },
        { label: okLabel, kind: danger ? 'danger' : 'filled', onClick: (c) => c(true) },
      ],
      onClose: (r) => resolve(!!r),
    });
  });
}

export function prompt(title, { label, value = '', placeholder = '', okLabel = 'Готово' } = {}) {
  return new Promise((resolve) => {
    const input = h('input.input', { value, placeholder });
    const d = dialog({
      title,
      body: h('div.field', {}, label && h('label', {}, label), input),
      actions: [
        { label: 'Отмена', onClick: (c) => c(null) },
        { label: okLabel, kind: 'filled', onClick: (c) => c(input.value.trim()) },
      ],
      onClose: (r) => resolve(r ?? null),
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && d.close(input.value.trim()));
    setTimeout(() => input.focus(), 50);
  });
}

// Bottom sheet that slides in from the right (project details etc).
export function sheet({ content, onClose }) {
  const overlays = document.getElementById('overlays');
  const close = () => {
    scrim.classList.add('closing');
    setTimeout(() => scrim.remove(), 180);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const panel = h('div.sheet.glass', { onclick: (e) => e.stopPropagation() }, content);
  const scrim = h('div.scrim.sheet-scrim', { onmousedown: (e) => e.target === scrim && close() }, panel);
  overlays.append(scrim);
  document.addEventListener('keydown', onKey);
  return { close, panel };
}

// ---------- menus ----------

export function menu(anchor, items, { align = 'right' } = {}) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const el = h(
    'div.menu.glass',
    {},
    items.filter(Boolean).map((it) =>
      it === '-'
        ? h('div.menu-sep')
        : it instanceof Node
          ? it
          : h(`button.menu-item${it.danger ? '.danger' : ''}`, { onclick: () => (close(), it.onClick()) }, it.icon && icon(it.icon), h('span.grow', {}, it.label), it.hint && h('span.muted.small', {}, it.hint)),
    ),
  );
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let left = align === 'right' ? r.right - w : r.left;
  let top = r.bottom + 6;
  if (top + hgt > innerHeight - 10) top = Math.max(10, r.top - hgt - 6);
  left = Math.max(10, Math.min(left, innerWidth - w - 10));
  Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
  const close = () => {
    el.remove();
    document.removeEventListener('mousedown', outside, true);
  };
  const outside = (e) => !el.contains(e.target) && close();
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  return { close, el };
}

export function popover(anchor, content) {
  return menu(anchor, [content]);
}

// ---------- form helpers ----------

export function field(label, control, hint) {
  return h('div.field', {}, h('label', {}, label), control, hint && h('div.muted.small', { style: { paddingLeft: '4px' } }, hint));
}

export function switchEl(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  return h('label.switch', {}, input, h('span.track'), h('span.thumb'));
}

export function slider({ min, max, step = 1, value, onInput }) {
  const el = h('input.slider', { type: 'range', min, max, step, value });
  const paint = () => el.style.setProperty('--p', `${((el.value - min) / (max - min)) * 100}%`);
  el.addEventListener('input', () => {
    paint();
    onInput(Number(el.value));
  });
  paint();
  return el;
}

export function segmented(options, value, onChange) {
  const el = h('div.segmented');
  const render = () => {
    clear(el);
    for (const o of options) {
      el.append(
        h(`button${o.value === value ? '.on' : ''}`, { onclick: () => ((value = o.value), render(), onChange(o.value)) }, icon('check'), o.icon && o.value !== value && icon(o.icon), o.label),
      );
    }
  };
  render();
  return el;
}

export function select(options, value, onChange) {
  const el = h('select.select', { onchange: () => onChange(el.value) }, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  return el;
}

// ---------- formatting ----------

export function fmtNum(n) {
  if (n == null) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} млн`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} тыс`;
  return String(n);
}

export function fmtDate(ts) {
  if (!ts) return 'никогда';
  const d = new Date(ts);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDuration(sec) {
  if (!sec) return '0 мин';
  const hrs = Math.floor(sec / 3600);
  const min = Math.floor((sec % 3600) / 60);
  return hrs ? `${hrs} ч ${min} мин` : `${min} мин`;
}

export function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes > 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} МБ`;
  return `${Math.ceil(bytes / 1024)} КБ`;
}

export const LOADERS = {
  vanilla: { label: 'Vanilla', icon: 'grass', color: '#7cc47f' },
  fabric: { label: 'Fabric', icon: 'texture', color: '#dbc496' },
  quilt: { label: 'Quilt', icon: 'grid_on', color: '#ba96f0' },
  forge: { label: 'Forge', icon: 'hardware', color: '#8fb0dc' },
  neoforge: { label: 'NeoForge', icon: 'local_fire_department', color: '#f0965a' },
};

export function loaderTag(loader, version) {
  const l = LOADERS[loader] || LOADERS.vanilla;
  return h(`span.tag.loader-${loader}`, {}, icon(l.icon), l.label, version && loader !== 'vanilla' ? ` ${version}` : '');
}

export function hashHue(str) {
  let x = 0;
  for (const c of str || '') x = (x * 31 + c.charCodeAt(0)) % 360;
  return x;
}

export function instanceIcon(inst, cls = '') {
  const el = h(`div.inst-icon${cls ? `.${cls}` : ''}`, { style: { '--h': hashHue(inst.name) } });
  el.style.setProperty('--h', hashHue(inst.name));
  if (inst.icon) el.append(h('img', { src: inst.icon, alt: '' }));
  else el.append(icon(LOADERS[inst.loader]?.icon || 'deployed_code'));
  return el;
}
