/* Programme guide (ES5).

   Source: SETTINGS.epgUrl (https://m3upt.com/epg, which redirects to the M3UPT
   repo's epg-m3upt.xml.gz: ~3 MB gzip, ~35 MB of XMLTV). epg-worker.js inflates
   and scans it off the UI thread and returns only the playlist's channels from
   1 h ago to 30 h ahead (~0.8 MB as JSON). That is cached in localStorage and
   refreshed when older than 6 h or running out of future programmes.

   Programmes: [startSec, stopSec, title, desc], matched to channels by tvg-id. */
(function (global) {
  'use strict';

  var U = global.U;
  var MAX_AGE_MS = 6 * 3600 * 1000, BEHIND = 3600, AHEAD = 30 * 3600, MIN_AHEAD = 12 * 3600;

  var data = U.store.get('epg', null);       // { fetched: ms, to: sec, items: {tvgId: [...]} }
  var listeners = [], busy = false, state = data ? 'ready' : 'none';
  var phase = '', percent = -1;              // phase: '' | 'download' | 'parse'

  function nowSec() { return Math.floor(new Date().getTime() / 1000); }
  function notify() { for (var i = 0; i < listeners.length; i++) { listeners[i](); } }

  function usable(maxAge) {
    return !!data && new Date().getTime() - data.fetched < maxAge && data.to - nowSec() > MIN_AHEAD;
  }

  function setPhase(p, pct) { phase = p; percent = pct === undefined ? -1 : pct; notify(); }

  function fetchGz(url, cb) {
    var x = new XMLHttpRequest(), done = false, lastPct = -1;
    function fin(err, buf) { if (!done) { done = true; clearTimeout(timer); cb(err, buf); } }
    var timer = setTimeout(function () { try { x.abort(); } catch (e) {} fin(new Error('timeout')); }, 120000);
    try {
      x.open('GET', url, true);
      x.responseType = 'arraybuffer';
      x.onprogress = function (ev) {
        if (!ev.lengthComputable || !ev.total) { return; }
        var pct = Math.floor(100 * ev.loaded / ev.total);
        if (pct >= lastPct + 5) { lastPct = pct; setPhase('download', pct); }   // notify every 5 %
      };
      x.onreadystatechange = function () {
        if (x.readyState !== 4) { return; }
        if (x.status === 200 && x.response && x.response.byteLength) { fin(null, x.response); }
        else { fin(new Error('HTTP ' + x.status)); }
      };
      x.send();
    } catch (e) { fin(e); }
  }

  function save() {
    if (U.store.set('epg', data)) { return; }
    // Over the storage quota: keep it without descriptions, else memory only.
    var slim = { fetched: data.fetched, to: data.to, items: {} }, k;
    for (k in data.items) {
      if (data.items.hasOwnProperty(k)) {
        slim.items[k] = data.items[k].map(function (p) { return [p[0], p[1], p[2], '']; });
      }
    }
    if (!U.store.set('epg', slim)) { U.store.remove('epg'); }
  }

  var EPG = {
    onChange: function (fn) { listeners.push(fn); },

    /* What a refresh is doing now: '' | 'download' | 'parse', and download % (-1 if unknown). */
    phase: function () { return phase; },
    percent: function () { return percent; },

    /* 'none' | 'loading' | 'ready' | 'failed' */
    state: function () { return state; },
    channelCount: function () { var n = 0, k; if (data) { for (k in data.items) { if (data.items.hasOwnProperty(k)) { n++; } } } return n; },

    /* Refresh in the background if the cache is older than maxAgeMs (default 6 h). */
    update: function (channels, maxAgeMs) {
      if (busy || usable(maxAgeMs || MAX_AGE_MS)) { return; }
      var url = (global.SETTINGS && global.SETTINGS.epgUrl) || '', wanted = {}, n = 0, i, worker;
      for (i = 0; i < channels.length; i++) { if (channels[i].tvgId && !wanted[channels[i].tvgId]) { wanted[channels[i].tvgId] = true; n++; } }
      if (!url || !n) { return; }
      try { worker = new Worker('js/epg-worker.js'); } catch (e) { state = 'failed'; notify(); return; }
      busy = true;
      if (!data) { state = 'loading'; }
      setPhase('download');
      fetchGz(url, function (err, buf) {
        if (err) { busy = false; phase = ''; if (!data) { state = 'failed'; } notify(); worker.terminate(); return; }
        var t = nowSec();
        setPhase('parse');
        worker.onmessage = function (ev) {
          worker.terminate();
          busy = false; phase = '';
          if (ev.data.error) { if (!data) { state = 'failed'; } notify(); return; }
          data = { fetched: new Date().getTime(), to: t + AHEAD, items: ev.data.items };
          state = 'ready';
          save();
          notify();
        };
        worker.onerror = function () { busy = false; phase = ''; if (!data) { state = 'failed'; } notify(); };
        worker.postMessage({ buf: buf, wanted: wanted, from: t - BEHIND, to: t + AHEAD, descMax: 500 }, [buf]);
      });
    },

    /* All cached programmes of a tvg-id (sorted by start), or []. */
    list: function (tvgId) { return (data && tvgId && data.items[tvgId]) || []; },

    /* { now: programme|null, next: programme|null } for a tvg-id at time t (sec). */
    nowNext: function (tvgId, t) {
      var list = data && tvgId && data.items[tvgId], i, p;
      if (!list) { return null; }
      t = t || nowSec();
      for (i = 0; i < list.length; i++) {
        p = list[i];
        if (p[0] <= t && t < p[1]) { return { now: p, next: list[i + 1] || null }; }
        if (p[0] > t) { return { now: null, next: p }; }
      }
      return { now: null, next: null };
    },

    hhmm: function (sec) { var d = new Date(sec * 1000); return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()); }
  };

  global.EPG = EPG;
}(this));
