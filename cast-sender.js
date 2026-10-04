(() => {
  const TAG = 'stream-scout';
  // Google's Cast library, bundled unchanged; the sender script loads first and defines chrome.cast for the framework.
  const SDK = ['vendor/cast/cast_sender.js', 'vendor/cast/cast_framework.js'];
  let context, player, controller, pending, sdk, loading = false, lastTimePost = 0;

  // The sandboxed cast frame has an opaque origin, so a named target origin would drop the message.
  const post = status => window.postMessage({ source: TAG, dir: 'to-ext', type: 'status', status }, '*');
  const errorCode = error => (typeof error === 'string' ? error : error?.code) || 'unknown';
  // The browser hands over a TV connection while it is still connecting, and the bundled sender writes to it at once,
  // which throws and fails the session before the video is sent. The sender gets the connection once it is open.
  const whenOpen = connection => connection.state !== 'connecting' ? connection : new Promise(resolve => {
    for (const type of ['connect', 'close', 'terminate']) connection.addEventListener(type, () => resolve(connection), { once: true });
  });
  for (const name of window.PresentationRequest ? ['start', 'reconnect'] : []) {
    const original = PresentationRequest.prototype[name];
    PresentationRequest.prototype[name] = function (...args) {
      return original.apply(this, args).then(connection => {
        // The bundled sender keeps a session whose connection has ended and goes on writing to it,
        // so the player starts the frame over before the next cast can reuse it. A sandbox page cannot reload itself.
        for (const type of ['close', 'terminate']) connection.addEventListener(type, () => setTimeout(() => {
          if (context?.getCurrentSession()) window.postMessage({ source: TAG, dir: 'to-ext', type: 'reset' }, '*');
        }, 300), { once: true });
        return whenOpen(connection);
      });
    };
  }

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
    const state = window.StreamScoutMedia.playerStateFor(player.playerState, session?.getMediaSession()?.idleReason);
    return {
      // Before the first load lands the TV reports idle, which would otherwise read as a finished video.
      state: loading && state === 'idle' ? 'buffering' : state,
      device: session?.getCastDevice().friendlyName || '',
      title: player.mediaInfo?.metadata?.title || '',
      currentTime: player.currentTime || 0,
      duration: player.duration || 0,
      paused: Boolean(player.isPaused),
      tracks: (player.mediaInfo?.tracks || []).filter(track => track.type === chrome.cast.media.TrackType.TEXT).map(track => ({ trackId: track.trackId, name: track.name })),
      activeTrackIds: session?.getMediaSession()?.activeTrackIds || [],
      rate: session?.getMediaSession()?.playbackRate || 1,
      volume: player.volumeLevel ?? 1,
      muted: Boolean(player.isMuted),
      canVolume: player.canControlVolume !== false
    };
  }

  const textStyle = style => Object.assign(new chrome.cast.media.TextTrackStyle(), style);

  async function start(at = 0) {
    const spec = pending;
    loading = true;
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
      if (spec.style) info.textTrackStyle = textStyle(spec.style);
      const request = new chrome.cast.media.LoadRequest(info);
      request.activeTrackIds = spec.activeTrackIds;
      request.currentTime = at;
      await context.getCurrentSession().loadMedia(request);
      // Some receivers start a stream at the beginning whatever the load asked for, so the spot is sought again.
      const media = context.getCurrentSession()?.getMediaSession();
      if (at > 2 && media && media.getEstimatedTime() < at - 2) {
        const seek = new chrome.cast.media.SeekRequest();
        seek.currentTime = at;
        media.seek(seek, () => post(status()), error => post({ ...status(), error: String(errorCode(error)) }));
      }
      loading = false;
      post(status());
    } catch (error) {
      loading = false;
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
    // A finished video has no media session left to resume, so it is loaded again on the connected TV.
    if (name === 'replay' && pending) start();
    // A subtitle file added on the PC reaches the TV only with a fresh load, which carries on from the same spot.
    if (name === 'reload' && value?.item?.url) { pending = window.StreamScoutMedia.buildMedia(value.item, Number(value.subtitleIndex) || 0); start(Number(value.at) || player.currentTime || 0); }
    if (name === 'seek') { player.currentTime = Number(value) || 0; controller.seek(); }
    if (name === 'stop') controller.stop();
    // The player may not report the dropped connection, so the page hears it from here.
    if (name === 'disconnect') {
      context.endCurrentSession(true);
      return post({ state: 'disconnected' });
    }
    if (name === 'volume') { player.volumeLevel = Math.min(Math.max(Number(value) || 0, 0), 1); controller.setVolumeLevel(); if (player.isMuted) controller.muteOrUnmute(); }
    if (name === 'mute') controller.muteOrUnmute();
    if (name === 'subtitle') {
      const request = new chrome.cast.media.EditTracksInfoRequest(Number(value) ? [Number(value)] : []);
      context.getCurrentSession()?.getMediaSession()?.editTracksInfo(request, () => post(status()), error => post({ ...status(), error: String(errorCode(error)) }));
    }
    if (name === 'style' && value) {
      if (pending) pending.style = value;
      const media = context.getCurrentSession()?.getMediaSession();
      media?.editTracksInfo(new chrome.cast.media.EditTracksInfoRequest(media.activeTrackIds || [], textStyle(value)), () => post(status()), error => post({ ...status(), error: String(errorCode(error)) }));
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
