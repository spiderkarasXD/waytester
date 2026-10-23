// Shared app state with tiny pub/sub so views can re-render on changes.
import { api } from './ui.js';

const listeners = new Map();

export const state = {
  settings: {},
  accounts: { selected: null, list: [] },
  instances: [],
  tasks: new Map(),
  logs: new Map(),
  running: new Set(),
  defaultSkin: null,
  info: {},
};

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) fn(payload);
}

export async function refreshInstances() {
  state.instances = await api('instances:list');
  for (const i of state.instances) if (i.running) state.running.add(i.id);
  emit('instances');
  return state.instances;
}

export async function refreshAccounts() {
  state.accounts = await api('accounts:list');
  emit('accounts');
  return state.accounts;
}

export async function saveSettings(patch) {
  state.settings = await api('settings:set', patch);
  emit('settings');
  return state.settings;
}

export const selectedAccount = () => state.accounts.list.find((a) => a.id === state.accounts.selected) || null;
