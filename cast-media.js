(root => {
  const CAST_SUBTITLE = /\.(vtt|ttml|dfxp)(?:[?#]|$)/i;
  const GENERIC = /^(?:file|index|track|subtitle|captions?|undefined|unknown)(?:\s*\d+)?$/i;
  const CAST_DATA_LIMIT = 48 * 1024;
  const SUBTITLE_BACKGROUND = { none: '#00000000', dim: '#000000A0', solid: '#000000FF' };
  // The TV renders only generic font families, so the PC uses the nearest generic CSS family to match it.
  const SUBTITLE_FONTS = {
    sans: { label: 'Sans', css: 'system-ui, sans-serif', cast: 'SANS_SERIF' },
    serif: { label: 'Serif', css: 'Georgia, serif', cast: 'SERIF' },
    mono: { label: 'Monospace', css: 'Consolas, monospace', cast: 'MONOSPACED_SANS_SERIF' },
    casual: { label: 'Casual', css: '"Comic Sans MS", "Segoe Print", cursive', cast: 'CASUAL' },
    caps: { label: 'Small caps', css: 'system-ui, sans-serif', smallCaps: true, cast: 'SMALL_CAPITALS' }
  };
  // Subtitle files that are not UTF-8 are usually in the old Windows code page of their language.
  const LEGACY = { 'windows-1250': ['cs', 'sk', 'pl', 'hu', 'sl', 'hr', 'bs', 'ro'], 'windows-1251': ['ru', 'uk', 'be', 'bg', 'mk'] };

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

  // The Default Media Receiver only renders WebVTT and TTML. A subtitle file added from this PC travels inside the
  // load request as a data URL, and one cast message holds at most 64 KB, so larger files stay on the PC.
  function castableSubtitles(tracks = []) {
    const seen = new Map();
    for (const track of tracks) {
      if (track?.url?.startsWith('data:') && track.url.length > CAST_DATA_LIMIT) continue;
      if (track?.url && (CAST_SUBTITLE.test(track.url) || /text\/vtt|ttml/i.test(track.contentType || '')) && !seen.has(track.url)) seen.set(track.url, track);
    }
    return [...seen.values()];
  }

  function decodeSubtitle(bytes, locale = globalThis.navigator?.language || 'en') {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch {
      const language = String(locale).toLowerCase().split('-')[0];
      const encoding = Object.keys(LEGACY).find(name => LEGACY[name].includes(language)) || 'windows-1252';
      return new TextDecoder(encoding).decode(bytes);
    }
  }

  // SRT differs from WebVTT in its header and in using a comma before the milliseconds.
  function toWebVtt(text) {
    const clean = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
    if (!clean.includes('-->')) throw new Error('No timed subtitle lines found.');
    if (/^WEBVTT/.test(clean)) return `${clean}\n`;
    const cues = clean.replace(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/g, (_, h, m, s, ms) => `${h.padStart(2, '0')}:${m}:${s}.${ms.padEnd(3, '0')}`);
    return `WEBVTT\n\n${cues}\n`;
  }

  // Moves the cue times of a WebVTT file; the receiver has no offset setting, so a shifted copy is cast instead.
  function shiftVtt(vtt, seconds) {
    if (!seconds) return vtt;
    const stamp = value => {
      const parts = value.split(':').map(Number);
      const total = parts.reduce((sum, part) => sum * 60 + part, 0) + seconds;
      const ms = Math.round(Math.max(0, total) * 1000);
      const pad = (number, size = 2) => String(number).padStart(size, '0');
      return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
    };
    return vtt.replace(/^((?:\d+:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d+:)?\d{2}:\d{2}\.\d{3})/gm, (_, from, to) => `${stamp(from)} --> ${stamp(to)}`);
  }

  // Colors on the receiver are #RRGGBBAA. Without a background box the text needs a shadow to stay readable.
  function castTextStyle(look) {
    return {
      fontScale: look.size, foregroundColor: `${look.color}FF`, backgroundColor: SUBTITLE_BACKGROUND[look.background] || SUBTITLE_BACKGROUND.dim,
      edgeType: look.background === 'none' ? 'DROP_SHADOW' : 'NONE', edgeColor: '#000000FF',
      fontGenericFamily: (SUBTITLE_FONTS[look.font] || SUBTITLE_FONTS.sans).cast
    };
  }

  // The TV fetches subtitles itself and cannot reach a file on this PC, so the text goes along inside the URL.
  function subtitleDataUrl(vtt) {
    let binary = '';
    for (const byte of new TextEncoder().encode(vtt)) binary += String.fromCharCode(byte);
    return `data:text/vtt;charset=utf-8;base64,${btoa(binary)}`;
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
      url: item.url, contentType: typeFor(item.url, item.kind), title: titleFor(item), host, tracks, style: item.subtitleStyle || null,
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

  const api = { SUBTITLE_FONTS, typeFor, pageTitle, titleFor, castableSubtitles, decodeSubtitle, toWebVtt, shiftVtt, castTextStyle, subtitleDataUrl, subtitleName, buildMedia, sdkFailure, playerStateFor, castSubtitleIndex, clock, speedOptions };
  root.StreamScoutMedia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
