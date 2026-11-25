/* Web Worker: inflate the gzipped XMLTV guide and keep only what the app shows.
   In:  { buf (gzip, transferred), wanted, from, to, descMax }
   Out: { items, seen, kept, ms } or { error } */
importScripts('vendor/pako_inflate.min.js', 'epg-parse.js');
self.onmessage = function (ev) {
  var m = ev.data, t0 = Date.now();
  try {
    var parser = new self.EPGParse.Parser(m), inf = new self.pako.Inflate(), data = new Uint8Array(m.buf), CH = 262144, i;
    inf.onData = function (chunk) { parser.push(chunk); };      // inflated output, chunk by chunk
    for (i = 0; i < data.length; i += CH) {
      inf.push(data.subarray(i, Math.min(i + CH, data.length)), i + CH >= data.length);
      if (inf.err) { throw new Error('gzip: ' + inf.msg); }
    }
    self.postMessage({ items: parser.finish(), seen: parser.seen, kept: parser.kept, ms: Date.now() - t0 });
  } catch (e) {
    self.postMessage({ error: String(e && e.message || e) });
  }
};
