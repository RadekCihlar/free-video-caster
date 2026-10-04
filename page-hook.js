(() => {
  const mediaUrl = /\.(mp4|m4v|webm|mov|m3u8|mpd|vtt|srt|ttml|dfxp)(?:[?#]|$)/i;
  const emitted = new Set();
  function kindFor(url, key) {
    const value = `${url} ${key}`.toLowerCase();
    if (/\.m3u8(?:[?#]|$)/.test(value)) return 'hls';
    if (/\.mpd(?:[?#]|$)/.test(value)) return 'dash';
    if (/\.(vtt|srt|ttml|dfxp)(?:[?#]|$)|subtitle|caption/.test(value)) return 'subtitle';
    return 'video';
  }
  function walk(value, key = '', inherited = {}, depth = 0, output = [], path = '') {
    if (depth > 12 || value == null) return output;
    if (typeof value === 'string') {
      const subtitleContext = /subtitle|caption|text.?track/i.test(path);
      const mediaContext = /quality|rendition|source|stream|playlist|manifest|video|file/i.test(path);
      const isUrl = /^https?:\/\//i.test(value) || value.startsWith('/');
      if (mediaUrl.test(value) || (isUrl && (subtitleContext || mediaContext))) {
        let url = value;
        try { url = new URL(value, location.href).href; } catch { /* Keep the original URL. */ }
        output.push({ url, kind: subtitleContext ? 'subtitle' : (kindFor(value, `${key} ${path}`) || 'video'), label: inherited.label || inherited.title || inherited.name || inherited.quality || inherited.resolution, language: inherited.language || inherited.lang || inherited.srclang, height: Number(inherited.height) || undefined, source: 'player API' });
      }
      return output;
    }
    if (Array.isArray(value)) { value.forEach(entry => walk(entry, key, inherited, depth + 1, output, path)); return output; }
    if (typeof value === 'object') {
      const context = { ...inherited, ...value };
      Object.entries(value).forEach(([childKey, child]) => walk(child, childKey, context, depth + 1, output, `${path}.${childKey}`));
    }
    return output;
  }
  function publish(data) {
    const found = walk(data).filter(item => item.url && !emitted.has(item.url));
    found.forEach(item => emitted.add(item.url));
    if (found.length) window.dispatchEvent(new CustomEvent('stream-scout-media', { detail: JSON.stringify(found) }));
  }
  const fetchOriginal = window.fetch;
  window.fetch = async (...args) => {
    const response = await fetchOriginal(...args);
    if ((response.headers.get('content-type') || '').includes('json')) response.clone().json().then(publish).catch(() => {});
    return response;
  };
  const sendOriginal = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      if (!(this.getResponseHeader('content-type') || '').includes('json')) return;
      try {
        const payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
        publish(payload);
      } catch { /* Non-JSON response. */ }
    });
    return sendOriginal.apply(this, args);
  };
})();
