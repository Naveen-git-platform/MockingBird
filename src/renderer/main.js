(async function init() {
  const MB = window.MB;
  document.querySelectorAll('.nav-item').forEach((btn) => btn.addEventListener('click', () => MB.show(btn.dataset.view)));

  window.addEventListener('unhandledrejection', (e) => {
    MB.toast(MB.cleanError(e.reason), 'error');
  });

  const info = await MB.call('app:info');
  if (info) document.getElementById('app-info').textContent = `v${info.version}`;

  MB.show(MB.prefs.get('lastView', 'practice'));
  document.querySelectorAll('.nav-item').forEach((btn) => btn.addEventListener('click', () => MB.prefs.set('lastView', btn.dataset.view)));
  document.documentElement.dataset.ready = '1';
})();
