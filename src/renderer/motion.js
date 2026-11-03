// Material motion: feedback at the point of interaction, with a reduced-motion exit.
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
export const motionEnabled = () => !reduced.matches && !document.body.classList.contains('reduce-motion');

export function animateRouteChange(view, previous) {
  if (!motionEnabled()) return;
  const entering = view.firstElementChild;
  if (!entering) return;
  const timing = { easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' };
  if (previous) {
    previous.classList.add('route-leaving');
    previous.style.animation = 'none';
    previous.inert = true;
    previous.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    view.append(previous);
    const leaving = previous.animate([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-8px)' },
    ], { ...timing, duration: 180 });
    leaving.finished.catch(() => {}).finally(() => previous.remove());
    // A background/minimized window must not retain an outgoing page indefinitely.
    setTimeout(() => previous.remove(), 500);
  }
  const arrival = entering.animate([
    { opacity: 0, transform: 'translateY(16px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], { ...timing, duration: 360 });
  arrival.finished.then(() => arrival.cancel()).catch(() => {});
}

export function setupMotion() {
  const ripple = (button, x, y) => {
    if (!motionEnabled() || button.disabled) return;
    const bounds = button.getBoundingClientRect();
    const size = Math.hypot(bounds.width, bounds.height) * 2;
    const ink = document.createElement('span');
    ink.className = 'state-ripple';
    ink.setAttribute('aria-hidden', 'true');
    Object.assign(ink.style, {
      width: `${size}px`, height: `${size}px`,
      left: `${x ?? bounds.width / 2}px`, top: `${y ?? bounds.height / 2}px`,
    });
    button.append(ink);
    ink.addEventListener('animationend', () => ink.remove(), { once: true });
  };
  const selector = '.btn, .fab, .icon-btn, .rail-item, .appearance-shortcut, .play-fab, .chip, .segmented button';
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const button = event.target.closest(selector);
    if (!button) return;
    const rect = button.getBoundingClientRect();
    ripple(button, event.clientX - rect.left, event.clientY - rect.top);
  });
  document.addEventListener('keydown', event => {
    if (event.repeat || !['Enter', ' '].includes(event.key)) return;
    const button = event.target.closest(selector);
    if (button) ripple(button);
  });
}
