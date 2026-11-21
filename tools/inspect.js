// Evaluate JS in the app on the TV via the WebKit inspector (debug launch: sdb shell 0 debug <appid> 300).
// usage: node tools/inspect.js '<expression>' [port] ; async results: expression may set window.__out
var expr = process.argv[2], port = process.argv[3] || 7011, wait = +(process.env.WAIT || 0);
var ws = new WebSocket('ws://192.168.0.20:' + port + '/devtools/page/1'), id = 0;
function send(m, p) { ws.send(JSON.stringify({ id: ++id, method: m, params: p || {} })); return id; }
ws.onopen = function () {
  var first = send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (!wait) { return; }
  setTimeout(function () { send('Runtime.evaluate', { expression: 'JSON.stringify(window.__out)', returnByValue: true }); }, wait);
};
ws.onmessage = function (ev) {
  var m = JSON.parse(ev.data);
  if (!m.id) { return; }
  var r = m.result && m.result.result;
  console.log(m.id + ': ' + (r ? (r.value !== undefined ? r.value : r.description) : JSON.stringify(m)));
  if (!wait || m.id === 2) { ws.close(); process.exit(0); }
};
ws.onerror = function (e) { console.error('ws error', e.message || e); process.exit(1); };
