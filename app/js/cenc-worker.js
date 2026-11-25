/* Web Worker: decrypts CENC segments off the UI thread (see cenc.js).
   In:  { id, keys, buf }  (buf transferred)   Out: { id, buf } or { id, error } */
importScripts('cenc.js');
var decryptors = {};
self.onmessage = function (ev) {
  var m = ev.data, d;
  try {
    d = decryptors[m.keys] || (decryptors[m.keys] = new self.CENC.Decryptor(m.keys));
    d.process(m.buf);
    self.postMessage({ id: m.id, buf: m.buf }, [m.buf]);
  } catch (e) {
    self.postMessage({ id: m.id, error: String(e && e.message || e) });
  }
};
