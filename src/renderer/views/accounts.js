import { h, icon, btn, clear, dialog, toast, api, field } from '../ui.js';
import { state, refreshAccounts, saveSettings } from '../state.js';

// Microsoft sign-in, Prism-style: the browser opens straight away and the launcher catches the result;
// a QR + code is shown alongside for signing in from a phone. Calls onDone(account) on success.
export function accountForms(host, onDone, setActions = () => {}) {
  let loginId = null;

  const missingClientId = () => {
    clear(host);
    const input = h('input.input', { placeholder: '00000000-0000-0000-0000-000000000000' });
    host.append(
      h(
        'div.col',
        { style: { gap: '12px' } },
        h('p.muted', { style: { margin: 0, lineHeight: 1.55 } }, 'В этой сборке WayTester не прописан Microsoft Client ID (файл src/main/oauth.json). Укажите ID своего приложения Azure, одобренного Mojang:'),
        field('Azure Client ID', input),
      ),
    );
    setActions([
      btn('Как получить', { kind: 'text', icon: 'open_in_new', onClick: () => api('app:openExternal', 'https://aka.ms/mce-reviewappid') }),
      btn('Сохранить', {
        onClick: async () => {
          const id = input.value.trim();
          if (!/^[0-9a-f-]{36}$/i.test(id)) return toast('Client ID — это GUID вида 1234abcd-…', { error: true });
          await saveSettings({ msClientId: id });
          intro();
        },
      }),
    ]);
  };

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
      if (e.code === 'NO_CLIENT_ID') return missingClientId();
      return failed(e.message);
    }
    loginId = login.loginId;
    api('app:openExternal', login.authUrl);

    const browserSide = h(
      'div.login-side',
      {},
      h('div.login-icon', {}, icon('open_in_browser')),
      h('div.login-title', {}, 'Завершите вход в браузере'),
      h('div.muted.small', {}, 'Мы открыли страницу Microsoft. Войдите в аккаунт с купленной Minecraft: Java Edition — WayTester подхватит вход сам.'),
      h('div.row', { style: { gap: '10px', marginTop: '6px' } }, h('span.spinner.sm'), h('span.muted.small', {}, 'Ожидание входа…')),
      btn('Открыть ещё раз', { kind: 'tonal', icon: 'open_in_new', onClick: () => api('app:openExternal', login.authUrl) }),
    );
    const phoneSide =
      login.device &&
      h(
        'div.login-side',
        {},
        h('img.login-qr', { src: login.device.qr, alt: 'QR-код входа' }),
        h('div.muted.small', {}, 'Или отсканируйте QR телефоном / введите код на ', h('a', { href: login.device.url, onclick: (e) => (e.preventDefault(), api('app:openExternal', login.device.url)) }, 'microsoft.com/link')),
        h('button.code-chip', { title: 'Скопировать', onclick: () => (navigator.clipboard.writeText(login.device.userCode), toast('Код скопирован')) }, login.device.userCode, icon('content_copy')),
      );
    clear(host).append(h('div.login-grid', {}, browserSide, phoneSide && h('div.login-or', {}, h('span', {}, 'или')), phoneSide));
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

  api('accounts:hasClientId').then((ok) => (ok ? intro() : missingClientId()));
  return { cancel: () => loginId && api('accounts:msCancel', loginId) };
}

export function openAddAccount() {
  let forms = null;
  const d = dialog({ title: 'Добавить аккаунт', icon: 'person_add', body: h('div'), onClose: () => forms?.cancel() });
  d.box.style.width = 'min(680px, calc(100vw - 48px))';
  forms = accountForms(d.body, () => d.close(), (actions) => d.setActions(actions));
}
