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
function showSubtitlePicker() {
  document.querySelector('#subtitles-state').classList.add('hidden');
  document.querySelector('#subtitles-wrap').classList.remove('hidden');
  document.querySelector('#subtitle-tune').classList.remove('hidden');
  if (!subtitles.options.length) subtitles.append(new Option('Off', ''));
}
function addTracks(tracks) {
  const usable = [...new Map((tracks || []).filter(track => track.url).map(track => [track.url, track])).values()];
  if (!usable.length) return;
  showSubtitlePicker();
  usable.forEach((track, index) => subtitles.append(new Option(subtitleLabel(track, index), track.url)));
}

// Timing and look. A shifted track is a rewritten WebVTT copy, since neither the page nor the TV has an offset setting.
const SUBTITLE_SIZES = [[0.75, 'Small'], [1, 'Normal'], [1.5, 'Large'], [2, 'Huge']];
const SUBTITLE_COLORS = [['#FFFFFF', 'White'], ['#FFEB3B', 'Yellow'], ['#4DD0E1', 'Cyan'], ['#81C784', 'Green']];
const SUBTITLE_BACKGROUNDS = [['none', 'None'], ['dim', 'Dim'], ['solid', 'Solid']];
const SUBTITLE_FONTS = Object.entries(StreamScoutMedia.SUBTITLE_FONTS).map(([key, font]) => [key, font.label]);
const subtitleSize = document.querySelector('#subtitle-size');
const subtitleColor = document.querySelector('#subtitle-color');
const subtitleBackground = document.querySelector('#subtitle-background');
const subtitleFont = document.querySelector('#subtitle-font');
const subtitleShiftInput = document.querySelector('#subtitle-shift');
const subtitleTexts = new Map();
let look = { size: 1, color: '#FFFFFF', background: 'dim', font: 'sans' };
let subtitleShift = 0;
let appliedShift = 0;
let shiftedUrl = '';
let shiftTimer;

function subtitleText(url) {
  if (!subtitleTexts.has(url)) {
    const text = fetch(url).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.arrayBuffer(); })
      .then(bytes => StreamScoutMedia.toWebVtt(StreamScoutMedia.decodeSubtitle(new Uint8Array(bytes))));
    text.catch(() => subtitleTexts.delete(url));
    subtitleTexts.set(url, text);
  }
  return subtitleTexts.get(url);
}
async function showSubtitle() {
  video.querySelectorAll('track').forEach(track => track.remove());
  shiftedUrl = '';
  const url = subtitles.value;
  if (!url) return;
  let src = url;
  if (subtitleShift) {
    try { src = shiftedUrl = StreamScoutMedia.subtitleDataUrl(StreamScoutMedia.shiftVtt(await subtitleText(url), subtitleShift)); }
    catch (cause) { showError(`Could not shift these subtitles: ${cause.message}`); }
    if (url !== subtitles.value) return;
  }
  const track = document.createElement('track'); track.kind = 'subtitles'; track.label = subtitles.options[subtitles.selectedIndex].text; track.src = src; track.default = true;
  track.addEventListener('load', () => { track.track.mode = 'showing'; });
  track.addEventListener('error', () => showError(`Could not load subtitle track: ${track.label}.`));
  video.append(track);
}
// A new subtitle file or timing reaches the TV only with a fresh load; switching between loaded tracks does not need one,
// unless the timing is shifted, since the TV holds a shifted copy of the previous track only.
async function applySubtitles(reloadTv) {
  await showSubtitle();
  syncCast();
  if (tv.classList.contains('hidden')) return;
  if (reloadTv || (subtitleShift && subtitles.value)) castCommand('reload', { ...castLoad(), at: castTime });
  else castCommand('subtitle', castLoad().subtitleIndex);
}
subtitles.addEventListener('change', () => applySubtitles(false));

function paintLook() {
  const shade = { none: 'transparent', dim: 'rgb(0 0 0 / 63%)', solid: 'black' }[look.background];
  const shadow = look.background === 'none' ? '0 0 4px black, 0 1px 2px black' : 'none';
  const font = StreamScoutMedia.SUBTITLE_FONTS[look.font] || StreamScoutMedia.SUBTITLE_FONTS.sans;
  document.querySelector('#cue-style').textContent = `video::cue { color: ${look.color}; background-color: ${shade}; font-size: ${look.size * 100}%; font-family: ${font.css}; font-variant: ${font.smallCaps ? 'small-caps' : 'normal'}; text-shadow: ${shadow}; }`;
}
function setLook(change) {
  look = { ...look, ...change };
  paintLook();
  chrome.storage.local.set({ subtitleLook: look }).catch(cause => showError(cause.message));
  syncCast();
  if (!tv.classList.contains('hidden')) castCommand('style', StreamScoutMedia.castTextStyle(look));
}
function setShift(seconds) {
  subtitleShift = Math.round(Math.min(Math.max(seconds, -600), 600) * 10) / 10;
  subtitleShiftInput.value = `${subtitleShift > 0 ? '+' : ''}${subtitleShift.toFixed(1)}`;
  document.querySelector('#subtitle-shift-reset').disabled = !subtitleShift;
  clearTimeout(shiftTimer);
  // Waits for the clicks to settle, since each change reloads the video on the TV; no change, no reload.
  shiftTimer = setTimeout(() => {
    if (subtitleShift === appliedShift) return;
    appliedShift = subtitleShift;
    applySubtitles(true);
  }, 700);
}
for (const [select, options, key] of [[subtitleSize, SUBTITLE_SIZES, 'size'], [subtitleColor, SUBTITLE_COLORS, 'color'], [subtitleBackground, SUBTITLE_BACKGROUNDS, 'background'], [subtitleFont, SUBTITLE_FONTS, 'font']]) {
  options.forEach(([value, label]) => select.append(new Option(label, String(value))));
  select.addEventListener('change', () => setLook({ [key]: key === 'size' ? Number(select.value) : select.value }));
}
document.querySelectorAll('[data-shift]').forEach(button => button.addEventListener('click', () => setShift(subtitleShift + Number(button.dataset.shift))));
document.querySelector('#subtitle-shift-reset').addEventListener('click', () => setShift(0));
// Typed values may use a decimal comma, a minus sign or a trailing "s".
subtitleShiftInput.addEventListener('change', () => setShift(Number(subtitleShiftInput.value.replace(',', '.').replace('−', '-').replace(/\s*s$/i, '')) || 0));
subtitleShiftInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') subtitleShiftInput.blur();
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setShift(subtitleShift + (event.key === 'ArrowUp' ? 0.1 : -0.1)); }
});
const subtitleMenuToggle = document.querySelector('#subtitle-menu-toggle');
subtitleMenuToggle.addEventListener('click', () => {
  const open = subtitleMenuToggle.getAttribute('aria-expanded') !== 'true';
  subtitleMenuToggle.setAttribute('aria-expanded', String(open));
  document.querySelector('#subtitle-menu').classList.toggle('hidden', !open);
});
chrome.storage.local.get('subtitleLook').then(({ subtitleLook }) => {
  if (subtitleLook) look = { ...look, ...subtitleLook };
  subtitleSize.value = String(look.size); subtitleColor.value = look.color; subtitleBackground.value = look.background; subtitleFont.value = look.font;
  paintLook();
}).catch(cause => showError(cause.message));

const subtitleFile = document.querySelector('#subtitle-file');
document.querySelector('#subtitle-add').addEventListener('click', () => subtitleFile.click());
subtitleFile.addEventListener('change', async () => {
  const file = subtitleFile.files[0];
  subtitleFile.value = '';
  if (!file || !item) return;
  try {
    const url = StreamScoutMedia.subtitleDataUrl(StreamScoutMedia.toWebVtt(StreamScoutMedia.decodeSubtitle(await file.arrayBuffer())));
    const name = file.name.replace(/\.(srt|vtt)$/i, '').replace(/[._]+/g, ' ').trim();
    const label = name.length > 48 ? `${name.slice(0, 47)}…` : name || 'Own subtitles';
    item.subtitles = [...(item.subtitles || []), { url, label, contentType: 'text/vtt' }];
    showSubtitlePicker();
    subtitles.append(new Option(label, url));
    subtitles.value = url;
    await applySubtitles(true);
    if (!StreamScoutMedia.castSubtitleIndex(item.subtitles, url)) showError('This subtitle file is too large to send to the TV, so it shows only here.');
  } catch (cause) { showError(`Could not read ${file.name}: ${cause.message}`); }
});
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
const remoteVolume = document.querySelector('#remote-volume');
let changingVolume = false;
let volumeSentAt = 0;
let castTime = 0;
let castDuration = 0;

function toFrame(message) { castFrame.contentWindow?.postMessage({ source: TAG, dir: 'to-page', ...message }, '*'); }
function castLoad() {
  const url = quality.value || item?.url;
  // A shifted copy too large for one cast message leaves the TV on the original timing.
  const shifted = shiftedUrl && StreamScoutMedia.castableSubtitles([{ url: shiftedUrl, contentType: 'text/vtt' }]).length ? shiftedUrl : '';
  // The TV lists tracks under the names this page shows, so both pickers read the same.
  const named = (item?.subtitles || []).map(track => ({ ...track, label: [...subtitles.options].find(option => option.value === track.url)?.text || track.label }));
  const tracks = named.map(track => (shifted && track.url === subtitles.value ? { ...track, url: shifted, contentType: 'text/vtt' } : track));
  return { item: { ...item, url, subtitles: tracks, subtitleStyle: StreamScoutMedia.castTextStyle(look) }, subtitleIndex: StreamScoutMedia.castSubtitleIndex(tracks, shifted || subtitles.value) };
}
// The frame keeps the latest pick so its Cast button can start the session straight from the click.
function syncCast() { if (item) toFrame({ type: 'load', ...castLoad() }); }
function castCommand(name, value) { toFrame({ type: 'command', name, value }); }
// Range inputs have no cross-browser "filled" style, so the played part is painted as a background.
function paintSeek() { remoteSeek.style.setProperty('--fill', `${(Number(remoteSeek.value) / (Number(remoteSeek.max) || 1)) * 100}%`); }
function paintVolume() { remoteVolume.style.setProperty('--fill', `${remoteVolume.value}%`); }

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
  const finished = status.state === 'idle';
  // The TV reports no position once a video ends, so the bar stays full at the last known length.
  if (status.duration) castDuration = status.duration;
  castTime = finished ? castDuration : status.currentTime || 0;
  document.querySelector('#cast-device').textContent = status.device;
  document.querySelector('#cast-title').textContent = status.title || (item ? StreamScoutMedia.titleFor(item) : '');
  const state = document.querySelector('#cast-state');
  state.textContent = status.state === 'buffering' ? 'Buffering…' : finished ? 'Finished' : status.paused ? 'Paused' : 'Playing';
  state.classList.toggle('live', status.state === 'playing' && !status.paused);
  const mode = finished ? 'replay' : status.paused ? 'play' : 'pause';
  const play = document.querySelector('#remote-play');
  play.dataset.mode = mode;
  play.setAttribute('aria-label', { replay: 'Play again', play: 'Play', pause: 'Pause' }[mode]);
  document.querySelector('#remote-current').textContent = StreamScoutMedia.clock(castTime);
  document.querySelector('#remote-duration').textContent = StreamScoutMedia.clock(castDuration);
  document.querySelector('#tv-volume').classList.toggle('hidden', status.canVolume === false);
  const mute = document.querySelector('#remote-mute');
  mute.setAttribute('aria-pressed', String(Boolean(status.muted)));
  mute.setAttribute('aria-label', status.muted ? 'Unmute TV' : 'Mute TV');
  if (!changingVolume && typeof status.volume === 'number') { remoteVolume.value = String(Math.round(status.muted ? 0 : status.volume * 100)); paintVolume(); }
  for (const control of [remoteSeek, document.querySelector('#remote-back'), document.querySelector('#remote-forward')]) control.disabled = finished;
  remoteSeek.max = String(Math.floor(castDuration));
  if (!seeking) remoteSeek.value = String(Math.floor(castTime));
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
  // The frame asks for a fresh copy when the cast library holds on to a dead TV connection.
  if (data.type === 'reset') castFrame.src = castFrame.src;
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
document.querySelector('#remote-play').addEventListener('click', event => castCommand(event.currentTarget.dataset.mode === 'replay' ? 'replay' : 'playPause'));
const skip = seconds => castCommand('seek', Math.min(Math.max(castTime + seconds, 0), castDuration || Infinity));
document.querySelector('#remote-back').addEventListener('click', () => skip(-10));
document.querySelector('#remote-forward').addEventListener('click', () => skip(30));
document.querySelector('#remote-disconnect').addEventListener('click', () => { castCommand('disconnect'); tv.classList.add('hidden'); });
document.querySelector('#remote-mute').addEventListener('click', () => castCommand('mute'));
// Dragging fires many input events; the TV gets at most a few volume changes a second, then the final one.
remoteVolume.addEventListener('input', () => {
  changingVolume = true; paintVolume();
  if (Date.now() - volumeSentAt > 200) { volumeSentAt = Date.now(); castCommand('volume', Number(remoteVolume.value) / 100); }
});
remoteVolume.addEventListener('change', () => { changingVolume = false; castCommand('volume', Number(remoteVolume.value) / 100); });
// A pick on the TV panel moves the page's picker too, which then switches the TV.
remoteSubtitle.addEventListener('change', () => {
  const id = Number(remoteSubtitle.value);
  const url = id ? StreamScoutMedia.castableSubtitles(castLoad().item.subtitles)[id - 1]?.url : '';
  if (url === undefined) return castCommand('subtitle', id);
  if (!shiftedUrl || url !== shiftedUrl) subtitles.value = url;
  applySubtitles(false);
});
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
