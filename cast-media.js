(root => {
  const CAST_SUBTITLE = /\.(vtt|ttml|dfxp)(?:[?#]|$)/i;
  const GENERIC = /^(?:file|index|track|subtitle|captions?|undefined|unknown)(?:\s*\d+)?$/i;

  function typeFor(url, kind) {
    if (kind === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url)) return 'application/x-mpegURL';
    if (kind === 'dash' || /\.mpd(?:[?#]|$)/i.test(url)) return 'application/dash+xml';
    if (/\.webm(?:[?#]|$)/i.test(url)) return 'video/webm';
    return 'video/mp4';
  }

  // Tab titles usually carry the site name at one end ("Movie | SiteName"); the video name is the rest.
  function pageTitle(title, pageUrl) {
    let site = '';
    try { site = new URL(pageUrl).hostname.replace(/^www\./, '').split('.').slice(0, -1).join('.').toLowerCase(); } catch { /* No site name to strip. */ }
    const isSite = part => Boolean(site) && part.toLowerCase().replace(/\.[a-z]{2,}$/, '') === site;
    const parts = String(title || '').trim().split(/\s+[|–—-]\s+/).filter(part => !isSite(part.trim()));
    const name = parts.join(' - ').trim();
    return name && !(site && name.toLowerCase().startsWith(`${site}.`)) ? name : '';
  }

  function titleFor(item) {
    if (item?.pageTitle) return item.pageTitle;
    const raw = item?.label && !/^(video file|file|\d+p(?: video)?|hls playlist|dash manifest)$/i.test(item.label) ? item.label : '';
    if (raw) return raw;
    try {
      const name = decodeURIComponent(new URL(item.url).pathname.split('/').pop() || '').replace(/\.(mp4|m4v|webm|mov|avi|mkv|m3u8|mpd)$/i, '').replace(/[._-]+/g, ' ').trim();
      return /^(file|index|video)$/i.test(name) ? 'Selected video' : (name || 'Selected video');
    } catch { return 'Selected video'; }
  }

  function subtitleType(track) {
    return /\.(ttml|dfxp)(?:[?#]|$)/i.test(track.url) || /ttml/i.test(track.contentType || '') ? 'application/ttml+xml' : 'text/vtt';
  }

  // The Default Media Receiver only renders WebVTT and TTML.
  function castableSubtitles(tracks = []) {
    const seen = new Map();
    for (const track of tracks) {
      if (track?.url && (CAST_SUBTITLE.test(track.url) || /text\/vtt|ttml/i.test(track.contentType || '')) && !seen.has(track.url)) seen.set(track.url, track);
    }
    return [...seen.values()];
  }

  function subtitleName(track, index, locale = globalThis.navigator?.language || 'en') {
    const good = value => value && String(value).trim().length <= 48 && !GENERIC.test(String(value).trim()) && !/[A-Za-z0-9_-]{24,}/.test(String(value));
    const supplied = [track.label, track.name, track.title].find(good);
    if (supplied) return String(supplied).trim();
    let url;
    try { url = new URL(track.url); } catch { url = null; }
    const language = track.language || (url && ['language', 'lang', 'srclang', 'locale'].map(key => url.searchParams.get(key)).find(good));
    if (language) {
      try { return `${new Intl.DisplayNames([locale], { type: 'language' }).of(language)} subtitles`; }
      catch { return `${language} subtitles`; }
    }
    let filename = '';
    try { filename = decodeURIComponent(url?.pathname.split('/').pop() || ''); } catch { filename = url?.pathname.split('/').pop() || ''; }
    filename = filename.replace(/\.(vtt|srt|ass|ssa|ttml|dfxp)$/i, '').replace(/[._-]+/g, ' ').trim();
    if (good(filename)) return filename;
    return `Subtitle track ${index + 1}`;
  }

  function buildMedia(item, subtitleIndex = 0) {
    const tracks = castableSubtitles(item.subtitles).map((track, index) => ({
      trackId: index + 1, url: track.url, contentType: subtitleType(track), name: subtitleName(track, index), language: track.language || 'und'
    }));
    let host = '';
    try { host = new URL(item.url).hostname; } catch { /* Shown as metadata only. */ }
    return {
      url: item.url, contentType: typeFor(item.url, item.kind), title: titleFor(item), host, tracks,
      activeTrackIds: subtitleIndex > 0 && subtitleIndex <= tracks.length ? [subtitleIndex] : []
    };
  }

  // Trusted Types and CSP failures surface as arbitrary errors; all of them mean the SDK cannot load here.
  function sdkFailure(error) { return error?.message === 'unavailable' ? 'unavailable' : 'sdk-blocked'; }

  // The receiver reports an expired or unplayable URL as IDLE with idleReason ERROR, after loadMedia resolved.
  function playerStateFor(playerState, idleReason) {
    return playerState === 'IDLE' && idleReason === 'ERROR' ? 'error' : (playerState || 'IDLE').toLowerCase();
  }

  // Cast track ids are positions in the castable list, so an SRT pick casts without subtitles.
  function castSubtitleIndex(tracks, url) {
    return url ? castableSubtitles(tracks).findIndex(track => track.url === url) + 1 : 0;
  }

  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor(s / 60) % 60;
    const r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
  }

  function speedOptions() {
    return [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => ({ value, label: value === 1 ? 'Normal' : `${value}×` }));
  }

  const api = { typeFor, pageTitle, titleFor, castableSubtitles, subtitleName, buildMedia, sdkFailure, playerStateFor, castSubtitleIndex, clock, speedOptions };
  root.StreamScoutMedia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
