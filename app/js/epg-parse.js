/* Streaming XMLTV parser (ES5; runs in the EPG worker and in Node for tests).

   The M3UPT guide is ~35 MB of XML once unzipped, too much for the TV to hold or
   hand to DOMParser. This scans the inflated bytes chunk by chunk for
   <programme ...>...</programme> blocks, reads the ASCII header (start, stop,
   channel) without decoding, and UTF-8-decodes only the blocks it keeps:
   programmes of the wanted channels that overlap [from, to].

   Result: { tvgId: [[startSec, stopSec, title, desc], ...] } sorted by start. */
(function (global) {
  'use strict';

  function ascii(s) { var a = new Uint8Array(s.length), i; for (i = 0; i < s.length; i++) { a[i] = s.charCodeAt(i); } return a; }
  var OPEN = ascii('<programme '), CLOSE = ascii('</programme>');

  function find(d, pat, from, end) {
    var first = pat[0], n = pat.length, i, j;
    for (i = from; i <= end - n; i++) {
      if (d[i] !== first) { continue; }
      for (j = 1; j < n && d[i + j] === pat[j]; j++) {}
      if (j === n) { return i; }
    }
    return -1;
  }

  function copy(d, s, e) { var c = new Uint8Array(e - s); c.set(d.subarray(s, e)); return c; }

  function concat(a, b) { var c = new Uint8Array(a.length + b.length); c.set(a, 0); c.set(b, a.length); return c; }

  // UTF-8 bytes -> string (no TextDecoder on Tizen 2.4)
  function utf8(d, s, e) {
    var out = '', i = s, c, cp, parts = [];
    while (i < e) {
      c = d[i++];
      if (c < 0x80) { cp = c; }
      else if (c < 0xe0) { cp = ((c & 0x1f) << 6) | (d[i++] & 0x3f); }
      else if (c < 0xf0) { cp = ((c & 0x0f) << 12) | ((d[i++] & 0x3f) << 6) | (d[i++] & 0x3f); }
      else { cp = ((c & 0x07) << 18) | ((d[i++] & 0x3f) << 12) | ((d[i++] & 0x3f) << 6) | (d[i++] & 0x3f); }
      if (cp > 0xffff) { cp -= 0x10000; out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); }
      else { out += String.fromCharCode(cp); }
      if (out.length > 4096) { parts.push(out); out = ''; }
    }
    parts.push(out);
    return parts.join('');
  }

  function unescapeXml(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e.charAt(0) === '#') { return String.fromCharCode(e.charAt(1) === 'x' ? parseInt(e.substring(2), 16) : parseInt(e.substring(1), 10)); }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }[e];
    });
  }

  // "20261124233900 +0000" -> seconds since the epoch
  function xmltvTime(s) {
    var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s*([+-])?(\d\d)?(\d\d)?/.exec(s);
    if (!m) { return NaN; }
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
    if (m[7]) { t -= (m[7] === '-' ? -1 : 1) * ((+m[8]) * 3600 + (+m[9]) * 60); }
    return t;
  }

  function attr(h, name) { var m = new RegExp(name + '="([^"]*)"').exec(h); return m ? m[1] : ''; }
  function tag(body, name) {
    var m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>').exec(body);
    return m ? unescapeXml(m[1]).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') : '';
  }

  /* opts: { wanted: {tvgId: true}, from: sec, to: sec, descMax: chars } */
  function Parser(opts) {
    this.wanted = opts.wanted || {};
    this.from = opts.from; this.to = opts.to;
    this.descMax = opts.descMax || 300;
    this.items = {}; this.carry = null;
    this.seen = 0; this.kept = 0;
  }

  Parser.prototype.push = function (chunk) {
    var d = this.carry ? concat(this.carry, chunk) : chunk, pos = 0, s, e;
    this.carry = null;
    for (;;) {
      s = find(d, OPEN, pos, d.length);
      if (s < 0) {                                       // keep a tail that may start "<programme "
        var keep = Math.max(pos, d.length - OPEN.length + 1);
        if (keep < d.length) { this.carry = copy(d, keep, d.length); }
        return;
      }
      e = find(d, CLOSE, s, d.length);
      if (e < 0) { this.carry = copy(d, s, d.length); return; }
      this.block(d, s, e + CLOSE.length);
      pos = e + CLOSE.length;
    }
  };

  Parser.prototype.block = function (d, s, e) {
    var h = s, header = '', ch, start, stop, body, desc;
    while (h < e && d[h] !== 0x3e) { h++; }                // end of the opening tag
    for (var i = s; i < h; i++) { header += String.fromCharCode(d[i]); }
    this.seen++;
    ch = attr(header, 'channel');
    if (!this.wanted[ch]) { return; }
    start = xmltvTime(attr(header, 'start')); stop = xmltvTime(attr(header, 'stop'));
    if (isNaN(start) || isNaN(stop) || stop <= this.from || start >= this.to) { return; }
    body = utf8(d, h + 1, e);
    desc = tag(body, 'desc');
    if (desc.length > this.descMax) { desc = desc.substring(0, this.descMax - 1).replace(/\s+\S*$/, '') + '…'; }
    (this.items[ch] || (this.items[ch] = [])).push([start, stop, tag(body, 'title'), desc]);
    this.kept++;
  };

  Parser.prototype.finish = function () {
    var k;
    for (k in this.items) {
      if (this.items.hasOwnProperty(k)) { this.items[k].sort(function (a, b) { return a[0] - b[0]; }); }
    }
    return this.items;
  };

  var EPGParse = { Parser: Parser, xmltvTime: xmltvTime, utf8: utf8 };
  if (typeof module !== 'undefined' && module.exports) { module.exports = EPGParse; } else { global.EPGParse = EPGParse; }
}(this));
