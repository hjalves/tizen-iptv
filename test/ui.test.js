// Headless UI walk-through with a recording AVPlay mock. Screenshots → test/shots/
var pw = require('playwright-core'), http = require('http'), fs = require('fs'), path = require('path');
var root = path.join(__dirname, '../app'), shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
var srv = http.createServer(function (q, r) {
  var f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (q.url.indexOf('$WEBAPIS') >= 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.end(fs.readFileSync(f));
}).listen(8765);
var MOCK = function () {
  var st = 'NONE', L = null; window.__av = [];
  function log(n, a) { window.__av.push(n + (a && a.length ? ' ' + JSON.stringify([].slice.call(a)) : '')); }
  window.webapis = { avplay: {
    getState: function () { return st; },
    open: function (u) { log('open', arguments); st = 'IDLE'; },
    setListener: function (l) { L = l; log('setListener'); },
    setDisplayRect: function () { log('setDisplayRect', arguments); },
    setDisplayMethod: function () { log('setDisplayMethod', arguments); },
    setStreamingProperty: function () { log('setStreamingProperty', arguments); },
    prepareAsync: function (ok, err) { log('prepareAsync'); setTimeout(function () {
      if (/fail/.test(window.__failNext || '')) { window.__failNext = ''; err({ name: 'PLAYER_ERROR_CONNECTION_FAILED' }); } else { st = 'READY'; ok(); } }, 300); },
    play: function () { log('play'); st = 'PLAYING'; }, pause: function () { log('pause'); st = 'PAUSED'; },
    stop: function () { log('stop'); st = 'IDLE'; }, close: function () { log('close'); st = 'NONE'; }
  } };
};
(async function () {
  var b = await pw.chromium.launch({ executablePath: '/usr/bin/chromium' });
  var p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  var errors = []; p.on('pageerror', function (e) { errors.push(e.message); });
  await p.addInitScript(MOCK);
  await p.goto('http://127.0.0.1:8765/index.html');
  await p.waitForFunction(function () { return App._state().all.length > 0; }, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  var s = await p.evaluate(function () { var s = App._state(); return { n: s.all.length, groups: s.groups.map(function (g) { return g.name + ':' + g.items.length; }), status: document.getElementById('status').textContent }; });
  console.log(JSON.stringify(s));
  await p.screenshot({ path: shots + '/1-browser.png' });
  var key = async function (k, n) { for (var i = 0; i < (n || 1); i++) { await p.keyboard.press(k); await p.waitForTimeout(120); } };
  await key('ArrowDown', 3); await key('Enter'); await p.waitForTimeout(800);       // RTP Notícias? -> fullscreen
  await p.screenshot({ path: shots + '/2-fullscreen.png' });
  await key('PageUp'); await p.waitForTimeout(1200);                                // zap: CH+ → next channel
  var afterZap = await p.evaluate(function () { return App._state().playing.num; });
  if (afterZap !== 5) { throw new Error('CH+ from channel 4 should play channel 5, got ' + afterZap); }
  console.log('CH+ from 4 -> ' + afterZap);
  await key('Escape'); await p.waitForTimeout(500);                                 // back to list, still playing
  await p.screenshot({ path: shots + '/3-preview.png' });
  await key('r'); await key('ArrowLeft'); await key('ArrowUp', 1); await p.waitForTimeout(400); // fav, go to group list → Favourites
  await key('ArrowUp', 1); await p.waitForTimeout(300);
  await p.screenshot({ path: shots + '/4-favs.png' });
  await key('ArrowDown', 3); await key('ArrowRight'); await p.waitForTimeout(800);   // Beachcam group
  await p.screenshot({ path: shots + '/5-group.png' });
  await p.evaluate(function () { window.__failNext = 'fail'; });
  await key('Enter'); await p.waitForTimeout(1200);
  await p.screenshot({ path: shots + '/6-error.png' });
  var fb = await p.evaluate(function () { return { active: Player.active(), src: document.getElementById('html5-player').getAttribute('src'), hosts: JSON.parse(localStorage.getItem('noavhosts') || '{}') }; });
  if (fb.active !== 'html5' || !fb.src || !fb.hosts['streaming-live.rtp.pt']) { throw new Error('AVPlay connection failure did not fall back to HTML5: ' + JSON.stringify(fb)); }
  console.log('fallback to HTML5 OK: ' + fb.src);
  await key('Escape'); await key('1'); await key('0'); await key('0'); await p.waitForTimeout(2200);
  await p.screenshot({ path: shots + '/7-number.png' });
  var ev = await p.evaluate(function () { var s = App._state(); return { sel: s.groups[s.gSel].name + '#' + (s.cSel + 1), av: window.__av }; });
  console.log('cursor after "100":', ev.sel);
  console.log(ev.av.join('\n'));
  console.log('page errors:', errors.length ? errors : 'none');
  await b.close(); srv.close();
})().catch(function (e) { console.error(e); process.exit(1); });
