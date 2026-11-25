// EPG parser: synthetic XMLTV -> gzip -> pako (streamed in tiny chunks) -> Parser.
var assert = require('assert'), zlib = require('zlib'), P = require('../app/js/epg-parse.js'), pako = require('../app/js/vendor/pako_inflate.min.js');
function prog(ch, start, stop, title, desc) {
  return '<programme start="' + start + '" stop="' + stop + '" channel="' + ch + '"><title lang="pt">' + title + '</title>' +
    (desc ? '<desc lang="pt">' + desc + '</desc>' : '') + '</programme>\n';
}
var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n<channel id="A.pt"><display-name>A</display-name></channel>\n' +
  prog('A.pt', '20261125100000 +0000', '20261125110000 +0000', 'Notícias &amp; Desporto', 'Açores, Madeira — 🎬 resumo') +
  prog('A.pt', '20261125120000 +0100', '20261125130000 +0100', 'Offset +0100', '') +             // = 11:00-12:00 UTC
  prog('B.pt', '20261125100000 +0000', '20261125110000 +0000', 'Not wanted', '') +
  prog('A.pt', '20261126100000 +0000', '20261126110000 +0000', 'Outside window', '') +
  prog('A.pt', '20261125120000 +0000', '20261125130000 +0000', 'Long', new Array(80).join('palavra ')) +
  '</tv>\n';
var gz = new Uint8Array(zlib.gzipSync(Buffer.from(xml, 'utf8')));
var from = Date.UTC(2026, 10, 25, 9, 0, 0) / 1000, to = Date.UTC(2026, 10, 25, 14, 0, 0) / 1000;
var p = new P.Parser({ wanted: { 'A.pt': true }, from: from, to: to, descMax: 60 }), inf = new pako.Inflate({ chunkSize: 7 });
inf.onData = function (c) { p.push(c); };
for (var i = 0; i < gz.length; i += 5) { inf.push(gz.subarray(i, Math.min(i + 5, gz.length)), i + 5 >= gz.length); }
assert(!inf.err, inf.msg);
var items = p.finish(), a = items['A.pt'];
assert.deepStrictEqual(Object.keys(items), ['A.pt']);
assert.strictEqual(p.seen, 5); assert.strictEqual(p.kept, 3);
assert.strictEqual(a[0][2], 'Notícias & Desporto');
assert.strictEqual(a[0][3], 'Açores, Madeira — 🎬 resumo');
assert.strictEqual(a[1][0], Date.UTC(2026, 10, 25, 11, 0, 0) / 1000);  // +0100 handled
assert(a[2][3].length <= 60 && /…$/.test(a[2][3]), 'description trimmed: ' + a[2][3]);
console.log('epg OK: streamed gzip, chunk-split UTF-8/entities, window, channels, tz offsets, trimming');
