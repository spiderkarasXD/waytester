import { h, icon, btn, clear, dialog, toast, api } from '../ui.js';
import { state, refreshAccounts } from '../state.js';

// Microsoft sign-in: the launcher opens its own login.live.com window and catches the result.
// Calls onDone(account) on success.
export function accountForms(host, onDone, setActions = () => {}) {
  let loginId = null;

  const failed = (message) => {
    clear(host).append(h('div.col', { style: { gap: '10px', alignItems: 'center', textAlign: 'center', padding: '10px 0' } }, h('div.big-icon', { style: { width: '64px', height: '64px', borderRadius: '20px', display: 'grid', placeItems: 'center', background: 'var(--error-container)', color: '#ffdad6' } }, icon('error')), h('p', { style: { margin: 0, lineHeight: 1.5 } }, message)));
    setActions([btn('Назад', { kind: 'text', onClick: intro }), btn('Попробовать снова', { icon: 'refresh', onClick: start })]);
  };

  const start = async () => {
    clear(host).append(h('div.row', { style: { justifyContent: 'center', padding: '40px' } }, h('span.spinner')));
    setActions([]);
    let login;
    try {
      login = await api('accounts:msStart');
    } catch (e) {
      return failed(e.message);
    }
    loginId = login.loginId;

    clear(host).append(
      h(
        'div.login-side',
        {},
        h('div.login-icon', {}, icon('open_in_browser')),
        h('div.login-title', {}, 'Войдите в открывшемся окне'),
        h('div.muted.small', {}, 'Войдите в аккаунт Microsoft с купленной Minecraft: Java Edition — WayTester подхватит вход сам.'),
        h('div.row', { style: { gap: '10px', marginTop: '6px' } }, h('span.spinner.sm'), h('span.muted.small', {}, 'Ожидание входа…')),
      ),
    );
    setActions([btn('Отмена', { kind: 'text', onClick: () => (api('accounts:msCancel', loginId), intro()) })]);

    try {
      const acc = await api('accounts:msWait', loginId);
      await api('accounts:select', acc.id);
      await refreshAccounts();
      toast(`Добро пожаловать, ${acc.name}!`);
      onDone(acc);
    } catch (e) {
      if (!/отмен/i.test(e.message)) failed(e.message);
    }
  };

  const intro = () => {
    clear(host).append(
      h(
        'button.option-card.ms-card',
        { onclick: start },
        h('div.ms-logo', {}, h('span', { style: { background: '#f25022' } }), h('span', { style: { background: '#7fba00' } }), h('span', { style: { background: '#00a4ef' } }), h('span', { style: { background: '#ffb900' } })),
        h('div.grow', {}, h('div', { style: { fontWeight: 600, fontSize: '15px' } }, 'Войти через Microsoft'), h('div.muted.small', {}, 'Лицензия Minecraft: Java Edition — скины, плащи, онлайн-серверы')),
        icon('arrow_forward'),
      ),
    );
    setActions([]);
  };

  intro();
  return { cancel: () => loginId && api('accounts:msCancel', loginId) };
}

export function openAddAccount() {
  let forms = null;
  const d = dialog({ title: 'Добавить аккаунт', icon: 'person_add', body: h('div'), onClose: () => forms?.cancel() });
  d.box.style.width = 'min(680px, calc(100vw - 48px))';
  forms = accountForms(d.body, () => d.close(), (actions) => d.setActions(actions));
}
