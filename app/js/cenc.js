/* Software CENC decryption for ClearKey DASH (ES5).

   Tizen 2.4 can't decrypt ClearKey itself: its prefixed EME accepts keys but hands
   encrypted samples to the decoder anyway (media error 3). The 'cenc' scheme is
   AES-128-CTR, though, and the playlist gives the keys, so segments are decrypted
   here before they reach Media Source Extensions:

   - init segment: record each track's default KID and IV size (tenc), then make the
     track look unencrypted: sample entry encv/enca -> original format (frma), and
     sinf / pssh boxes renamed to 'free' (same size, so no offsets change);
   - media segment: for every sample, AES-CTR-decrypt the encrypted ranges given by
     senc (whole sample, or subsamples), in place; senc/saiz/saio and the pssh boxes
     some packagers repeat in every moof -> 'free'.

   Only the 'cenc' scheme (AES-CTR) is handled; 'cbcs' (AES-CBC pattern) is not. */
(function (global) {
  'use strict';

  /* ---------- AES-128 (encryption only; CTR needs nothing else) ---------- */
  var SBOX = new Uint8Array(256), T0 = new Uint32Array(256), T1 = new Uint32Array(256),
    T2 = new Uint32Array(256), T3 = new Uint32Array(256);

  (function initTables() {
    var p = 1, q = 1, x, s, i, m2, m3;
    function xt(b) { return ((b << 1) ^ ((b & 0x80) ? 0x1b : 0)) & 0xff; }
    // S-box from the multiplicative inverse (p * q = 1 in GF(2^8)) plus the affine map
    do {
      p = p ^ xt(p);                                   // p *= 3
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) { q ^= 0x09; }  // q /= 3
      x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
      SBOX[p] = (x ^ 0x63) & 0xff;
    } while (p !== 1);
    SBOX[0] = 0x63;
    for (i = 0; i < 256; i++) {
      s = SBOX[i]; m2 = xt(s); m3 = m2 ^ s;
      T0[i] = ((m2 << 24) | (s << 16) | (s << 8) | m3) >>> 0;
      T1[i] = ((m3 << 24) | (m2 << 16) | (s << 8) | s) >>> 0;
      T2[i] = ((s << 24) | (m3 << 16) | (m2 << 8) | s) >>> 0;
      T3[i] = ((s << 24) | (s << 16) | (m3 << 8) | m2) >>> 0;
    }
  }());

  function expandKey(key) {                            // 16 bytes -> 44 words
    var w = new Uint32Array(44), i, t, rcon = 1;
    for (i = 0; i < 4; i++) { w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0; }
    for (i = 4; i < 44; i++) {
      t = w[i - 1];
      if (i % 4 === 0) {
        t = ((SBOX[(t >>> 16) & 0xff] << 24) | (SBOX[(t >>> 8) & 0xff] << 16) | (SBOX[t & 0xff] << 8) | SBOX[t >>> 24]) ^ (rcon << 24);
        rcon = ((rcon << 1) ^ ((rcon & 0x80) ? 0x1b : 0)) & 0xff;
      }
      w[i] = (w[i - 4] ^ t) >>> 0;
    }
    return w;
  }

  // Encrypt the 4-word block `inp` into `out` (both Uint32Array(4)).
  function encryptBlock(w, inp, out) {
    var s0 = inp[0] ^ w[0], s1 = inp[1] ^ w[1], s2 = inp[2] ^ w[2], s3 = inp[3] ^ w[3], t0, t1, t2, t3, r, k = 4;
    for (r = 1; r < 10; r++) {
      t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 0xff] ^ T2[(s2 >>> 8) & 0xff] ^ T3[s3 & 0xff] ^ w[k];
      t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 0xff] ^ T2[(s3 >>> 8) & 0xff] ^ T3[s0 & 0xff] ^ w[k + 1];
      t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 0xff] ^ T2[(s0 >>> 8) & 0xff] ^ T3[s1 & 0xff] ^ w[k + 2];
      t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 0xff] ^ T2[(s1 >>> 8) & 0xff] ^ T3[s2 & 0xff] ^ w[k + 3];
      s0 = t0; s1 = t1; s2 = t2; s3 = t3; k += 4;
    }
    out[0] = ((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 0xff] << 16) | (SBOX[(s2 >>> 8) & 0xff] << 8) | SBOX[s3 & 0xff]) ^ w[40];
    out[1] = ((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 0xff] << 16) | (SBOX[(s3 >>> 8) & 0xff] << 8) | SBOX[s0 & 0xff]) ^ w[41];
    out[2] = ((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 0xff] << 16) | (SBOX[(s0 >>> 8) & 0xff] << 8) | SBOX[s1 & 0xff]) ^ w[42];
    out[3] = ((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 0xff] << 16) | (SBOX[(s1 >>> 8) & 0xff] << 8) | SBOX[s2 & 0xff]) ^ w[43];
  }

  /* AES-CTR keystream that continues across calls (one per sample). */
  function Ctr(w, iv) {                                // iv: 8 or 16 bytes
    var c = new Uint32Array(4), i;
    for (i = 0; i < 4; i++) {
      c[i] = 4 * i + 3 < iv.length ? ((iv[4 * i] << 24) | (iv[4 * i + 1] << 16) | (iv[4 * i + 2] << 8) | iv[4 * i + 3]) >>> 0 : 0;
    }
    this.w = w; this.c = c; this.ks = new Uint32Array(4); this.kb = new Uint8Array(16); this.pos = 16;
  }
  Ctr.prototype.xor = function (buf, start, len) {
    var end = start + len, i, j, c = this.c, kb = this.kb, ks = this.ks;
    for (i = start; i < end; i++) {
      if (this.pos === 16) {
        encryptBlock(this.w, c, ks);
        for (j = 0; j < 4; j++) { kb[4 * j] = ks[j] >>> 24; kb[4 * j + 1] = (ks[j] >>> 16) & 0xff; kb[4 * j + 2] = (ks[j] >>> 8) & 0xff; kb[4 * j + 3] = ks[j] & 0xff; }
        // 128-bit big-endian increment
        for (j = 3; j >= 0; j--) { c[j] = (c[j] + 1) >>> 0; if (c[j] !== 0) { break; } }
        this.pos = 0;
      }
      buf[i] ^= kb[this.pos++];
    }
  };

  /* ---------- ISO BMFF helpers ---------- */
  function u32(d, o) { return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0; }
  function type(d, o) { return String.fromCharCode(d[o + 4], d[o + 5], d[o + 6], d[o + 7]); }
  function setType(d, o, t) { for (var i = 0; i < 4; i++) { d[o + 4 + i] = t.charCodeAt(i); } }
  function hexOf(d, o, n) { var s = '', i; for (i = 0; i < n; i++) { s += (d[o + i] < 16 ? '0' : '') + d[o + i].toString(16); } return s; }
  function bytes(h) { var a = new Uint8Array(h.length / 2), i; for (i = 0; i < a.length; i++) { a[i] = parseInt(h.substr(2 * i, 2), 16); } return a; }

  // Child boxes of [start, end): [{type, start, size, body}] (body = after header)
  function boxes(d, start, end) {
    var out = [], o = start, size, hdr;
    while (o + 8 <= end) {
      size = u32(d, o); hdr = 8;
      if (size === 1) { size = u32(d, o + 12); hdr = 16; }   // 64-bit size: segments are small, low word is enough
      else if (size === 0) { size = end - o; }
      if (size < hdr || o + size > end) { break; }
      out.push({ type: type(d, o), start: o, size: size, body: o + hdr });
      o += size;
    }
    return out;
  }
  function child(list, t) { for (var i = 0; i < list.length; i++) { if (list[i].type === t) { return list[i]; } } return null; }
  function kids(d, b, skip) { return boxes(d, b.body + (skip || 0), b.start + b.size); }

  // Sample entries: children start after the fixed fields of a visual/audio entry
  var ENTRY_SKIP = { encv: 78, enca: 28 };

  /* ---------- decryptor ---------- */
  function Decryptor(keyList) {                        // "kid:key[,kid:key...]" hex
    this.keys = {};                                     // kid -> expanded key
    this.tracks = {};                                   // track_ID -> {kid, ivSize}
    this.lastTrack = null;
    var pairs = String(keyList || '').split(','), i, kv;
    for (i = 0; i < pairs.length; i++) {
      kv = pairs[i].replace(/[\s-]/g, '').split(':');
      if (kv.length === 2 && kv[0].length === 32 && kv[1].length === 32) { this.keys[kv[0].toLowerCase()] = expandKey(bytes(kv[1])); }
    }
    this.firstKey = null;
    for (var k in this.keys) { if (this.keys.hasOwnProperty(k)) { this.firstKey = this.keys[k]; break; } }
  }

  Decryptor.prototype.hasKeys = function () { return !!this.firstKey; };

  /* Rewrite an init segment in place; returns true if it was encrypted. */
  Decryptor.prototype.processInit = function (d) {
    var top = boxes(d, 0, d.length), moov = child(top, 'moov'), self = this, found = false, i;
    if (!moov) { return false; }
    var mv = kids(d, moov);
    for (i = 0; i < mv.length; i++) { if (mv[i].type === 'pssh') { setType(d, mv[i].start, 'free'); } }
    mv.forEach(function (trak) {
      if (trak.type !== 'trak') { return; }
      var tk = kids(d, trak), tkhd = child(tk, 'tkhd'), trackId = 0;
      if (tkhd) { trackId = u32(d, tkhd.body + (d[tkhd.body] === 1 ? 20 : 12)); }
      var mdia = child(tk, 'mdia'), minf = mdia && child(kids(d, mdia), 'minf');
      var stbl = minf && child(kids(d, minf), 'stbl'), stsd = stbl && child(kids(d, stbl), 'stsd');
      if (!stsd) { return; }
      kids(d, stsd, 8).forEach(function (entry) {      // stsd: version/flags + entry_count
        if (!ENTRY_SKIP[entry.type]) { return; }
        var inner = kids(d, entry, ENTRY_SKIP[entry.type]), sinf = child(inner, 'sinf');
        if (!sinf) { return; }
        var sk = kids(d, sinf), frma = child(sk, 'frma'), schm = child(sk, 'schm'), schi = child(sk, 'schi');
        var tenc = schi && child(kids(d, schi), 'tenc');
        if (schm && type(d, schm.body) !== 'cenc') {
          throw new Error('Unsupported encryption scheme ' + type(d, schm.body));
        }
        if (tenc) {
          // tenc: version/flags(4) reserved(1) reserved/pattern(1) isProtected(1) ivSize(1) KID(16)
          self.tracks[trackId] = { kid: hexOf(d, tenc.body + 8, 16), ivSize: d[tenc.body + 7] };
          self.lastTrack = self.tracks[trackId];
        }
        if (frma) { setType(d, entry.start, String.fromCharCode(d[frma.body], d[frma.body + 1], d[frma.body + 2], d[frma.body + 3])); }
        setType(d, sinf.start, 'free');
        found = true;
      });
    });
    return found;
  };

  /* Decrypt a media segment in place. */
  Decryptor.prototype.processMedia = function (d) {
    var top = boxes(d, 0, d.length), i, self = this;
    for (i = 0; i < top.length; i++) {
      if (top[i].type !== 'moof') { continue; }
      var moof = top[i];
      kids(d, moof).forEach(function (b) {
        if (b.type === 'pssh') { setType(d, b.start, 'free'); }   // else the browser reports encrypted content
        else if (b.type === 'traf') { self.decryptTraf(d, moof, b); }
      });
    }
  };

  Decryptor.prototype.decryptTraf = function (d, moof, traf) {
    var tb = kids(d, traf), tfhd = child(tb, 'tfhd'), trun = child(tb, 'trun'), senc = child(tb, 'senc'), i;
    if (!tfhd || !trun || !senc) { return; }
    var tf = u32(d, tfhd.body) & 0xffffff, trackId = u32(d, tfhd.body + 4), p = tfhd.body + 8;
    var base = moof.start, defSize = 0;
    if (tf & 0x01) { base = u32(d, p + 4); p += 8; }   // base_data_offset (low 32 bits)
    if (tf & 0x02) { p += 4; }
    if (tf & 0x08) { p += 4; }
    if (tf & 0x10) { defSize = u32(d, p); p += 4; }
    var track = this.tracks[trackId] || this.lastTrack || { kid: null, ivSize: 8 };
    var key = (track.kid && this.keys[track.kid]) || this.firstKey;
    if (!key) { throw new Error('No key for KID ' + track.kid); }

    // trun: sample sizes and data offset
    var rf = u32(d, trun.body) & 0xffffff, count = u32(d, trun.body + 4), q = trun.body + 8, dataOff = 0, sizes = [];
    if (rf & 0x01) { dataOff = u32(d, q) | 0; q += 4; }
    if (rf & 0x04) { q += 4; }
    for (i = 0; i < count; i++) {
      if (rf & 0x100) { q += 4; }
      if (rf & 0x200) { sizes.push(u32(d, q)); q += 4; } else { sizes.push(defSize); }
      if (rf & 0x400) { q += 4; }
      if (rf & 0x800) { q += 4; }
    }

    // senc: per-sample IV and optional subsample map
    var sf = u32(d, senc.body) & 0xffffff, n = u32(d, senc.body + 4), s = senc.body + 8;
    var ivSize = track.ivSize || 8, off = base + dataOff, sample, ctr, sub, clear, enc, j, pos;
    for (sample = 0; sample < n && sample < sizes.length; sample++) {
      ctr = new Ctr(key, d.subarray(s, s + ivSize)); s += ivSize;
      if (sf & 0x02) {
        sub = (d[s] << 8) | d[s + 1]; s += 2; pos = off;
        for (j = 0; j < sub; j++) {
          clear = (d[s] << 8) | d[s + 1]; enc = u32(d, s + 2); s += 6;
          pos += clear; ctr.xor(d, pos, enc); pos += enc;
        }
      } else {
        ctr.xor(d, off, sizes[sample]);
      }
      off += sizes[sample];
    }
    setType(d, senc.start, 'free');
    var saiz = child(tb, 'saiz'), saio = child(tb, 'saio');
    if (saiz) { setType(d, saiz.start, 'free'); }
    if (saio) { setType(d, saio.start, 'free'); }
  };

  /* Process any segment (init or media); `buf` is an ArrayBuffer, changed in place. */
  Decryptor.prototype.process = function (buf) {
    var d = new Uint8Array(buf), top = boxes(d, 0, d.length);
    if (child(top, 'moov')) { this.processInit(d); }
    else if (child(top, 'moof')) { this.processMedia(d); }
    return buf;
  };

  /* baseMediaDecodeTime of a media segment's first track fragment, or null. */
  function tfdt(buf) {
    var d = new Uint8Array(buf), moof = child(boxes(d, 0, d.length), 'moof'), traf, t;
    traf = moof && child(kids(d, moof), 'traf');
    t = traf && child(kids(d, traf), 'tfdt');
    if (!t) { return null; }
    return d[t.body] === 1 ? u32(d, t.body + 4) * 4294967296 + u32(d, t.body + 8) : u32(d, t.body + 4);
  }

  var CENC = { Decryptor: Decryptor, tfdt: tfdt, _aes: { expandKey: expandKey, encryptBlock: encryptBlock, Ctr: Ctr } };
  if (typeof module !== 'undefined' && module.exports) { module.exports = CENC; } else { global.CENC = CENC; }
}(this));
