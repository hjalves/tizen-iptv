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
  // Hosts AVPlay can't connect to. A host is only recorded once the browser path has
  // actually played from it: AVPlay also reports CONNECTION_FAILED for dead or
  // encrypted streams, and one bad entry must not push a whole server into the fallback.
  var noAvHosts = (global.U && global.U.store.get('noavhosts2', {})) || {};

  function rememberNoAv(host) {
    if (!host || noAvHosts[host]) { return; }
    noAvHosts[host] = 1;
    if (global.U) { global.U.store.set('noavhosts2', noAvHosts); }
  }

  function hostOf(url) { var m = /^https?:\/\/([^\/:?#]+)/i.exec(url); return m ? m[1].toLowerCase() : ''; }

  var lastError = '';
  function emit(s, detail) { state = s; if (s === 'error') { lastError = detail; } onState(s, detail); }

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
    if (active === 'shaka') { shClose(); }
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
  function viaBrowser(ch, url, my, failHost) {
    armTimer(my);
    if (!/\.m3u8(\?|$)/i.test(url)) { h5Start(ch, url, my, failHost); return; }
    global.U.get(url, 10000, function (err, txt) {
      if (my !== session) { return; }
      var v = !err && txt ? pickVariant(txt, url) : null;
      if (v && !noAvHosts[hostOf(v)]) { avStart(ch, v, my, true, failHost); }
      else { h5Start(ch, v || url, my, failHost); }
    });
  }

  /* AVPlay failed: on an HTTPS connection failure remember the host and go via the browser. */
  function avFail(ch, url, my, code, isVariant, failHost) {
    if (my !== session) { return; }
    avClose();
    if (/^https:/i.test(url) && /CONNECTION/i.test(String(code || ''))) {
      if (isVariant) { armTimer(my); h5Start(ch, url, my, hostOf(url)); }
      else { viaBrowser(ch, url, my, hostOf(url)); }
      return;
    }
    clearStartTimer();
    emit('error', errorText(code));
  }

  function avStart(ch, url, my, isVariant, failHost) {
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
        onerror: function (type) { avFail(ch, url, my, type, isVariant, failHost); }
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
          if (failHost && failHost !== hostOf(url)) { rememberNoAv(failHost); }   // wrapper host failed, variant elsewhere played
          emit('playing');
        } catch (e3) { emit('error', errorText(e3.name || e3.message)); }
      }, function (err) {
        avFail(ch, url, my, err && (err.name || err.message), isVariant, failHost);
      });
    } catch (e) {
      avFail(ch, url, my, e.name || e.message, isVariant, failHost);
    }
  }

  /* ---------- HTML5 engine (desktop / fallback) ---------- */
  function h5Bind() {
    function guard(fn) { return function (ev) { if (videoEl._session === session) { fn(ev); } }; }
    videoEl.addEventListener('playing', guard(function () {
      clearStartTimer();
      rememberNoAv(videoEl._failHost);     // AVPlay couldn't reach it, the browser could
      emit('playing');
    }), false);
    videoEl.addEventListener('waiting', guard(function () { emit('buffering', 0); }), false);
    videoEl.addEventListener('pause', guard(function () { if (state === 'playing') { emit('paused'); } }), false);
    videoEl.addEventListener('ended', guard(function () { emit('ended'); }), false);
    videoEl.addEventListener('error', guard(function () {
      clearStartTimer();
      var code = videoEl.error ? videoEl.error.code : 0;
      emit('error', active === 'shaka' ? 'Playback error (media error ' + code + ')' :
        (code === 4 ? 'Stream format not supported here' : 'Stream unavailable'));
    }), false);
  }
  function h5Close() {
    try { videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); } catch (e) {}
    videoEl.style.display = 'none';
  }
  function h5Start(ch, url, my, failHost) {
    active = 'html5';
    videoEl._session = my;
    videoEl._failHost = failHost || '';
    videoEl.style.display = 'block';
    applyRect();
    videoEl.src = url;
    try {
      var r = videoEl.play();                       // newer browsers return a promise; Tizen 2.4 doesn't
      if (r && typeof r.then === 'function') { r.then(null, function () {}); }   // failures arrive as 'error' events
    } catch (e) {}
  }

  /* ---------- ClearKey DASH: Shaka Player + software CENC decryption ----------
     Tizen 2.4's own ClearKey support doesn't decrypt (see cenc.js), so Shaka streams
     the DASH segments, cenc.js decrypts each one in a response filter, and the clear
     MP4 goes to Media Source Extensions. Shaka (320 KB) is loaded on first use. */
  var SHAKA_SRC = 'js/vendor/shaka-player.compiled.js';
  var shakaState = 'none', shakaWaiters = [], shp = null, decryptor = null, decryptKeys = '', timeline = { shift: null };

  function loadShaka(cb) {
    if (shakaState === 'ready' || shakaState === 'failed') { cb(shakaState === 'ready'); return; }
    shakaWaiters.push(cb);
    if (shakaState === 'loading') { return; }
    shakaState = 'loading';
    function done(ok) {
      shakaState = ok ? 'ready' : 'failed';
      var w = shakaWaiters, i; shakaWaiters = [];
      for (i = 0; i < w.length; i++) { w[i](ok); }
    }
    var el = document.createElement('script');
    el.src = SHAKA_SRC;
    el.onload = function () {
      try { global.shaka.polyfill.installAll(); done(true); } catch (e) { done(false); }   // also polyfills promises
    };
    el.onerror = function () { done(false); };
    document.getElementsByTagName('head')[0].appendChild(el);
  }

  /* Tizen 2.4's WebKit keeps media time as signed 32-bit milliseconds, so times past
     2^31 ms (~24.8 days) wrap (seen: currentTime jumping by -2^32/1000). Live DASH times
     count from MPD@availabilityStartTime, often weeks back. Shift the timeline: move
     availabilityStartTime forward by S seconds and add S * timescale to each timeline
     SegmentTemplate's presentationTimeOffset. Segment URLs ($Time$) are unchanged; the
     browser just sees small times. S stays fixed for a playback (the MPD refreshes).
     Number-based templates are left alone: their segment numbers derive from the clock. */
  var KEEP_SECONDS = 86400;                             // leave ~1 day of timeline
  function shiftLiveTimeline(xml, st) {
    var doc = new DOMParser().parseFromString(xml, 'text/xml'), mpd = doc.documentElement, i, tpls, t, ts, pto;
    if (!mpd || mpd.nodeName !== 'MPD' || mpd.getAttribute('type') !== 'dynamic') { return xml; }
    var ast = Date.parse(mpd.getAttribute('availabilityStartTime') || '');
    if (isNaN(ast)) { return xml; }
    tpls = doc.getElementsByTagName('SegmentTemplate');
    for (i = 0; i < tpls.length; i++) {
      if (!tpls[i].getElementsByTagName('SegmentTimeline').length) { return xml; }   // number-based: leave
    }
    if (st.shift === null) {
      var elapsed = Math.floor((Date.now() - ast) / 1000);
      st.shift = elapsed > 7 * 86400 ? elapsed - KEEP_SECONDS : 0;
    }
    if (!st.shift) { return xml; }
    mpd.setAttribute('availabilityStartTime', new Date(ast + st.shift * 1000).toISOString());
    for (i = 0; i < tpls.length; i++) {
      t = tpls[i]; ts = parseInt(t.getAttribute('timescale') || '1', 10);
      pto = parseInt(t.getAttribute('presentationTimeOffset') || '0', 10);
      t.setAttribute('presentationTimeOffset', String(pto + st.shift * ts));
    }
    return new XMLSerializer().serializeToString(doc);
  }

  /* Decryption runs in a Web Worker (cenc-worker.js) so the UI and the remote stay
     responsive: a 4 s segment takes 0.5-1 s of CPU on this TV. Falls back to inline. */
  var worker = null, workerJobs = {}, workerSeq = 0, workerBroken = false;
  function decryptAsync(buf, keys, dec) {
    if (!workerBroken && !worker) {
      try {
        worker = new Worker('js/cenc-worker.js');
        worker.onmessage = function (ev) {
          var job = workerJobs[ev.data.id]; delete workerJobs[ev.data.id];
          if (!job) { return; }
          if (ev.data.error) { job.reject(new Error(ev.data.error)); } else { job.resolve(ev.data.buf); }
        };
        worker.onerror = function () {
          workerBroken = true;                           // later segments decrypt inline
          var id, jobs = workerJobs; workerJobs = {};
          for (id in jobs) { if (jobs.hasOwnProperty(id)) { jobs[id].reject(new Error('decrypt worker failed')); } }
        };
      } catch (e) { workerBroken = true; }
    }
    if (workerBroken) { return dec.process(buf); }            // synchronous fallback
    return new global.Promise(function (resolve, reject) {      // es5-ok: only runs once Shaka has polyfilled it
      var id = ++workerSeq;
      workerJobs[id] = { resolve: resolve, reject: reject };
      worker.postMessage({ id: id, keys: keys, buf: buf }, [buf]);
    });
  }

  /* RTP's servers answer a segment requested a moment too early with HTTP 200 and the
     *previous* segment's content (seen: tfdt 4 s older than the URL's $Time$). Appending
     that duplicates 4 s and leaves a hole. So check each segment: if the URL holds a time
     the content is slightly older than, refetch it (cache-busted) until it's right. */
  function isStale(uri, buf) {
    var t = global.CENC.tfdt(buf), nums, i, n;
    if (t === null) { return false; }
    nums = String(uri).split('?')[0].match(/\d{9,}/g) || [];
    for (i = 0; i < nums.length; i++) { if (parseFloat(nums[i]) === t) { return false; } }
    for (i = 0; i < nums.length; i++) {
      n = parseFloat(nums[i]);
      if (n > t && n - t <= n * 0.001) { return true; }        // a time just ahead of the content
    }
    return false;
  }

  function refetchFresh(uri, tries, cb) {
    setTimeout(function () {
      var x = new XMLHttpRequest();
      x.open('GET', uri + (uri.indexOf('?') < 0 ? '?' : '&') + 'fresh=' + Date.now(), true);
      x.responseType = 'arraybuffer';
      x.onreadystatechange = function () {
        if (x.readyState !== 4) { return; }
        if (x.status === 200 && x.response && x.response.byteLength && !isStale(uri, x.response)) { cb(x.response); }
        else if (tries > 1) { refetchFresh(uri, tries - 1, cb); }
        else { cb(null); }
      };
      x.send();
    }, 1000);
  }

  function shakaPlayer() {
    if (shp) { return shp; }
    var S = global.shaka, SU = S.util.StringUtils, RT = S.net.NetworkingEngine.RequestType;
    shp = new S.Player(videoEl);
    shp.configure({ streaming: {
      bufferingGoal: 12, rebufferingGoal: 2,
      // RTP's servers occasionally fail a request (404 / empty 204): retry more, and if a
      // segment is still lost, skip the hole instead of freezing at its edge.
      retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2, fuzzFactor: 0.5, timeout: 15000 },
      jumpLargeGaps: true
    } });
    shp.getNetworkingEngine().registerResponseFilter(function (type, resp) {
      if (!decryptor) { return; }
      if (type === RT.MANIFEST) {
        // Hide the encryption from Shaka, so it doesn't try the TV's (non-working) EME.
        var xml = SU.fromUTF8(resp.data).replace(/<ContentProtection[^>]*\/>/g, '')
          .replace(/<ContentProtection[\s\S]*?<\/ContentProtection>/g, '');
        resp.data = SU.toUTF8(shiftLiveTimeline(xml, timeline));
      } else if (type === RT.SEGMENT) {
        if (!resp.data || !resp.data.byteLength) { throw new Error('empty segment'); }   // RTP's 204s
        var keys = decryptKeys, dec = decryptor;
        var finish = function (buf) {
          var r = decryptAsync(buf, keys, dec);
          if (r && typeof r.then === 'function') { return r.then(function (b) { resp.data = b; }); }
          resp.data = r;
        };
        if (isStale(resp.uri, resp.data)) {
          return new global.Promise(function (resolve, reject) {   // es5-ok: Shaka polyfills it
            refetchFresh(resp.uri, 6, function (fresh) {
              if (!fresh) { reject(new Error('segment stayed stale: ' + resp.uri)); return; }
              var p = finish(fresh);
              if (p) { p.then(resolve, reject); } else { resolve(); }
            });
          });
        }
        return finish(resp.data);
      }
    });
    shp.addEventListener('error', function (ev) {
      var d = ev.detail || {};
      if (active !== 'shaka' || d.severity !== 2) { return; }      // 2 = critical
      clearStartTimer();
      emit('error', 'Stream unavailable (player error ' + d.code + ')');
    });
    return shp;
  }

  function canDecrypt(ch) {
    return !!(ch.drmType && /clearkey/i.test(ch.drmType) && /\.mpd(\?|$)/i.test(ch.url) &&
      global.CENC && new global.CENC.Decryptor(ch.drmKey).hasKeys());
  }

  function shStart(ch, url, my) {
    active = 'shaka';
    videoEl._session = my;                 // the <video> events report playing/buffering
    videoEl._failHost = '';
    videoEl.style.display = 'block';
    applyRect();
    loadShaka(function (ok) {
      if (my !== session) { return; }
      if (!ok) { clearStartTimer(); emit('error', 'Could not load the DASH player'); return; }
      decryptor = new global.CENC.Decryptor(ch.drmKey);
      decryptKeys = ch.drmKey;
      timeline = { shift: null };
      shakaPlayer().load(url).then(function () {
        if (my !== session) { return; }
        try { var r = videoEl.play(); if (r && typeof r.then === 'function') { r.then(null, function () {}); } } catch (e) {}
      }, function (e) {
        if (my !== session) { return; }
        clearStartTimer();
        emit('error', 'Stream unavailable (player error ' + (e && e.code) + ')');
      });
    });
  }

  function shClose() {
    decryptor = null;
    if (shp) { try { shp.unload(); } catch (e) {} }
    videoEl.style.display = 'none';
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

    /* Engine of the current playback ('avplay' | 'html5' | 'shaka' | null). */
    active: function () { return active; },

    /* True for encrypted entries this app can still play (ClearKey DASH with keys). */
    canDecrypt: canDecrypt,

    current: function () { return current; },
    lastError: function () { return lastError; },
    /* Debugging aid (inspector): the Shaka player instance, if created. */
    shakaInstance: function () { return shp; },
    state: function () { return state; },

    setRect: function (x, y, w, h) { rect = { x: x, y: y, w: w, h: h }; applyRect(); },

    play: function (ch) {
      var my = ++session;
      current = ch;
      closeAll();
      emit('loading');
      armTimer(my);
      if (ch.drmType) {
        if (canDecrypt(ch)) { shStart(ch, ch.url, my); return; }
        // Other DRM: the playlist gives no licence servers for PlayReady/Widevine, and
        // ClearKey without keys (licence URL only) isn't handled.
        clearStartTimer();
        emit('error', 'Encrypted stream (' + ch.drmType.replace(/^org\.w3\./, '') + ') — this TV can\'t decrypt it');
        return;
      }
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
