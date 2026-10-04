(() => {
  const TAG = 'stream-scout';
  // Google's Cast library, bundled unchanged; the sender script loads first and defines chrome.cast for the framework.
  const SDK = ['vendor/cast/cast_sender.js', 'vendor/cast/cast_framework.js'];
  let context, player, controller, pending, sdk, lastTimePost = 0;

  // The sandboxed cast frame has an opaque origin, so a named target origin would drop the message.
  const post = status => window.postMessage({ source: TAG, dir: 'to-ext', type: 'status', status }, '*');
  const errorCode = error => (typeof error === 'string' ? error : error?.code) || 'unknown';

  function script(src) {
    return new Promise((resolve, reject) => {
      const node = document.createElement('script');
      node.src = src;
      node.onload = resolve;
      node.onerror = () => reject(new Error('sdk-blocked'));
      document.head.append(node);
    });
  }

  function loadSdk() {
    sdk ||= new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sdk-blocked')), 5000);
      // The sender reports availability itself, before or after its onload depending on document readiness.
      const available = new Promise(done => { window.__onGCastApiAvailable = done; });
      SDK.reduce((chain, src) => chain.then(() => script(src)), Promise.resolve())
        .then(() => (chrome.cast?.isAvailable ? true : available))
        .then(ok => { clearTimeout(timer); if (ok) resolve(); else reject(new Error('unavailable')); }, error => { clearTimeout(timer); reject(error); });
    });
    return sdk;
  }

  function setup() {
    if (context) return;
    context = cast.framework.CastContext.getInstance();
    context.setOptions({ receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
    player = new cast.framework.RemotePlayer();
    controller = new cast.framework.RemotePlayerController(player);
    controller.addEventListener(cast.framework.RemotePlayerEventType.ANY_CHANGE, event => {
      if (event.field === 'currentTime') {
        if (Date.now() - lastTimePost < 1000) return;
        lastTimePost = Date.now();
      }
      post(status());
    });
  }

  function status() {
    if (!player?.isConnected) return { state: 'disconnected' };
    const session = context.getCurrentSession();
    return {
      state: window.StreamScoutMedia.playerStateFor(player.playerState, session?.getMediaSession()?.idleReason),
      device: session?.getCastDevice().friendlyName || '',
      title: player.mediaInfo?.metadata?.title || '',
      currentTime: player.currentTime || 0,
      duration: player.duration || 0,
      paused: Boolean(player.isPaused),
      tracks: (player.mediaInfo?.tracks || []).filter(track => track.type === chrome.cast.media.TrackType.TEXT).map(track => ({ trackId: track.trackId, name: track.name })),
      activeTrackIds: session?.getMediaSession()?.activeTrackIds || [],
      rate: session?.getMediaSession()?.playbackRate || 1
    };
  }

  async function start() {
    const spec = pending;
    try {
      if (!context.getCurrentSession()) await context.requestSession();
      const info = new chrome.cast.media.MediaInfo(spec.url, spec.contentType);
      info.streamType = chrome.cast.media.StreamType.BUFFERED;
      info.metadata = new chrome.cast.media.GenericMediaMetadata();
      info.metadata.title = spec.title;
      info.metadata.subtitle = spec.host;
      info.tracks = spec.tracks.map(item => {
        const track = new chrome.cast.media.Track(item.trackId, chrome.cast.media.TrackType.TEXT);
        track.trackContentId = item.url;
        track.trackContentType = item.contentType;
        track.subtype = chrome.cast.media.TextTrackType.SUBTITLES;
        track.name = item.name;
        track.language = item.language;
        return track;
      });
      const request = new chrome.cast.media.LoadRequest(info);
      request.activeTrackIds = spec.activeTrackIds;
      await context.getCurrentSession().loadMedia(request);
      post(status());
    } catch (error) {
      const code = errorCode(error);
      post(code === chrome.cast.ErrorCode.CANCEL ? { state: 'cancelled' } : { state: 'error', error: String(error?.description || code) });
    }
  }

  // Clicking Cast while already connected opens the browser's device dialog, where the user can switch TV or stop.
  async function manage() {
    try { await context.requestSession(); }
    catch (error) { return post(errorCode(error) === chrome.cast.ErrorCode.CANCEL ? status() : { state: 'error', error: String(error?.description || errorCode(error)) }); }
    if (!context.getCurrentSession()?.getMediaSession() && pending) return start();
    post(status());
  }

  // The web sender library has no playback-rate call, so this sends the receiver's standard media message itself.
  function setSpeed(rate) {
    const session = context.getCurrentSession();
    const media = session?.getMediaSession();
    if (!media) return post(status());
    session.sendMessage('urn:x-cast:com.google.cast.media', { type: 'SET_PLAYBACK_RATE', mediaSessionId: media.mediaSessionId, playbackRate: rate, requestId: Math.floor(Math.random() * 1e9) })
      .then(() => setTimeout(() => post(status()), 600), error => post({ ...status(), error: `speed-${errorCode(error)}` }));
  }

  async function prepare() {
    try { await loadSdk(); } catch (error) { post({ state: window.StreamScoutMedia.sdkFailure(error) }); return false; }
    setup();
    return true;
  }

  // Sent from the Cast button's click, so the device picker may open.
  async function load(item, subtitleIndex) {
    if (!await prepare()) return;
    pending = window.StreamScoutMedia.buildMedia(item, subtitleIndex);
    start();
  }

  function command(name, value) {
    if (!player?.isConnected) return post(status());
    if (name === 'playPause') controller.playOrPause();
    if (name === 'seek') { player.currentTime = Number(value) || 0; controller.seek(); }
    if (name === 'stop') controller.stop();
    if (name === 'disconnect') context.endCurrentSession(true);
    if (name === 'subtitle') {
      const request = new chrome.cast.media.EditTracksInfoRequest(Number(value) ? [Number(value)] : []);
      context.getCurrentSession()?.getMediaSession()?.editTracksInfo(request, () => post(status()), error => post({ ...status(), error: String(errorCode(error)) }));
    }
    if (name === 'speed') setSpeed(Number(value) || 1);
    if (name === 'status') post(status());
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || data?.source !== TAG || data.dir !== 'to-page') return;
    if (data.type === 'prepare') prepare().then(ready => ready && post(status()));
    if (data.type === 'load' && data.item?.url) load(data.item, Number(data.subtitleIndex) || 0);
    if (data.type === 'command') command(data.name, data.value);
    if (data.type === 'manage') prepare().then(ready => {
      if (!ready) return;
      if (data.item?.url) pending = window.StreamScoutMedia.buildMedia(data.item, Number(data.subtitleIndex) || 0);
      manage();
    });
  });
})();
