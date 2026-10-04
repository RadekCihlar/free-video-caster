const video = document.querySelector('#video');
video.volume = 0.2;
const source = document.querySelector('#source');
const error = document.querySelector('#error');
const quality = document.querySelector('#quality');
const subtitles = document.querySelector('#subtitles');
const speed = document.querySelector('#speed');
let item;

function showError(message) { document.querySelector('#error-text').textContent = message; error.classList.remove('hidden'); }
error.querySelector('.toast-close').addEventListener('click', () => error.classList.add('hidden'));
function setSource(url) {
  video.src = url;
  video.load();
  document.querySelector('#loading').classList.remove('hidden');
  document.querySelector('#empty-state').classList.add('hidden');
  source.textContent = (() => { try { return new URL(url).hostname; } catch { return 'Selected stream'; } })();
}
function subtitleLabel(track, index) {
  const code = String(track.language || track.label || '').trim().toLowerCase();
  const short = ({ cze: 'CZE', ces: 'CZE', cz: 'CZE', slo: 'SLO', slk: 'SLO', sk: 'SLO', eng: 'ENG', en: 'ENG' })[code];
  if (short) return short;
  return originalSubtitleLabel(track, index);
}
function originalSubtitleLabel(track, index) {
  const generic = /^(?:file|index|track|subtitle|captions?|undefined|unknown)(?:\s*\d+)?$/i;
  const informative = value => {
    const text = String(value || '').trim().replace(/\.(vtt|srt|ass|ssa|ttml|dfxp)$/i, '').replace(/[._-]+/g, ' ');
    return text && text.length <= 48 && !generic.test(text) && !/[A-Za-z0-9_-]{24,}/.test(text) && !/^https?:/i.test(text);
  };
  const supplied = [track.label, track.name, track.title].find(informative);
  if (supplied) return String(supplied).trim();
  let url;
  try { url = new URL(track.url); } catch { url = null; }
  const fromQuery = url && ['label', 'name', 'title', 'language', 'lang', 'srclang', 'locale'].map(key => url.searchParams.get(key)).find(informative);
  const language = track.language || fromQuery;
  if (language) {
    try { return `${new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(language)} subtitles`; }
    catch { return `${language} subtitles`; }
  }
  const filename = url?.pathname.split('/').pop()?.replace(/\.(vtt|srt|ass|ssa|ttml|dfxp)$/i, '').replace(/[._-]+/g, ' ').trim();
  if (filename && informative(filename)) return filename;
  return `Subtitle track ${index + 1}`;
}
function addTracks(tracks) {
  const usable = [...new Map((tracks || []).filter(track => track.url).map(track => [track.url, track])).values()];
  if (!usable.length) return;
  document.querySelector('#subtitles-state').classList.add('hidden');
  document.querySelector('#subtitles-wrap').classList.remove('hidden');
  subtitles.append(new Option('Off', ''));
  usable.forEach((track, index) => subtitles.append(new Option(subtitleLabel(track, index), track.url)));
  subtitles.addEventListener('change', () => {
    video.querySelectorAll('track').forEach(track => track.remove());
    if (!subtitles.value) return;
    const track = document.createElement('track'); track.kind = 'subtitles'; track.label = subtitles.options[subtitles.selectedIndex].text; track.src = subtitles.value; track.default = true;
    track.addEventListener('load', () => { track.track.mode = 'showing'; });
    track.addEventListener('error', () => showError(`Could not load subtitle track: ${track.label}.`));
    video.append(track);
  });
}
async function boot() {
  const token = location.hash.slice(1);
  const stored = await chrome.storage.session.get(`player:${token}`);
  item = stored[`player:${token}`];
  if (!item) return showError('This player link has expired.');
  document.querySelector('#title').textContent = document.title = StreamScoutMedia.titleFor(item);
  setSource(item.url);
  if (item.qualities?.length) {
    document.querySelector('#quality-wrap').classList.remove('hidden');
    document.querySelector('#quality-state').classList.add('hidden');
    quality.append(new Option('Automatic / manifest', item.url));
    item.qualities.forEach(option => quality.append(new Option(option.label || 'Quality', option.url)));
    quality.addEventListener('change', () => setSource(quality.value));
  }
  addTracks(item.subtitles);
  video.addEventListener('error', () => {
    document.querySelector('#loading').classList.add('hidden');
    if (/\.m3u8|\.mpd/i.test(video.currentSrc)) showError('This browser cannot play this stream format.');
    else showError('This stream cannot be played here.');
  });
  video.addEventListener('loadedmetadata', () => document.querySelector('#loading').classList.add('hidden'));
  video.addEventListener('loadedmetadata', () => document.querySelector('#empty-state').classList.remove('hidden'));
  video.addEventListener('playing', () => { document.querySelector('#loading').classList.add('hidden'); document.querySelector('#empty-state').classList.add('hidden'); });
  video.addEventListener('pause', () => { if (video.currentTime === 0 && video.readyState > 0) document.querySelector('#empty-state').classList.remove('hidden'); });
  video.addEventListener('error', () => { document.querySelector('#empty-state').classList.add('hidden'); });
}
document.querySelector('#empty-state').addEventListener('click', () => video.play().catch(() => {}));
const TAG = 'stream-scout';
const castFrame = document.querySelector('#cast-frame');
const tv = document.querySelector('#tv');
const remoteSpeed = document.querySelector('#remote-speed');
const remoteSeek = document.querySelector('#remote-seek');
const remoteSubtitle = document.querySelector('#remote-subtitle');
const note = document.querySelector('#note');
const device = document.querySelector('#device');
const CAST_TEXT = {
  'sdk-blocked': 'Could not load the Cast library.',
  error: 'The TV could not play this stream.'
};
let castOff = false;
let deviceNearby = false;
const SPEED_REFUSED = 'Your TV does not support speed changes.';
let seeking = false;
let speedRefusedUntil = 0;

function toFrame(message) { castFrame.contentWindow?.postMessage({ source: TAG, dir: 'to-page', ...message }, '*'); }
function castLoad() {
  const url = quality.value || item?.url;
  return { item: { ...item, url, subtitles: item?.subtitles || [] }, subtitleIndex: StreamScoutMedia.castSubtitleIndex(item?.subtitles || [], subtitles.value) };
}
// The frame keeps the latest pick so its Cast button can start the session straight from the click.
function syncCast() { if (item) toFrame({ type: 'load', ...castLoad() }); }
function castCommand(name, value) { toFrame({ type: 'command', name, value }); }
// Range inputs have no cross-browser "filled" style, so the played part is painted as a background.
function paintSeek() { remoteSeek.style.setProperty('--fill', `${(Number(remoteSeek.value) / (Number(remoteSeek.max) || 1)) * 100}%`); }

// Without Cast, the browser's own remote playback (AirPlay in Safari) takes the Cast button's place.
function renderDevice() {
  castFrame.classList.toggle('hidden', castOff);
  document.querySelector('#cast-off').classList.toggle('hidden', !castOff);
  device.classList.toggle('hidden', !(castOff && deviceNearby));
}

function renderCast(status = {}) {
  if (status.state === 'unavailable' && !castOff) { castOff = true; renderDevice(); }
  const live = ['playing', 'paused', 'buffering', 'idle'].includes(status.state) && Boolean(status.device);
  tv.classList.toggle('hidden', !live);
  // Status repeats every second without the error, so the refusal stays up for a few seconds.
  if (String(status.error || '').startsWith('speed-')) speedRefusedUntil = Date.now() + 6000;
  const alert = CAST_TEXT[status.state] ? (status.error ? `${CAST_TEXT[status.state]} (${status.error})` : CAST_TEXT[status.state]) : Date.now() < speedRefusedUntil ? SPEED_REFUSED : '';
  note.textContent = alert;
  note.classList.toggle('hidden', !alert);
  if (!live) return;
  document.querySelector('#cast-device').textContent = status.device;
  document.querySelector('#cast-state').textContent = status.state === 'buffering' ? 'Buffering…' : status.state === 'idle' ? 'Finished' : status.paused ? 'Paused' : status.title || '';
  document.querySelector('#remote-play').textContent = status.paused ? 'Play' : 'Pause';
  document.querySelector('#remote-current').textContent = StreamScoutMedia.clock(status.currentTime);
  document.querySelector('#remote-duration').textContent = StreamScoutMedia.clock(status.duration);
  remoteSeek.max = String(Math.floor(status.duration || 0));
  if (!seeking) remoteSeek.value = String(Math.floor(status.currentTime || 0));
  paintSeek();
  if (document.activeElement !== remoteSpeed) remoteSpeed.value = String(status.rate || 1);
  // Status arrives every second; rebuilding the open select would close it and undo the pick.
  const trackKey = JSON.stringify(status.tracks || []);
  if (trackKey !== remoteSubtitle.dataset.tracks) {
    remoteSubtitle.dataset.tracks = trackKey;
    remoteSubtitle.replaceChildren(new Option('Subtitles off', '0'), ...(status.tracks || []).map(track => new Option(track.name || `Track ${track.trackId}`, String(track.trackId))));
  } else if (document.activeElement === remoteSubtitle) return;
  remoteSubtitle.value = String(status.activeTrackIds?.find(id => status.tracks?.some(track => track.trackId === id)) || 0);
}

window.addEventListener('message', event => {
  const data = event.data;
  if (event.source !== castFrame.contentWindow || data?.source !== TAG || data.dir !== 'to-ext') return;
  if (data.type === 'clicked') chrome.runtime.sendMessage({ type: 'castClaim', load: castLoad() }).catch(cause => showError(cause.message));
  if (data.type === 'status') {
    renderCast(data.status);
    chrome.runtime.sendMessage({ type: 'castStatus', status: data.status }).catch(() => {});
  }
});
// Popup controls reach this tab through the background, the same way they reach a site that started casting.
chrome.runtime.onMessage.addListener(message => { if (message.type === 'castToPage' && message.payload?.type === 'command') castCommand(message.payload.name, message.payload.value); });
castFrame.addEventListener('load', syncCast);
quality.addEventListener('change', syncCast);
subtitles.addEventListener('change', syncCast);
document.querySelector('#remote-play').addEventListener('click', () => castCommand('playPause'));
document.querySelector('#remote-disconnect').addEventListener('click', () => castCommand('disconnect'));
remoteSubtitle.addEventListener('change', () => castCommand('subtitle', Number(remoteSubtitle.value)));
remoteSeek.addEventListener('input', () => { seeking = true; paintSeek(); });
remoteSpeed.addEventListener('change', () => castCommand('speed', Number(remoteSpeed.value)));
for (const select of [speed, remoteSpeed]) select.append(...StreamScoutMedia.speedOptions().map(option => new Option(option.label, String(option.value))));
speed.value = remoteSpeed.value = '1';
// The video element resets playbackRate on every new source; defaultPlaybackRate carries the pick across quality changes.
speed.addEventListener('change', () => { video.defaultPlaybackRate = video.playbackRate = Number(speed.value); });
remoteSeek.addEventListener('change', () => { seeking = false; castCommand('seek', Number(remoteSeek.value)); });
if (video.remote) {
  if (window.WebKitPlaybackTargetAvailabilityEvent) device.textContent = 'AirPlay';
  video.remote.watchAvailability(available => { deviceNearby = available; renderDevice(); }).catch(() => { /* No device watching here; the button stays hidden. */ });
  device.addEventListener('click', () => video.remote.prompt().catch(cause => { if (cause.name !== 'NotAllowedError') showError(cause.message || 'Could not reach the device.'); }));
}
boot().then(syncCast).catch(cause => showError(cause.message || 'Could not open this stream.'));
