import { api, h, icon, clear, menu, toast, btn, cleanError } from './ui.js';
import { state, on, emit, refreshInstances, refreshAccounts, selectedAccount } from './state.js';
import { applyTheme, applyWallpaper } from './theme.js';
import { drawHead } from './skin2d.js';
import { libraryView } from './views/library.js';
import { instanceView } from './views/instance.js';
import { browseView } from './views/browse.js';
import { skinsView } from './views/skins.js';
import { settingsView } from './views/settings.js';
import { openCreateDialog } from './views/create.js';
import { openAddAccount } from './views/accounts.js';
import { runOnboarding } from './views/onboarding.js';

const views = { library: libraryView, instance: instanceView, browse: browseView, skins: skinsView, settings: settingsView };
let current = { route: null, params: {}, cleanup: null };

export function navigate(route, params = {}) {
  current.cleanup?.();
  const view = document.getElementById('view');
  clear(view);
  const page = h('div.page');
  view.append(page);
  current = { route, params, cleanup: null };
  document.querySelectorAll('.rail-item').forEach((el) => {
    const r = el.dataset.route;
    el.classList.toggle('active', r === route || (route === 'instance' && r === 'library'));
  });
  current.cleanup = views[route](page, params) || null;
}

export const currentRoute = () => current;

// ---------- titlebar ----------

function setupWindowControls() {
  document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => api(`window:${b.dataset.win}`)));
  window.render.on('window:state', ({ maximized }) => {
    document.querySelector('[data-win="maximize"] .icon').textContent = maximized ? 'filter_none' : 'crop_square';
  });
  document.querySelector('.titlebar').addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    api('window:maximize');
  });
}

async function renderAccountChip() {
  const chip = document.getElementById('account-chip');
  const acc = selectedAccount();
  chip.querySelector('.account-name').textContent = acc ? acc.name : 'Войти';
  const canvas = chip.querySelector('canvas');
  let skin = state.defaultSkin;
  if (acc?.type === 'microsoft' && acc.skins?.length) skin = await api('skins:current', acc.id).then((c) => c?.skin || skin).catch(() => skin);
  drawHead(canvas, skin);
}

function accountMenu(anchor) {
  const items = state.accounts.list.map((a) => ({
    icon: a.id === state.accounts.selected ? 'radio_button_checked' : 'radio_button_unchecked',
    label: a.name,
    hint: 'Microsoft',
    onClick: async () => {
      await api('accounts:select', a.id);
      await refreshAccounts();
    },
  }));
  menu(anchor, [...items, items.length && '-', { icon: 'person_add', label: 'Добавить аккаунт', onClick: () => openAddAccount() }, { icon: 'checkroom', label: 'Скины и плащи', onClick: () => navigate('skins') }]);
}

// ---------- tasks ----------

function renderTasksButton() {
  const b = document.getElementById('tasks-btn');
  const runningTasks = [...state.tasks.values()].filter((t) => t.state === 'running');
  const errors = [...state.tasks.values()].filter((t) => t.state === 'error' && !t.seen).length;
  b.classList.toggle('busy', runningTasks.length > 0);
  const known = runningTasks.filter((t) => t.progress >= 0);
  b.classList.toggle('indeterminate', runningTasks.length > 0 && !known.length);
  if (known.length) {
    const avg = known.reduce((s, t) => s + t.progress, 0) / known.length;
    b.querySelector('circle').style.strokeDashoffset = String(100.5 * (1 - avg));
  }
  const badge = b.querySelector('.badge');
  badge.hidden = !(runningTasks.length || errors);
  badge.textContent = errors ? '!' : runningTasks.length;
  badge.style.background = errors ? 'var(--error)' : 'var(--primary)';
  badge.style.color = errors ? '#410002' : 'var(--on-primary)';
}

function taskNode(t) {
  return h(
    `div.task${t.state === 'error' ? '.error' : ''}`,
    {},
    h('div.t-title', {}, icon(t.state === 'done' ? 'check_circle' : t.state === 'error' ? 'error' : 'downloading'), h('span.grow.ellipsis', {}, t.title)),
    t.state === 'running' && h(`div.progress${t.progress < 0 ? '.indeterminate' : ''}`, {}, h('div', { style: { width: `${Math.max(0, t.progress) * 100}%` } })),
    h('div.t-status', { title: t.status }, cleanError(t.status)),
  );
}

function tasksPopover(anchor) {
  const list = [...state.tasks.values()].reverse();
  for (const t of list) t.seen = true;
  renderTasksButton();
  const body = h(
    'div.tasks-pop',
    {},
    list.length ? list.map(taskNode) : h('div.muted', { style: { padding: '30px', textAlign: 'center' } }, 'Загрузок пока нет'),
    list.some((t) => t.state !== 'running') &&
      h('div', { style: { textAlign: 'right', paddingTop: '6px' } }, btn('Очистить', { kind: 'text', onClick: () => {
        for (const [id, t] of state.tasks) if (t.state !== 'running') state.tasks.delete(id);
        renderTasksButton();
        document.querySelector('.menu')?.remove();
      } })),
  );
  const m = menu(anchor, [body]);
  const off = on('tasks', () => {
    if (!document.body.contains(m.el)) return off();
    clear(body).append(...[...state.tasks.values()].reverse().map(taskNode));
  });
}

function setupEvents() {
  window.render.on('task:update', (t) => {
    const prev = state.tasks.get(t.id);
    state.tasks.set(t.id, { ...prev, ...t });
    if (t.state === 'error' && prev?.state !== 'error') toast(`${t.title}: ${t.status}`, { error: true });
    if (t.state === 'done' && prev?.state === 'running' && !/^Запуск/.test(t.title)) toast(`${t.title} — готово`);
    renderTasksButton();
    emit('tasks', t);
  });
  window.render.on('game:log', ({ id, lines }) => {
    if (!state.logs.has(id)) state.logs.set(id, []);
    const log = state.logs.get(id);
    log.push(...lines);
    if (log.length > 6000) log.splice(0, log.length - 5000);
    emit('log', { id, lines });
  });
  window.render.on('game:state', ({ id, running, code }) => {
    if (running) {
      state.running.add(id);
      state.logs.set(id, state.logs.get(id) || []);
    } else state.running.delete(id);
    if (!running && code && code !== 0) {
      const inst = state.instances.find((i) => i.id === id);
      toast(`«${inst?.name || id}» вылетела (код ${code})`, { error: true, action: { label: 'Лог', onClick: () => navigate('instance', { id, tab: 'logs' }) } });
    }
    emit('running', { id, running });
    refreshInstances();
  });
  on('accounts', renderAccountChip);
  on('settings', () => applyTheme(state.settings));
}

// ---------- launch helper used by views ----------

export async function play(instanceId) {
  if (state.running.has(instanceId)) return api('instances:kill', instanceId);
  if (!selectedAccount()) {
    toast('Войдите в аккаунт Microsoft', { error: true, action: { label: 'Войти', onClick: () => openAddAccount() } });
    return;
  }
  state.logs.set(instanceId, []);
  try {
    await api('instances:launch', instanceId);
  } catch (e) {
    // the task toast already shows the error
  }
}

// ---------- drag & drop import ----------

function setupDrop() {
  let depth = 0;
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFiles(e)) return;
    depth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => isFiles(e) && e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    const files = [...e.dataTransfer.files].map((f) => ({ path: window.render.pathForFile(f), name: f.name }));
    if (!files.length) return;
    // Views can claim drops (e.g. skins, mods); otherwise treat it as a modpack import.
    if (current.params?.onDrop?.(files)) return;
    for (const f of files) {
      try {
        await api('import:path', f.path);
      } catch (err) {
        if (err.code !== 'NEEDS_VERSION') continue;
        openCreateDialog({ tab: 'import', folder: f.path });
      }
    }
    refreshInstances();
  });
}

// ---------- boot ----------

async function boot() {
  state.settings = await api('settings:get');
  state.info = await api('app:info');
  applyTheme(state.settings);
  if (state.settings.reduceMotion) document.body.classList.add('reduce-motion');
  api('settings:wallpaperData').then(applyWallpaper);
  document.body.classList.add(`os-${state.info.platform}`);

  setupWindowControls();
  setupEvents();
  setupDrop();
  document.querySelectorAll('.rail-item').forEach((el) => el.addEventListener('click', () => navigate(el.dataset.route)));
  document.getElementById('fab-create').addEventListener('click', () => openCreateDialog());
  document.getElementById('account-chip').addEventListener('click', (e) => accountMenu(e.currentTarget));
  document.getElementById('tasks-btn').addEventListener('click', (e) => tasksPopover(e.currentTarget));

  await Promise.all([refreshInstances(), refreshAccounts()]);
  state.defaultSkin = await api('skins:default').catch(() => null);
  renderAccountChip();
  navigate('library');

  if (!state.settings.onboarded) runOnboarding();
}

boot().catch((e) => {
  document.getElementById('view').append(h('div.empty', {}, h('h2', {}, 'Не удалось запустить интерфейс'), h('pre.muted', {}, e.stack)));
});
