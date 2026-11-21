/* Playback wrapper (ES5).
   - On the TV: Samsung AVPlay (webapis.avplay), which handles HLS, DASH,
     MP3/AAC/Icecast natively on Tizen 2.4 and draws on the video plane.
   - Elsewhere (desktop testing) or if AVPlay is missing: HTML5 <video>.
   - Fallback: Tizen 2.4's AVPlay has an old TLS stack. It cannot reach some HTTPS
     hosts that the browser reaches fine: no SNI (CloudFront, used by SIC) and
     raw.githubusercontent.com (the playlist's TVI/CNN Portugal wrapper .m3u8 files).
     On PLAYER_ERROR_CONNECTION_FAILED the host is remembered and:
       1. the browser downloads the playlist; if it is a master playlist, AVPlay
          plays its best variant directly (works when the variant is on another host);
       2. otherwise the stream plays in HTML5 <video>, which uses the browser's stack.
   Callbacks: onState(state, detail) with state in
   'loading' | 'buffering' (detail = percent) | 'playing' | 'paused' | 'error' (detail = message) | 'ended' | 'stopped' */
(function (global) {
  'use strict';

  var START_TIMEOUT_MS = 25000;

  var avplay = null;
  try { avplay = global.webapis && global.webapis.avplay ? global.webapis.avplay : null; } catch (e) { avplay = null; }

  var objEl, videoEl, onState = function () {};
  var session = 0;              // bumped on every play/stop to drop stale callbacks
  var current = null;           // channel being played
  var rect = { x: 0, y: 0, w: 0, h: 0 };
  var startTimer = null;
  var suspended = false;
  var state = 'stopped';
  var active = null;            // engine of the current playback: 'avplay' | 'html5' | null
  var noAvHosts = (global.U && global.U.store.get('noavhosts', {})) || {};   // hosts AVPlay can't connect to

  function hostOf(url) { var m = /^https?:\/\/([^\/:?#]+)/i.exec(url); return m ? m[1].toLowerCase() : ''; }

  function emit(s, detail) { state = s; onState(s, detail); }

  function clearStartTimer() { if (startTimer) { clearTimeout(startTimer); startTimer = null; } }

  function armTimer(my) {
    clearStartTimer();
    startTimer = setTimeout(function () {
      if (my !== session) { return; }
      closeAll();
      emit('error', 'Timed out waiting for the stream');
    }, START_TIMEOUT_MS);
  }

  function closeAll() {
    if (avplay) { avClose(); }
    if (videoEl && active === 'html5') { h5Close(); }
    active = null;
  }

  function errorText(code) {
    var s = String(code || '');
    if (/CONNECTION|NETWORK|TIMEOUT/i.test(s)) { return 'Cannot connect to the stream'; }
    if (/UNSUPPORTED|CODEC|FORMAT|INVALID_URI|NOT_SUPPORTED/i.test(s)) { return 'Stream format not supported by this TV'; }
    if (/DRM|LICENSE/i.test(s)) { return 'Protected (DRM) stream — not playable'; }
    return 'Stream unavailable' + (s ? ' (' + s.replace(/^PLAYER_ERROR_/, '') + ')' : '');
  }

  /* App coordinates → AVPlay coordinates (the TV's display rect is based on a
     1920x1080 screen; the app viewport is normally 1920 wide too). */
  function applyRect() {
    var scale = 1920 / (global.innerWidth || 1920);
    var x = Math.round(rect.x * scale), y = Math.round(rect.y * scale);
    var w = Math.round(rect.w * scale), h = Math.round(rect.h * scale);
    var els = objEl ? [objEl, videoEl] : [videoEl], i;
    for (i = 0; i < els.length; i++) {
      els[i].style.left = rect.x + 'px'; els[i].style.top = rect.y + 'px';
      els[i].style.width = rect.w + 'px'; els[i].style.height = rect.h + 'px';
    }
    if (avplay && active === 'avplay') {
      try { if (avplay.getState() !== 'NONE') { avplay.setDisplayRect(x, y, w, h); } } catch (e) {}
    }
  }

  /* Resolve playlist-style radio URLs (.pls) to the real stream URL. */
  function resolveUrl(url, cb) {
    if (!/\.pls(\?|$)/i.test(url)) { cb(url); return; }
    global.U.get(url, 8000, function (err, txt) {
      var m = !err && txt ? /^\s*File\d+\s*=\s*(\S+)/im.exec(txt) : null;
      cb(m ? m[1] : url);
    });
  }

  /* ---------- AVPlay engine ---------- */
  function avClose() {
    try {
      var st = avplay.getState();
      if (st !== 'NONE' && st !== 'IDLE') { avplay.stop(); }
      if (st !== 'NONE') { avplay.close(); }
    } catch (e) {}
  }

  function absUrl(u, base) {
    if (/^https?:\/\//i.test(u)) { return u; }
    if (u.charAt(0) === '/') { return base.replace(/^(https?:\/\/[^\/]+).*$/i, '$1') + u; }
    return base.replace(/[^\/?#]*([?#].*)?$/, '') + u;
  }

  /* Highest-bandwidth variant of an HLS master playlist, or null. */
  function pickVariant(text, base) {
    var lines = String(text).split(/\r?\n/), best = null, bestBw = -1, i, j, m, bw;
    for (i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('#EXT-X-STREAM-INF') !== 0) { continue; }
      m = /BANDWIDTH=(\d+)/.exec(lines[i]);
      bw = m ? parseInt(m[1], 10) : 0;
      for (j = i + 1; j < lines.length && (!lines[j].trim() || lines[j].charAt(0) === '#'); j++) {}
      if (j < lines.length && bw > bestBw) { bestBw = bw; best = lines[j].trim(); }
    }
    return best ? absUrl(best, base) : null;
  }

  /* AVPlay can't reach `url`: try a master playlist's variant in AVPlay, else <video>. */
  function viaBrowser(ch, url, my) {
    armTimer(my);
    if (!/\.m3u8(\?|$)/i.test(url)) { h5Start(ch, url, my); return; }
    global.U.get(url, 10000, function (err, txt) {
      if (my !== session) { return; }
      var v = !err && txt ? pickVariant(txt, url) : null;
      if (v && !noAvHosts[hostOf(v)]) { avStart(ch, v, my, true); }
      else { h5Start(ch, v || url, my); }
    });
  }

  /* AVPlay failed: on an HTTPS connection failure remember the host and go via the browser. */
  function avFail(ch, url, my, code, isVariant) {
    if (my !== session) { return; }
    avClose();
    if (/^https:/i.test(url) && /CONNECTION/i.test(String(code || ''))) {
      noAvHosts[hostOf(url)] = 1;
      if (global.U) { global.U.store.set('noavhosts', noAvHosts); }
      if (isVariant) { armTimer(my); h5Start(ch, url, my); } else { viaBrowser(ch, url, my); }
      return;
    }
    clearStartTimer();
    emit('error', errorText(code));
  }

  function avStart(ch, url, my, isVariant) {
    active = 'avplay';
    try {
      avClose();
      avplay.open(url);
      avplay.setListener({
        onbufferingstart: function () { if (my === session) { emit('buffering', 0); } },
        onbufferingprogress: function (p) { if (my === session && state !== 'playing') { emit('buffering', p); } },
        onbufferingcomplete: function () { if (my === session && state === 'buffering') { emit('playing'); } },
        onstreamcompleted: function () { if (my === session) { clearStartTimer(); emit('ended'); avClose(); } },
        oncurrentplaytime: function () {},
        onevent: function () {},
        onerror: function (type) { avFail(ch, url, my, type, isVariant); }
      });
      applyRect();
      try { avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e1) {}
      // The playlist's #EXTVLCOPT user-agent (a desktop Firefox string) is deliberately NOT
      // passed on: RTP answers it with 404 and no stream works better with it (checked
      // 2026-11-21 over all 87 entries). The TV's own user-agent is accepted everywhere.
      avplay.prepareAsync(function () {
        if (my !== session) { return; }
        try {
          applyRect();
          avplay.play();
          clearStartTimer();
          emit('playing');
        } catch (e3) { emit('error', errorText(e3.name || e3.message)); }
      }, function (err) {
        avFail(ch, url, my, err && (err.name || err.message), isVariant);
      });
    } catch (e) {
      avFail(ch, url, my, e.name || e.message, isVariant);
    }
  }

  /* ---------- HTML5 engine (desktop / fallback) ---------- */
  function h5Bind() {
    function guard(fn) { return function (ev) { if (videoEl._session === session) { fn(ev); } }; }
    videoEl.addEventListener('playing', guard(function () { clearStartTimer(); emit('playing'); }), false);
    videoEl.addEventListener('waiting', guard(function () { emit('buffering', 0); }), false);
    videoEl.addEventListener('pause', guard(function () { if (state === 'playing') { emit('paused'); } }), false);
    videoEl.addEventListener('ended', guard(function () { emit('ended'); }), false);
    videoEl.addEventListener('error', guard(function () {
      clearStartTimer();
      var code = videoEl.error ? videoEl.error.code : 0;
      emit('error', code === 4 ? 'Stream format not supported here' : 'Stream unavailable');
    }), false);
  }
  function h5Close() {
    try { videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); } catch (e) {}
    videoEl.style.display = 'none';
  }
  function h5Start(ch, url, my) {
    active = 'html5';
    videoEl._session = my;
    videoEl.style.display = 'block';
    applyRect();
    videoEl.src = url;
    try {
      var r = videoEl.play();                       // newer browsers return a promise; Tizen 2.4 doesn't
      if (r && typeof r.then === 'function') { r.then(null, function () {}); }   // failures arrive as 'error' events
    } catch (e) {}
  }

  /* ---------- public API ---------- */
  var Player = {
    engine: avplay ? 'avplay' : 'html5',

    init: function (holder, video, stateCb) {
      videoEl = video; onState = stateCb || onState;
      if (avplay) {
        objEl = document.createElement('object');
        objEl.id = 'av-player';
        objEl.setAttribute('type', 'application/avplayer');
        holder.appendChild(objEl);
      }
      h5Bind();
    },

    /* Engine of the current playback ('avplay' | 'html5' | null). */
    active: function () { return active; },

    current: function () { return current; },
    state: function () { return state; },

    setRect: function (x, y, w, h) { rect = { x: x, y: y, w: w, h: h }; applyRect(); },

    play: function (ch) {
      var my = ++session;
      current = ch;
      closeAll();
      emit('loading');
      armTimer(my);
      resolveUrl(ch.url, function (url) {
        if (my !== session) { return; }
        if (!avplay) { h5Start(ch, url, my); }
        else if (noAvHosts[hostOf(url)]) { viaBrowser(ch, url, my); }
        else { avStart(ch, url, my, false); }
      });
    },

    stop: function () {
      session++;
      clearStartTimer();
      closeAll();
      current = null;
      emit('stopped');
    },

    togglePause: function () {
      try {
        if (active === 'avplay') {
          var st = avplay.getState();
          if (st === 'PLAYING') { avplay.pause(); emit('paused'); }
          else if (st === 'PAUSED') { avplay.play(); emit('playing'); }
        } else if (current) {
          if (videoEl.paused) { videoEl.play(); } else { videoEl.pause(); }
        }
      } catch (e) {}
    },

    /* App hidden (Home/Source pressed): release the decoder; restart on return. */
    suspend: function () {
      if (!current || suspended) { return; }
      suspended = true;
      var ch = current;
      session++;
      clearStartTimer();
      closeAll();
      current = ch;
    },
    resume: function () {
      if (!suspended) { return; }
      suspended = false;
      if (current) { Player.play(current); }
    }
  };

  global.Player = Player;
}(this));
