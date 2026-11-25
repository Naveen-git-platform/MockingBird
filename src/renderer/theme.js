/* Applies the chosen colour theme and follows live changes. Loaded by every window. */
(function () {
  const api = window.mockingbird;
  if (!api) return;
  const apply = (id) => {
    if (typeof id === 'string' && id) document.documentElement.dataset.theme = id;
  };
  api.invoke('config:get', 'ui.theme').then(apply).catch(() => {});
  api.on('theme:changed', ({ theme }) => apply(theme));
})();
