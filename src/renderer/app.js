(async function init() {
  const el = document.getElementById('info');
  try {
    const info = await window.mockingbird.invoke('app:info');
    el.textContent = `${info.name} v${info.version} on ${info.platform}`;
  } catch (err) {
    el.textContent = `Could not load app info: ${err.message}`;
  }
})();
