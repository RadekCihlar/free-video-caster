(() => {
  const MEDIA = /\.(mp4|m4v|webm|mov|avi|mkv|m3u8|mpd|vtt|srt|ttml|dfxp)(?:[?#]|$)/i;
  const sent = new Map();
  let timer;

  // Many players expose renditions and captions through JSON APIs, not markup.
  window.addEventListener('stream-scout-media', event => {
    try { send(JSON.parse(event.detail)); } catch { /* Ignore malformed page data. */ }
  });

  function send(items) {
    const fresh = items.filter(item => {
      if (!item?.url || item.url.startsWith('blob:')) return false;
      const key = `${item.url}|${item.kind || ''}`;
      const fingerprint = JSON.stringify([item.label, item.language, item.height, item.subtitles?.map(track => [track.url, track.label, track.language])]);
      if (sent.get(key) === fingerprint) return false;
      sent.set(key, fingerprint);
      return true;
    });
    if (fresh.length) chrome.runtime.sendMessage({ type: 'foundMedia', items: fresh }).catch(() => {});
  }
  function pageSubtitleLanguages() {
    const codes = new Set(['cze', 'ces', 'cz', 'slo', 'slk', 'sk', 'eng', 'en']);
    const nodes = document.querySelectorAll('option, [role="option"], [role="menuitem"], [data-lang], [lang], [class*="subtitle"], [class*="caption"]');
    const labels = [];
    nodes.forEach(node => {
      const text = `${node.getAttribute('data-lang') || ''} ${node.getAttribute('lang') || ''} ${node.textContent || ''}`.trim().toLowerCase();
      const match = /(?:^|\b)(cze|ces|cz|slo|slk|sk|eng|en)(?:\b|$)/i.exec(text);
      if (match && codes.has(match[1].toLowerCase()) && !labels.includes(match[1].toLowerCase())) labels.push(match[1].toLowerCase());
    });
    return labels;
  }
  function nameSubtitleTracks(tracks) {
    const languages = pageSubtitleLanguages();
    let next = 0;
    return tracks.map(track => {
      const unhelpful = !track.label || /^(?:file|index|track|subtitle|captions?|undefined|unknown)(?:\s*\d+)?$/i.test(track.label.trim()) || /[A-Za-z0-9_-]{24,}/.test(track.label);
      if (unhelpful && languages[next]) {
        const language = languages[next++];
        const label = ({ cze: 'CZE', ces: 'CZE', cz: 'CZE', slo: 'SLO', slk: 'SLO', sk: 'SLO', eng: 'ENG', en: 'ENG' })[language];
        return { ...track, label, language };
      }
      return track;
    });
  }
  function scan() {
    const items = [];
    document.querySelectorAll('video, audio').forEach(media => {
      const subtitles = [...media.querySelectorAll('track[kind="subtitles"], track[kind="captions"]')].map(track => ({ url: track.src, label: track.label || track.srclang || 'Subtitle', language: track.srclang, kind: 'subtitle' })).filter(track => track.url);
      // Some sites populate TextTrack labels before they expose a usable track URL.
      [...media.textTracks].forEach((track, index) => {
        if ((track.kind === 'subtitles' || track.kind === 'captions') && !subtitles.some(item => item.label === track.label && item.language === track.language)) {
          const sourceTrack = [...media.querySelectorAll('track')].find(node => node.track === track);
          if (sourceTrack?.src) subtitles.push({ url: sourceTrack.src, label: track.label || track.language || `Subtitle ${index + 1}`, language: track.language, kind: 'subtitle' });
        }
      });
      const namedSubtitles = nameSubtitleTracks(subtitles);
      const url = media.currentSrc || media.src;
      if (url && !url.startsWith('blob:')) items.push({ url, kind: 'video', label: media.videoHeight ? `${media.videoHeight}p video` : undefined, height: media.videoHeight || undefined, subtitles: namedSubtitles, drm: Boolean(media.mediaKeys), source: 'page player' });
      media.querySelectorAll('source[src]').forEach(source => items.push({ url: source.src, kind: 'video', contentType: source.type, subtitles: namedSubtitles, source: 'page source' }));
    });
    const looseTracks = [...document.querySelectorAll('track[src]')].map(track => ({ url: track.src, kind: 'subtitle', label: track.label || track.srclang || 'Subtitle', language: track.srclang, source: 'page track' }));
    nameSubtitleTracks(looseTracks).forEach(track => items.push(track));
    document.querySelectorAll('[data-src], [data-file], [data-subtitle], [data-caption]').forEach(node => {
      const label = node.getAttribute('label') || node.getAttribute('title') || node.getAttribute('data-lang') || node.getAttribute('lang') || node.textContent?.trim();
      for (const key of ['data-src', 'data-file', 'data-subtitle', 'data-caption']) {
        const url = node.getAttribute(key);
        if (url && /(?:subtitle|caption|\.vtt(?:[?#]|$)|\.srt(?:[?#]|$)|\.ass(?:[?#]|$)|\.ttml(?:[?#]|$))/i.test(`${key} ${url}`)) items.push({ url: new URL(url, location.href).href, kind: 'subtitle', label: label || 'Subtitle', language: node.getAttribute('lang') || node.getAttribute('data-lang'), source: 'page metadata' });
      }
    });
    performance.getEntriesByType('resource').forEach(entry => { if (MEDIA.test(entry.name)) items.push({ url: entry.name, source: 'page resource' }); });
    send(items);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(scan, 350); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  document.addEventListener('play', schedule, true);
  document.addEventListener('loadedmetadata', schedule, true);
  window.addEventListener('load', schedule);
  setInterval(scan, 3000);
  schedule();
})();
