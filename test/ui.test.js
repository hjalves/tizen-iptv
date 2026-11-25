// Headless UI walk-through with a recording AVPlay mock. Screenshots → test/shots/
var pw = require('playwright-core'), http = require('http'), fs = require('fs'), path = require('path');
var root = path.join(__dirname, '../app'), shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
var srv = http.createServer(function (q, r) {
  var f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (q.url.indexOf('$WEBAPIS') >= 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  var types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.m3u': 'text/plain; charset=utf-8' };
  r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });   // workers need a JS MIME type
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
  // Serve a small generated guide (around the current time) in place of m3upt.com/epg.
  var zlib = require('zlib');
  function xt(ms) { var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00 +0000'; }
  var nowMs = Date.now(), H = 3600000;
  var epgXml = '<?xml version="1.0" encoding="UTF-8"?><tv>' +
    '<programme start="' + xt(nowMs - 2.5 * H) + '" stop="' + xt(nowMs - 1.5 * H) + '" channel="RTP1.pt"><title>Portugal em Direto</title></programme>' +
    '<programme start="' + xt(nowMs - 1.5 * H) + '" stop="' + xt(nowMs - H / 2) + '" channel="RTP1.pt"><title>O Preço Certo</title></programme>' +
    '<programme start="' + xt(nowMs - H / 2) + '" stop="' + xt(nowMs + H / 2) + '" channel="RTP1.pt"><title>Telejornal</title><desc>Notícias do dia, com a atualidade nacional e internacional.</desc></programme>' +
    '<programme start="' + xt(nowMs + H / 2) + '" stop="' + xt(nowMs + 2 * H) + '" channel="RTP1.pt"><title>Prós e Contras</title><desc>Debate semanal sobre os temas que marcam a atualidade.</desc></programme>' +
    ['Série: A Herdade', 'Cinema: Os Gatos Não Têm Vertigens', '24 Horas', 'Televendas', 'Bom Dia Portugal', 'Jornal da Tarde'].map(function (t, i) {
      return '<programme start="' + xt(nowMs + (2 + 3 * i) * H) + '" stop="' + xt(nowMs + (5 + 3 * i) * H) + '" channel="RTP1.pt"><title>' + t + '</title></programme>'; }).join('') +
    '<programme start="' + xt(nowMs - H) + '" stop="' + xt(nowMs + H) + '" channel="TVI.pt"><title>Big Brother</title></programme></tv>';
  await p.route('https://m3upt.com/epg', async function (route) {
    await new Promise(function (r) { setTimeout(r, 2000); });     // slow enough to see the indicator
    route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'Access-Control-Allow-Origin': '*' }, body: zlib.gzipSync(Buffer.from(epgXml, 'utf8')) });
  });
  // Fake HLS masters for the HEVC check: HEVC-only, and mixed H.264 + HEVC.
  var masters = {
    'https://test.invalid/hevc/master.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="hvc1.1.6.L120.B0,mp4a.40.2"\nhd.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000,CODECS="hvc1.1.6.L63.B0,mp4a.40.2"\nsd.m3u8\n',
    'https://test.invalid/mixed/master.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="hvc1.1.6.L120.B0,mp4a.40.2"\nhevc.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="avc1.640028,mp4a.40.2"\navc-hd.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.4d401f,mp4a.40.2"\navc-sd.m3u8\n'
  };
  await p.route(/^https:\/\/test\.invalid\//, function (route) {
    var body = masters[route.request().url()];
    route.fulfill(body ? { status: 200, contentType: 'application/vnd.apple.mpegurl', headers: { 'Access-Control-Allow-Origin': '*' }, body: body } : { status: 404, body: '' });
  });
  // Serve the bundled playlist instead of the live one so counts don't change with upstream edits.
  await p.route('https://m3upt.com/iptv', function (route) {
    route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(root, 'data/M3UPT.m3u')) });
  });
  await p.goto('http://127.0.0.1:8765/index.html');
  await p.waitForFunction(function () { return App._state().all.length > 0; }, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  var s = await p.evaluate(function () { var s = App._state(); return { n: s.all.length, groups: s.groups.map(function (g) { return g.name + ':' + g.items.length; }), status: document.getElementById('status').textContent }; });
  console.log(JSON.stringify(s));
  var ind = await p.evaluate(function () { var e = document.getElementById('epg-loading'); return [e.className, e.textContent, getComputedStyle(e).display]; });
  if (ind[0].indexOf('show') < 0 || ind[1].indexOf('guide') < 0 || ind[2] === 'none') { throw new Error('guide loading indicator not shown: ' + ind); }
  await p.screenshot({ path: shots + '/0-guide-loading.png' });
  await p.waitForFunction(function () { return EPG.state() === 'ready'; }, null, { timeout: 20000 });
  var gone = await p.evaluate(function () { return getComputedStyle(document.getElementById('epg-loading')).display; });
  if (gone !== 'none') { throw new Error('guide loading indicator still shown after loading'); }
  console.log('epg indicator OK: "' + ind[1] + '" while loading, hidden after');
  await p.waitForTimeout(300);
  var g = await p.evaluate(function () { return { row: document.querySelector('#channel-rows .row .r-now').textContent,
    now: document.getElementById('e-now-title').textContent, next: document.getElementById('e-next-title').textContent,
    fill: document.getElementById('e-fill').style.width, status: document.getElementById('status').textContent }; });
  if (g.row !== 'Telejornal' || g.now !== 'Telejornal' || g.next !== 'Prós e Contras' || !/^(4\d|5\d)%$/.test(g.fill) || g.status.indexOf('guide: 2 channels') < 0) {
    throw new Error('EPG not shown as expected: ' + JSON.stringify(g)); }
  console.log('epg UI OK: ' + JSON.stringify(g));
  await p.screenshot({ path: shots + '/1-browser.png' });
  var key = async function (k, n) { for (var i = 0; i < (n || 1); i++) { await p.keyboard.press(k); await p.waitForTimeout(120); } };
  // ---- programme guide overlay (Guide key; 'e' on desktop) ----
  var gs = function () { return p.evaluate(function () { var sel = document.querySelector('#guide-rows .g-prog.sel');
    return { open: document.getElementById('guide').className.indexOf('show') >= 0, ch: document.getElementById('guide-ch').textContent,
      sel: sel && sel.querySelector('.g-title').textContent, now: !!(sel && sel.querySelector('.g-now')), title: document.getElementById('gd-title').textContent,
      empty: getComputedStyle(document.getElementById('guide-empty')).display !== 'none', days: document.querySelectorAll('#guide-rows .g-day').length }; }); };
  await key('e'); await p.waitForTimeout(300);
  var gg = await gs();
  if (!gg.open || gg.ch.indexOf('RTP 1') < 0 || gg.sel !== 'Telejornal' || !gg.now || gg.title !== 'Telejornal') { throw new Error('guide should open on RTP 1 at the current programme: ' + JSON.stringify(gg)); }
  await p.screenshot({ path: shots + '/1b-guide.png' });
  await key('ArrowDown'); gg = await gs();
  if (gg.sel !== 'Prós e Contras' || gg.title !== 'Prós e Contras') { throw new Error('Down should select the next programme: ' + JSON.stringify(gg)); }
  await key('ArrowRight'); gg = await gs();
  if (gg.ch.indexOf('RTP 2') < 0 || !gg.empty) { throw new Error('Right should show RTP 2 (no listings): ' + JSON.stringify(gg)); }
  await key('ArrowLeft'); gg = await gs();
  if (gg.ch.indexOf('RTP 1') < 0 || gg.sel !== 'Telejornal') { throw new Error('Left should go back to RTP 1: ' + JSON.stringify(gg)); }
  await key('Escape'); gg = await gs();
  if (gg.open) { throw new Error('Back should close the guide'); }
  console.log('guide overlay OK: opens on now, Down/Left/Right, empty channel, Back closes (' + gg.days + ' day headings)');
  await key('ArrowDown', 3); await key('Enter'); await p.waitForTimeout(800);       // RTP Notícias? -> fullscreen
  await p.screenshot({ path: shots + '/2-fullscreen.png' });
  var bn = await p.evaluate(function () { return [document.getElementById('banner').className, document.getElementById('b-now-title').textContent]; });
  if (bn[0].indexOf('has-epg') < 0 || bn[1] !== 'Big Brother') { throw new Error('banner without guide info: ' + bn); }
  console.log('epg banner OK: ' + bn[1]);
  // Regression: the per-minute refresh used to cancel the banner's auto-hide timer.
  await p.evaluate(function () { App._tick(); });
  await p.waitForTimeout(6500);
  var stillShown = await p.evaluate(function () { return document.getElementById('banner').className.indexOf('show') >= 0 ? Player.state() : ''; });
  if (stillShown) { throw new Error('banner should hide ~5 s after a refresh while playing (state ' + stillShown + ')'); }
  console.log('banner auto-hide OK after a minute refresh');
  await key('PageUp'); await p.waitForTimeout(1200);                                // zap: CH+ → next channel
  var afterZap = await p.evaluate(function () { return App._state().playing.num; });
  if (afterZap !== 5) { throw new Error('CH+ from channel 4 should play channel 5, got ' + afterZap); }
  console.log('CH+ from 4 -> ' + afterZap);
  await key('ArrowDown'); await p.waitForTimeout(1200);
  var afterDown = await p.evaluate(function () { return App._state().playing.num; });
  await key('ArrowUp'); await p.waitForTimeout(1200);
  var afterUp = await p.evaluate(function () { return App._state().playing.num; });
  if (afterDown !== 6 || afterUp !== 5) { throw new Error('full screen Down should go 5 -> 6 and Up back to 5, got ' + afterDown + ', ' + afterUp); }
  console.log('Down 5 -> 6, Up 6 -> 5 OK');
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
  // The mock fails the master playlist once; the app then resolves the variant through the
  // browser and AVPlay plays it from the same host, so that host must not be recorded.
  var fb = await p.evaluate(function () { return { active: Player.active(), state: Player.state(), last: window.__av.filter(function (l) { return l.indexOf('open') === 0; }).pop(), hosts: JSON.parse(localStorage.getItem('noavhosts2') || '{}') }; });
  if (fb.active !== 'avplay' || fb.state !== 'playing' || fb.last.indexOf('chunklist') < 0) { throw new Error('expected the resolved variant to play in AVPlay: ' + JSON.stringify(fb)); }
  if (fb.hosts['streaming-live.rtp.pt']) { throw new Error('host recorded although AVPlay reached it: ' + JSON.stringify(fb.hosts)); }
  console.log('fallback OK: ' + fb.last + ' (host not recorded)');
  await key('Escape'); await key('1'); await key('0'); await key('0'); await p.waitForTimeout(2200);
  await p.screenshot({ path: shots + '/7-number.png' });
  var ev = await p.evaluate(function () { var s = App._state(); return { sel: s.groups[s.gSel].name + '#' + (s.cSel + 1), av: window.__av }; });
  // ---- HEVC check ----
  var hv = await p.evaluate(function () {
    return new Promise(function (resolve) {
      var hevcCh = { name: 'HEVC test', group: 'TV', key: 'x1', num: 0, url: 'https://test.invalid/hevc/master.m3u8' };
      Player.play(hevcCh);
      setTimeout(function () {
        var r = { state: Player.state(), err: Player.lastError(), known: Player.isHevc(hevcCh) };
        window.__av.length = 0;
        Player.play({ name: 'Mixed test', group: 'TV', key: 'x2', num: 0, url: 'https://test.invalid/mixed/master.m3u8' });
        setTimeout(function () { r.mixedOpens = window.__av.filter(function (l) { return l.indexOf('open') === 0; }); r.mixedState = Player.state(); Player.stop(); resolve(r); }, 1500);
      }, 1500);
    });
  });
  if (hv.state !== 'error' || hv.err.indexOf('HEVC') < 0 || !hv.known) { throw new Error('HEVC-only channel should stop with the HEVC message: ' + JSON.stringify(hv)); }
  if (hv.mixedOpens[hv.mixedOpens.length - 1].indexOf('avc-hd.m3u8') < 0 || hv.mixedState !== 'playing') { throw new Error('mixed playlist should switch to the best H.264 variant: ' + JSON.stringify(hv)); }
  console.log('hevc OK: HEVC-only refused + remembered; mixed -> ' + hv.mixedOpens.pop());

  // ---- hidden groups ----
  var names = async function () { return p.evaluate(function () { return App._state().groups.map(function (g) { return g.name + ':' + g.items.length; }); }); };
  var g0 = await names();
  console.log('groups (defaults hide 7):', g0.join(', '));
  if (g0.join().indexOf('Eixo do Mal') >= 0 || g0.join().indexOf('Beachcam') >= 0 || g0[g0.length - 1].indexOf('Show hidden groups (7)') !== 0) { throw new Error('default hidden groups not applied'); }
  if (g0[1] !== 'All channels:244') { throw new Error('All channels should exclude hidden groups: ' + g0[1]); }
  await key('ArrowLeft'); await key('ArrowUp', 12); await key('ArrowDown', 3);              // Rádios
  await key('r'); await p.waitForTimeout(300);
  var g1 = await names();
  if (g1.join().indexOf('Rádios') >= 0 || g1[1] !== 'All channels:159') { throw new Error('hide failed: ' + g1.join()); }
  var st1 = await p.evaluate(function () { return document.getElementById('status').textContent; });
  if (st1.indexOf('159 channels · 1 group (+8 hidden)') !== 0) { throw new Error('status not updated after hiding: ' + st1); }
  await key('ArrowDown', 12); await key('Enter'); await p.waitForTimeout(300);            // show hidden
  var g2 = await names();
  await p.screenshot({ path: shots + '/8-hidden-groups.png' });
  if (g2.length !== 12 || g2[g2.length - 1].indexOf('Hide hidden groups (8)') !== 0) { throw new Error('show hidden failed: ' + g2.join()); }
  var bIdx = g2.findIndex(function (n) { return n.indexOf('Rádios') === 0; });
  await key('ArrowUp', 12); await key('ArrowDown', bIdx); await key('r'); await p.waitForTimeout(300);  // unhide Rádios
  var g3 = await names();
  if (g3[1] !== 'All channels:244') { throw new Error('unhide failed: ' + g3.join()); }
  await key('Escape'); await key('4'); await key('0'); await key('0'); await p.waitForTimeout(2200);
  var t = await p.evaluate(function () { return document.getElementById('toast').textContent; });
  if (t.indexOf('hidden group') < 0) { throw new Error('number entry into hidden group should be refused: ' + t); }
  var st2 = await p.evaluate(function () { return document.getElementById('status').textContent; });
  if (st2.indexOf('244 channels · 2 groups (+7 hidden)') !== 0) { throw new Error('status not updated: ' + st2); }
  console.log('hidden groups OK; status:', await p.evaluate(function () { return document.getElementById('status').textContent; }));
  console.log('cursor after "100":', ev.sel);
  console.log(ev.av.join('\n'));
  // ---- themes ----
  await key('ArrowRight'); await key('i'); await p.waitForTimeout(300);
  var themeIds = await p.evaluate(function () { return Themes.list.map(function (t) { return t.id; }); });
  for (var ti = 0; ti < themeIds.length; ti++) {
    if (ti) { await key('ArrowDown'); await p.waitForTimeout(250); }
    var cur = await p.evaluate(function () { return Themes.current(); });
    if (cur !== themeIds[ti]) { throw new Error('preview should apply ' + themeIds[ti] + ', got ' + cur); }
    await p.screenshot({ path: shots + '/theme-' + cur + '.png' });
  }
  await key('Escape'); await p.waitForTimeout(200);
  var back = await p.evaluate(function () { return [Themes.current(), localStorage.getItem('theme')]; });
  if (back[0] !== 'midnight' || back[1] !== null) { throw new Error('Back should restore midnight without saving: ' + back); }
  await key('i'); await key('ArrowDown'); await key('Enter'); await p.waitForTimeout(200);
  var kept = await p.evaluate(function () { return [Themes.current(), localStorage.getItem('theme')]; });
  if (kept[0] !== 'sunset' || kept[1] !== '"sunset"') { throw new Error('OK should keep sunset: ' + kept); }
  console.log('themes OK:', themeIds.join(', '));
  console.log('page errors:', errors.length ? errors : 'none');
  await b.close(); srv.close();
})().catch(function (e) { console.error(e); process.exit(1); });
