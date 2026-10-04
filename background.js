const mediaByTab = new Map();
const MEDIA_EXTENSIONS = /\.(mp4|m4v|webm|mov|avi|mkv|m3u8|mpd|vtt|srt|ttml|dfxp)(?:[?#]|$)/i;

async function castTabId() { return (await chrome.storage.session.get('castTabId')).castTabId; }

async function setCastStatus(status) {
  await chrome.storage.session.set({ castStatus: status });
  chrome.runtime.sendMessage({ type: 'castStatusChanged', status }).catch(() => {});
}

async function senderGone(tabId) {
  if (tabId !== await castTabId()) return;
  await setCastStatus({ state: 'sender-closed' });
}

function kindFor(url, contentType = '') {
  const value = `${url} ${contentType}`.toLowerCase();
  if (/\.m3u8(?:[?#]|$)|mpegurl|vnd\.apple\.mpegurl/.test(value)) return 'hls';
  if (/\.mpd(?:[?#]|$)|dash\+xml/.test(value)) return 'dash';
  if (/\.(vtt|srt|ttml|dfxp)(?:[?#]|$)|text\/vtt|ttml/.test(value)) return 'subtitle';
  if (/video\//.test(value) || /\.(mp4|m4v|webm|mov|avi|mkv)(?:[?#]|$)/.test(value)) return 'video';
  return null;
}

function labelFor(item) {
  if (item.label) return item.label;
  if (item.kind === 'subtitle') {
    const filename = (() => { try { return decodeURIComponent(new URL(item.url).pathname.split('/').pop()); } catch { return ''; } })();
    const friendly = filename.replace(/\.(vtt|srt|ass|ssa|ttml|dfxp)$/i, '').replace(/[._-]+/g, ' ').trim();
    return friendly || (item.language ? `Subtitle - ${item.language}` : 'Subtitle track');
  }
  if (item.height) return `${item.height}p`;
  if (item.kind === 'hls') return 'HLS playlist';
  if (item.kind === 'dash') return 'DASH manifest';
  return 'Video file';
}

function bucket(tabId) {
  if (!mediaByTab.has(tabId)) mediaByTab.set(tabId, new Map());
  return mediaByTab.get(tabId);
}

async function persist(tabId) {
  const entries = [...(mediaByTab.get(tabId)?.values() || [])];
  await chrome.storage.session.set({[`media:${tabId}`]: entries});
}

function updateBadge(tabId) {
  const count = [...(mediaByTab.get(tabId)?.values() || [])].filter(item => ['video', 'hls', 'dash'].includes(item.kind)).length;
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#9b5cff' });
  chrome.action.setBadgeText({ tabId, text: count ? String(count > 99 ? '99+' : count) : '' });
}

async function add(tabId, raw) {
  if (tabId < 0 || !raw?.url || raw.url.startsWith('blob:') || raw.url.startsWith('data:')) return;
  const kind = raw.kind || kindFor(raw.url, raw.contentType);
  if (!kind) return;
  const item = { ...raw, kind, label: labelFor({ ...raw, kind }), seenAt: Date.now() };
  const items = bucket(tabId);
  const previous = items.get(item.url);
  items.set(item.url, { ...previous, ...item, subtitles: mergeByUrl(previous?.subtitles, item.subtitles) });
  await persist(tabId);
  updateBadge(tabId);
  chrome.runtime.sendMessage({ type: 'mediaChanged', tabId }).catch(() => {});
  if ((kind === 'hls' || kind === 'dash') && !previous?.expanded) expandManifest(tabId, item.url, kind);
}

function mergeByUrl(left = [], right = []) {
  return [...new Map([...left, ...right].filter(x => x?.url).map(x => [x.url, x])).values()];
}

function absolute(base, value) {
  try { return new URL(value, base).href; } catch { return value; }
}

async function expandManifest(tabId, url, kind) {
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const additions = kind === 'hls' ? parseHls(text, url) : parseDash(text, url);
    const current = bucket(tabId).get(url);
    if (current) {
      current.expanded = true;
      current.qualities = additions.qualities;
      current.subtitles = mergeByUrl(current.subtitles, additions.subtitles);
      current.drm = additions.drm || current.drm;
      current.label = current.qualities.length ? `${kind.toUpperCase()} - ${current.qualities.length} qualities` : current.label;
      await persist(tabId);
      chrome.runtime.sendMessage({ type: 'mediaChanged', tabId }).catch(() => {});
    }
  } catch (error) {
    const current = bucket(tabId).get(url);
    if (current) { current.expanded = true; current.manifestError = 'Manifest details need the site session or are not readable.'; await persist(tabId); }
  }
}

function parseHls(text, base) {
  const lines = text.split(/\r?\n/);
  const qualities = [], subtitles = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=SUBTITLES/.test(line)) {
      const attrs = Object.fromEntries([...line.matchAll(/([A-Z-]+)=(?:"([^"]*)"|([^,]*))/g)].map(m => [m[1], m[2] ?? m[3]]));
      if (attrs.URI) subtitles.push({ url: absolute(base, attrs.URI), label: attrs.NAME || attrs.LANGUAGE || 'Subtitle', language: attrs.LANGUAGE, kind: 'subtitle' });
    }
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = Object.fromEntries([...line.matchAll(/([A-Z-]+)=([^,]*)/g)].map(m => [m[1], m[2].replaceAll('"', '')]));
      const next = lines.slice(i + 1).find(x => x && !x.startsWith('#'));
      if (next) {
        const height = Number((attrs.RESOLUTION || '').split('x')[1]) || undefined;
        qualities.push({ url: absolute(base, next), label: height ? `${height}p` : (attrs.NAME || 'Auto'), height, bandwidth: Number(attrs.BANDWIDTH) || undefined, kind: 'hls-variant' });
      }
    }
  }
  const drm = /#EXT-X-KEY:[^\r\n]*METHOD=(?:SAMPLE-AES|SAMPLE-AES-CTR)/i.test(text);
  return { qualities, subtitles, drm };
}

function parseDash(text, base) {
  // DOMParser is not available in every MV3 service-worker implementation.
  // DASH attributes are enough for the concise chooser shown by this extension.
  const attribute = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const videoSets = [...text.matchAll(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/gi)]
    .filter(match => /(?:contentType\s*=\s*["']video|mimeType\s*=\s*["'][^"']*video)/i.test(match[0]));
  const qualities = videoSets.flatMap(match => [...match[0].matchAll(/<Representation\b[^>]*>/gi)].map(rep => {
    const tag = rep[0], height = Number(attribute(tag, 'height')) || undefined;
    return { url: base, label: height ? `${height}p` : (attribute(tag, 'id') || 'DASH quality'), height, bandwidth: Number(attribute(tag, 'bandwidth')) || undefined, kind: 'dash-representation' };
  }));
  const subtitles = [...text.matchAll(/<AdaptationSet\b[^>]*>/gi)]
    .filter(match => /(?:contentType\s*=\s*["']text|mimeType\s*=\s*["'][^"']*(?:ttml|vtt|text))/i.test(match[0]))
    .map(match => { const language = attribute(match[0], 'lang'); return { url: base, label: language || 'Subtitle', language, kind: 'subtitle' }; });
  const drm = /<ContentProtection\b/i.test(text);
  return { qualities, subtitles, drm };
}

chrome.webRequest.onHeadersReceived.addListener(details => {
  const contentType = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
  const kind = kindFor(details.url, contentType);
  if (kind) add(details.tabId, { url: details.url, kind, contentType, source: 'network' });
}, { urls: ['<all_urls>'] }, ['responseHeaders']);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'foundMedia') {
    const tabId = sender.tab?.id;
    for (const item of message.items || []) add(tabId, item);
  }
  if (message.type === 'getMedia') {
    const tabId = message.tabId;
    (async () => {
      if (!mediaByTab.has(tabId)) {
        const stored = await chrome.storage.session.get(`media:${tabId}`);
        const restored = stored[`media:${tabId}`] || [];
        mediaByTab.set(tabId, new Map(restored.map(item => [item.url, item])));
        updateBadge(tabId);
      }
      sendResponse([...bucket(tabId).values()]);
    })();
    return true;
  }
  if (message.type === 'download' && message.url) {
    chrome.downloads.download({ url: message.url, filename: message.filename || undefined, saveAs: true }).then(id => sendResponse({ ok: true, id })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'openPlayer' && message.item?.url) {
    (async () => {
      const token = crypto.randomUUID();
      await chrome.storage.session.set({[`player:${token}`]: message.item});
      const tab = await chrome.tabs.create({ url: `${chrome.runtime.getURL('player.html')}#${token}` });
      sendResponse({ ok: true, tabId: tab.id });
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  // The player page casts through its own sandboxed frame; it becomes the tab that popup controls talk to.
  if (message.type === 'castClaim' && sender.tab?.id !== undefined) {
    chrome.storage.session.set({ castTabId: sender.tab.id }).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'castStatus') {
    (async () => {
      if (sender.tab?.id !== await castTabId()) return;
      await setCastStatus(message.status);
    })().catch(error => console.error('Stream Scout cast status', error));
  }
  if (message.type === 'castCommand') {
    (async () => {
      const tabId = await castTabId();
      if (tabId === undefined) return sendResponse({ ok: false, error: 'Nothing is casting.' });
      await chrome.tabs.sendMessage(tabId, { type: 'castToPage', payload: { type: 'command', name: message.name, value: message.value } }, { frameId: 0 });
      sendResponse({ ok: true });
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'getCastStatus') {
    chrome.storage.session.get(['castStatus', 'castTabId']).then(sendResponse);
    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => { mediaByTab.delete(tabId); chrome.storage.session.remove(`media:${tabId}`); senderGone(tabId); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading') { mediaByTab.delete(tabId); chrome.storage.session.remove(`media:${tabId}`); updateBadge(tabId); senderGone(tabId); } });
