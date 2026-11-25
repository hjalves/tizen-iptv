// Online end-to-end check: the live, ClearKey-encrypted RTP 1 DASH stream must play through
// Shaka + cenc.js in desktop Chromium (no AVPlay, no EME). Needs network access to rtp.pt.
var pw = require('playwright-core'), http = require('http'), fs = require('fs'), path = require('path');
var root = path.join(__dirname, '../app');
var srv = http.createServer(function (q, r) {
  var f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (q.url.indexOf('$WEBAPIS') >= 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  var types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.m3u': 'text/plain; charset=utf-8' };
  r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });   // workers need a JS MIME type
  r.end(fs.readFileSync(f));
}).listen(8767);
(async function () {
  // --disable-web-security: the TV widget's <access origin="*"> bypasses CORS too
  var b = await pw.chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--disable-web-security'] });
  // RTP answers 204 (empty) to some user agents, e.g. HeadlessChrome; send the TV's.
  var p = await b.newPage({ viewport: { width: 1920, height: 1080 }, userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1' });
  var errors = []; p.on('pageerror', function (e) { errors.push(e.message); });
  p.on('response', function (r) { if (/rtp\.pt/.test(r.url()) && /mpd/.test(r.url())) { errors.push('MPD ' + r.status() + ' ' + (r.headers()['content-length'] || '?') + 'B'); } if (r.status() >= 400) { errors.push('HTTP ' + r.status() + ' ' + r.url().replace(/^https?:\/\/[^\/]+/, '').substring(0, 110)); } });
  p.on('console', function (m) { if (m.type() === 'error' || m.type() === 'warning') { errors.push(m.type() + ': ' + m.text().substring(0, 160)); } });
  await p.goto('http://127.0.0.1:8767/index.html');
  await p.waitForFunction(function () { return window.App && App._state().all.length > 0; }, null, { timeout: 30000 });
  var mse = await p.evaluate(function () { return MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d401f"'); });
  if (!mse) { console.log('SKIP: this Chromium has no H.264 in MSE'); await b.close(); srv.close(); return; }
  await p.evaluate(function () {
    Player.play({ name: 'RTP 1 test', group: 'TV', key: 'test', num: 0,
      url: 'https://streaming-live.rtp.pt/liverepeater/rtpClean1HD.smil/manifest.mpd',
      drmType: 'org.w3.clearkey', drmKey: 'f80351a117ba3f17a26e0e8cd4dc00c4:a2226def4bc8f249de2daf36b7c12b1e' });
  });
  await p.waitForTimeout(15000);
  var a = await p.evaluate(function () { var v = document.getElementById('html5-player'); return { t: v.currentTime, w: v.videoWidth, state: Player.state(), engine: Player.active() }; });
  await p.waitForTimeout(5000);
  var z = await p.evaluate(function () { var v = document.getElementById('html5-player'); return { t: v.currentTime, err: v.error && v.error.code }; });
  var msg = await p.evaluate(function () { return Player.lastError(); });
  console.log('message:', msg, '| log:', errors.slice(0, 6).join(' || '));
  console.log('media time', Math.round(z.t), 's (must stay far below 2^31 ms = 2147483 s)');
  console.log(JSON.stringify({ engine: a.engine, state: a.state, width: a.w, advanced: Math.round((z.t - a.t) * 10) / 10, mediaError: z.err }));
  if (a.engine !== 'shaka' || a.state !== 'playing' || !a.w || z.t - a.t < 3) { throw new Error('ClearKey DASH did not play'); }
  if (z.t > 2147483) { throw new Error('media time not shifted: ' + z.t); }
  if (msg) { throw new Error('player reported an error during playback: ' + msg); }
  console.log('clearkey OK; page errors:', errors.length ? errors : 'none');
  await b.close(); srv.close();
})().catch(function (e) { console.error(e.message || e); process.exit(1); });
