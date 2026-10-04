// A sandbox page keeps Google's Cast library away from extension APIs.
// The device picker needs a click inside this document, so the Cast button lives here too.
(() => {
  const TAG = 'stream-scout';
  const PLAYER = new URL(location.href).origin;
  const LIVE = ['playing', 'paused', 'buffering', 'idle'];
  const button = document.querySelector('#cast');
  const label = document.querySelector('#cast-label');
  let pendingLoad;
  let live = false;

  function show(status) {
    live = LIVE.includes(status.state) && Boolean(status.device);
    button.classList.toggle('live', live);
    if (live) label.textContent = status.device;
    else if (status.state !== 'connecting') label.textContent = 'Cast to TV';
    button.title = live ? `Casting to ${status.device}. Click to switch TV or stop.` : 'Cast to TV';
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (data?.source !== TAG) return;
    if (event.source === parent && data.dir === 'to-page') {
      if (data.type === 'load') { pendingLoad = data; button.disabled = !data.item?.url; return; }
      window.postMessage(data, '*');
    }
    if (event.source === window && data.dir === 'to-ext') {
      if (data.type === 'status') show(data.status);
      parent.postMessage(data, PLAYER);
    }
  });

  button.addEventListener('click', () => {
    if (live) return window.postMessage({ ...pendingLoad, type: 'manage' }, '*');
    label.textContent = 'Connecting…';
    parent.postMessage({ source: TAG, dir: 'to-ext', type: 'clicked' }, PLAYER);
    window.postMessage(pendingLoad, '*');
  });

  window.postMessage({ source: TAG, dir: 'to-page', type: 'prepare' }, '*');
})();
