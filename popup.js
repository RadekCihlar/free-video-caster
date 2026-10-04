const streams = document.querySelector('#streams');
const empty = document.querySelector('#empty');
const status = document.querySelector('#status');
const notice = document.querySelector('#notice');
const template = document.querySelector('#stream-template');
const now = document.querySelector('#now');
const seek = document.querySelector('#now-seek');
const nowSubtitle = document.querySelector('#now-subtitle');
let activeTab;
let seeking = false;
const STATE_TEXT = {
  'sdk-blocked': 'Could not load the Cast library.',
  unavailable: 'Cast is turned off in this browser.',
  'sender-closed': 'The casting tab was closed. TV controls are unavailable.',
  error: 'The TV could not play this stream.'
};

async function message(payload) { return chrome.runtime.sendMessage(payload); }
async function currentTab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; }
function filename(url, fallback = 'stream') { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || fallback).replace(/[^a-z0-9._-]/gi, '_'); } catch { return fallback; } }
function streamUrl(item) { return item.selectedUrl || item.url; }
function displayUrl(url) { try { const parsed = new URL(url); return `${parsed.hostname} - ${decodeURIComponent(parsed.pathname.split('/').pop() || 'media')}`; } catch { return url; } }
function showNotice(text) { document.querySelector('#notice-text').textContent = text; notice.classList.remove('hidden'); }
notice.querySelector('.toast-close').addEventListener('click', () => notice.classList.add('hidden'));
const { clock } = StreamScoutMedia;
function renderCast(status = {}) {
  if (STATE_TEXT[status.state]) showNotice(status.error ? `${STATE_TEXT[status.state]} (${status.error})` : STATE_TEXT[status.state]);
  const live = ['playing', 'paused', 'buffering', 'idle'].includes(status.state) && Boolean(status.device);
  now.classList.toggle('hidden', !live);
  if (!live) return;
  notice.classList.add('hidden');
  document.querySelector('#now-title').textContent = status.title || 'Casting';
  document.querySelector('#now-device').textContent = status.device;
  document.querySelector('#now-play').textContent = status.paused ? 'Play' : 'Pause';
  document.querySelector('#now-time').textContent = `${clock(status.currentTime)} / ${clock(status.duration)}`;
  seek.max = String(Math.floor(status.duration || 0));
  if (!seeking) seek.value = String(Math.floor(status.currentTime || 0));
  // Status arrives every second; rebuilding the open select would close it and undo the user's pick.
  const trackKey = JSON.stringify(status.tracks || []);
  if (trackKey !== nowSubtitle.dataset.tracks) {
    nowSubtitle.dataset.tracks = trackKey;
    nowSubtitle.replaceChildren(new Option('Subtitles off', '0'), ...(status.tracks || []).map(track => new Option(track.name || `Track ${track.trackId}`, String(track.trackId))));
  } else if (document.activeElement === nowSubtitle) return;
  nowSubtitle.value = String(status.activeTrackIds?.find(id => status.tracks?.some(track => track.trackId === id)) || 0);
}
function castCommand(name, value) { return message({ type: 'castCommand', name, value }); }
function render(items) {
  streams.replaceChildren();
  const visible = items.filter(item => ['video', 'hls', 'dash'].includes(item.kind));
  empty.classList.toggle('hidden', visible.length > 0);
  status.textContent = visible.length ? `${visible.length} stream${visible.length === 1 ? '' : 's'} found` : 'No browser-accessible media found';
  const pageTitle = StreamScoutMedia.pageTitle(activeTab?.title, activeTab?.url);
  for (const raw of visible) {
    const item = { ...raw, pageTitle };
    const node = template.content.cloneNode(true);
    node.querySelector('.badge').textContent = item.height ? `${item.height}p` : item.kind.toUpperCase();
    const title = StreamScoutMedia.titleFor(item);
    node.querySelector('.stream-label').textContent = title === 'Selected video' ? 'Video stream' : title;
    const urlNode = node.querySelector('.stream-url');
    const qualityWrap = node.querySelector('.quality-wrap');
    const quality = node.querySelector('.quality');
    const setUrl = url => { item.selectedUrl = url; urlNode.textContent = displayUrl(url); urlNode.title = url; };
    setUrl(item.url);
    if (item.qualities?.length) {
      qualityWrap.classList.remove('hidden');
      quality.append(new Option('Manifest / automatic', item.url));
      for (const option of item.qualities) quality.append(new Option(option.label || 'Quality', option.url));
      quality.addEventListener('change', () => setUrl(quality.value));
    }
    // Casting needs a click inside the player's Cast frame, so the cast icon opens the player too.
    const openPlayer = () => message({ type: 'openPlayer', item: { ...item, url: streamUrl(item), selectedUrl: undefined, subtitles: [...(item.subtitles || []), ...items.filter(x => x.kind === 'subtitle')] } });
    node.querySelector('.player').addEventListener('click', openPlayer);
    const castButton = node.querySelector('.cast');
    if (item.drm) { castButton.disabled = true; castButton.title = 'DRM-protected streams cannot be cast'; }
    castButton.addEventListener('click', openPlayer);
    node.querySelector('.download').addEventListener('click', async () => {
      const url = streamUrl(item);
      const result = await message({ type: 'download', url, filename: filename(url, 'stream') });
      if (!result?.ok) showNotice(`Download failed: ${result?.error || 'unknown error'}`);
    });
    streams.append(node);
  }
}
async function refresh() { activeTab = await currentTab(); render(await message({ type: 'getMedia', tabId: activeTab.id })); }
document.querySelector('#refresh').addEventListener('click', refresh);
document.querySelector('#now-play').addEventListener('click', () => castCommand('playPause'));
document.querySelector('#now-stop').addEventListener('click', () => castCommand('stop'));
document.querySelector('#now-disconnect').addEventListener('click', () => castCommand('disconnect'));
nowSubtitle.addEventListener('change', () => castCommand('subtitle', Number(nowSubtitle.value)));
seek.addEventListener('input', () => { seeking = true; });
seek.addEventListener('change', () => { seeking = false; castCommand('seek', Number(seek.value)); });
chrome.runtime.onMessage.addListener(event => {
  if (event.type === 'mediaChanged' && event.tabId === activeTab?.id) refresh();
  if (event.type === 'castStatusChanged') renderCast(event.status);
});
refresh();
message({ type: 'getCastStatus' }).then(({ castStatus, castTabId } = {}) => {
  if (castTabId === undefined) return;
  renderCast(castStatus);
  castCommand('status').catch(() => {});
});
