/* Small ES5 helpers. Target: Tizen 2.4 TV WebKit (2016) — no Promise, fetch,
   arrow functions, let/const, template strings, Array.find/includes, etc. */
(function (global) {
  'use strict';

  var U = {};

  U.$ = function (id) { return document.getElementById(id); };

  U.hasClass = function (el, c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') >= 0; };
  U.addClass = function (el, c) { if (!U.hasClass(el, c)) { el.className = (el.className ? el.className + ' ' : '') + c; } };
  U.removeClass = function (el, c) {
    el.className = (' ' + el.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  };
  U.toggleClass = function (el, c, on) { if (on) { U.addClass(el, c); } else { U.removeClass(el, c); } };

  U.text = function (el, s) { el.textContent = s == null ? '' : String(s); };

  U.escapeHtml = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  U.pad2 = function (n) { return n < 10 ? '0' + n : String(n); };

  U.initials = function (name) {
    var words = String(name).replace(/[^A-Za-z0-9À-ɏ ]/g, ' ').split(/\s+/), out = '', i;
    for (i = 0; i < words.length && out.length < 3; i++) { if (words[i]) { out += words[i].charAt(0).toUpperCase(); } }
    return out || '?';
  };

  /* GET a URL as text. cb(err, text). Local files report status 0 on Tizen. */
  U.get = function (url, timeoutMs, cb) {
    var xhr = new XMLHttpRequest(), done = false, timer;
    function finish(err, txt) {
      if (done) { return; }
      done = true;
      clearTimeout(timer);
      cb(err, txt);
    }
    try {
      xhr.open('GET', url, true);
      if (xhr.overrideMimeType) { xhr.overrideMimeType('text/plain; charset=utf-8'); }
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText)) {
          finish(null, xhr.responseText);
        } else {
          finish(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.send(null);
    } catch (e) {
      finish(e);
      return;
    }
    timer = setTimeout(function () { try { xhr.abort(); } catch (e) {} finish(new Error('timeout')); }, timeoutMs);
  };

  /* localStorage wrapper; tolerant of quota errors and private modes. */
  U.store = {
    get: function (k, def) {
      try {
        var v = global.localStorage.getItem(k);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set: function (k, v) {
      try { global.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    remove: function (k) { try { global.localStorage.removeItem(k); } catch (e) {} }
  };

  /* ---- Remote control keys ----
     Codes are asked from the TV (tvinputdevice.getKey) when available; the
     numbers below are only the fallback for desktop testing. */
  var KEY_NAMES = ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    'ChannelUp', 'ChannelDown', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
    'Info', 'Guide', 'PreviousChannel', 'ChannelList',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

  U.KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, RETURN: 10009,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    CH_UP: 427, CH_DOWN: 428, PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413,
    INFO: 457, GUIDE: 458, PREV_CH: 10190, CH_LIST: 10073
  };
  var NAME_TO_KEY = {
    ColorF0Red: 'RED', ColorF1Green: 'GREEN', ColorF2Yellow: 'YELLOW', ColorF3Blue: 'BLUE',
    ChannelUp: 'CH_UP', ChannelDown: 'CH_DOWN', MediaPlayPause: 'PLAYPAUSE', MediaPlay: 'PLAY',
    MediaPause: 'PAUSE', MediaStop: 'STOP', Info: 'INFO', Guide: 'GUIDE', PreviousChannel: 'PREV_CH', ChannelList: 'CH_LIST'
  };

  U.registerKeys = function () {
    var tv = global.tizen && global.tizen.tvinputdevice, i, name, k;
    if (!tv) { return; }
    for (i = 0; i < KEY_NAMES.length; i++) {
      name = KEY_NAMES[i];
      try { tv.registerKey(name); } catch (e) { /* key not on this model */ }
      if (NAME_TO_KEY[name]) {
        try { k = tv.getKey(name); if (k && k.code) { U.KEY[NAME_TO_KEY[name]] = k.code; } } catch (e2) {}
      }
    }
    try { k = tv.getKey('Return'); if (k && k.code) { U.KEY.RETURN = k.code; } } catch (e3) {}
  };

  /* Normalise a keydown event to a key name (string) or a digit ('0'..'9'). */
  U.keyName = function (ev) {
    var c = ev.keyCode, K = U.KEY, n;
    if (c >= 48 && c <= 57) { return String(c - 48); }
    if (c >= 96 && c <= 105) { return String(c - 96); }       // numpad (desktop)
    for (n in K) { if (K.hasOwnProperty(n) && K[n] === c) { return n; } }
    // desktop conveniences
    if (c === 27 || c === 8) { return 'RETURN'; }               // Esc / Backspace
    if (c === 33) { return 'CH_UP'; }                           // PageUp
    if (c === 34) { return 'CH_DOWN'; }                         // PageDown
    if (c === 82) { return 'RED'; }                             // r
    if (c === 71) { return 'GREEN'; }                           // g
    if (c === 89) { return 'YELLOW'; }                          // y
    if (c === 66) { return 'BLUE'; }                            // b
    if (c === 73) { return 'INFO'; }                            // i
    if (c === 69) { return 'GUIDE'; }                           // e (EPG)
    if (c === 32) { return 'PLAYPAUSE'; }                       // space
    return null;
  };

  global.U = U;
}(this));
