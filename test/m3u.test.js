var assert = require('assert'), fs = require('fs'), M3U = require('../app/js/m3u.js');
var t = M3U.parse('﻿#EXTM3U url-tvg="http://e/pg.xml"\r\n# comment\r\n' +
  '#EXTINF:-1 group-title="TV" tvg-id="A.pt" tvg-logo="http://l/a,b.png",RTP 1, HD\r\n' +
  '#EXTVLCOPT:http-user-agent="UA/1"\n#EXTVLCOPT:http-referrer=https://r/\n#EXTVLCOPT:http-origin=https://o\nhttp://s/1.m3u8\n\n' +
  '#EXTINF:-1 radio="true" group-title="Rádios",Antena 1\n#https://commented/out.m3u8\nhttp://s/2.mp3\n' +
  '#EXTINF:-1,NoGroup\n#EXTGRP:News\n#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey\n#KODIPROP:inputstream.adaptive.license_key=aa:bb\nhttp://s/3.mpd\n' +
  'http://bare/url\n');
assert.strictEqual(t.epg, 'http://e/pg.xml');
assert.strictEqual(t.channels.length, 4);
var a = t.channels[0];
assert.strictEqual(a.name, 'RTP 1, HD'); assert.strictEqual(a.logo, 'http://l/a,b.png');
assert.strictEqual(a.ua, 'UA/1'); assert.strictEqual(a.referrer, 'https://r/'); assert.strictEqual(a.origin, 'https://o');
assert.strictEqual(t.channels[1].radio, true); assert.strictEqual(t.channels[1].url, 'http://s/2.mp3');
assert.strictEqual(t.channels[2].group, 'News'); assert.strictEqual(t.channels[2].drmType, 'org.w3.clearkey'); assert.strictEqual(t.channels[2].drmKey, 'aa:bb');
assert.strictEqual(t.channels[3].group, 'Other'); assert.strictEqual(t.channels[3].num, 4);
assert.deepStrictEqual(t.groups, ['TV', 'Rádios', 'News', 'Other']);
var real = M3U.parse(fs.readFileSync(__dirname + '/../app/data/M3UPT.m3u', 'utf8'));
// entries whose URL line is commented out (disabled upstream) must be skipped
var extinf = 0, open = false;
fs.readFileSync(__dirname + '/../app/data/M3UPT.m3u', 'utf8').split(/\r?\n/).forEach(function (l) {
  l = l.trim(); if (/^#EXTINF/.test(l)) { open = true; } else if (l && l[0] !== '#' && open) { extinf++; open = false; }
});
assert.strictEqual(real.channels.length, extinf);
real.channels.forEach(function (c) { assert(/^https?:\/\//.test(c.url), c.name + ' ' + c.url); assert(c.name); });
console.log('parser OK: ' + real.channels.length + ' channels, groups: ' + real.groups.join(', '));
