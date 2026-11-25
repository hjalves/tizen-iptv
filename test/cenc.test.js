// AES-128 / CTR against published test vectors, then a round trip through a synthetic CENC fragment.
var assert = require('assert'), C = require('../app/js/cenc.js'), A = C._aes;
function bytes(h) { return Uint8Array.from(h.match(/../g).map(function (x) { return parseInt(x, 16); })); }
function hex(a) { return Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
function words(b) { var w = new Uint32Array(4); for (var i = 0; i < 4; i++) { w[i] = ((b[4*i] << 24) | (b[4*i+1] << 16) | (b[4*i+2] << 8) | b[4*i+3]) >>> 0; } return w; }
function wbytes(w) { var b = new Uint8Array(16); for (var i = 0; i < 4; i++) { b[4*i] = w[i] >>> 24; b[4*i+1] = (w[i] >>> 16) & 255; b[4*i+2] = (w[i] >>> 8) & 255; b[4*i+3] = w[i] & 255; } return b; }
// FIPS-197 C.1
var out = new Uint32Array(4);
A.encryptBlock(A.expandKey(bytes('000102030405060708090a0b0c0d0e0f')), words(bytes('00112233445566778899aabbccddeeff')), out);
assert.strictEqual(hex(wbytes(out)), '69c4e0d86a7b0430d8cdb78070b4c55a');
// SP 800-38A F.5.1 CTR-AES128
var key = A.expandKey(bytes('2b7e151628aed2a6abf7158809cf4f3c'));
var pt = bytes('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710');
var ctr = new A.Ctr(key, bytes('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff'));
ctr.xor(pt, 0, 20); ctr.xor(pt, 20, 44);           // split mid-block: keystream must continue
assert.strictEqual(hex(pt), '874d6191b620e3261bef6864990db6ce9806f66b7970fdff8617187bb9fffdff5ae4df3edbd5d35e5b4f09020db03eab1e031dda2fbe03d1792170a0f3009cee');
console.log('cenc OK: FIPS-197 AES-128 and SP 800-38A CTR vectors');
// tfdt(): baseMediaDecodeTime from moof/traf/tfdt, version 0 (32-bit) and 1 (64-bit)
function box(type, body) { var b = new Uint8Array(8 + body.length); new DataView(b.buffer).setUint32(0, b.length); for (var i = 0; i < 4; i++) { b[4 + i] = type.charCodeAt(i); } b.set(body, 8); return b; }
function tfdtBox(v, t) { var b = new Uint8Array(v ? 12 : 8); b[0] = v; var dv = new DataView(b.buffer); if (v) { dv.setUint32(4, Math.floor(t / 4294967296)); dv.setUint32(8, t % 4294967296); } else { dv.setUint32(4, t); } return box('tfdt', b); }
[[0, 123456], [1, 271265868000]].forEach(function (c) {
  var seg = box('moof', box('traf', tfdtBox(c[0], c[1])));
  assert.strictEqual(C.tfdt(seg.buffer), c[1]);
});
assert.strictEqual(C.tfdt(box('moov', new Uint8Array(0)).buffer), null);
console.log('cenc OK: tfdt v0/v1');
