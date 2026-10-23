const crypto = require('crypto');

// Long-running jobs (installs, downloads) report here; main.js forwards every change to the UI.
let broadcast = () => {};
const active = new Map();

function setBroadcaster(fn) {
  broadcast = fn;
}

function emit(task) {
  broadcast('task:update', { ...task });
}

function create(title) {
  const task = { id: crypto.randomUUID(), title, status: '', progress: -1, state: 'running' };
  active.set(task.id, task);
  emit(task);
  return {
    id: task.id,
    update(status, progress) {
      if (status != null) task.status = status;
      if (progress != null) task.progress = progress;
      emit(task);
    },
    done(status = 'Готово') {
      task.state = 'done';
      task.status = status;
      task.progress = 1;
      emit(task);
      active.delete(task.id);
    },
    fail(err) {
      task.state = 'error';
      task.status = err?.message || String(err);
      emit(task);
      active.delete(task.id);
    },
  };
}

// Runs fn with a task and marks it failed/done automatically.
async function run(title, fn) {
  const task = create(title);
  try {
    const result = await fn(task);
    task.done();
    return result;
  } catch (e) {
    task.fail(e);
    throw e;
  }
}

module.exports = { create, run, setBroadcaster, emit: (...a) => broadcast(...a) };
