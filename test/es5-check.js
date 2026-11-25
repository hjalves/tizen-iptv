// Fails if any app script uses syntax newer than ES5 or a known-missing API.
var acorn = require('acorn'), fs = require('fs'), path = require('path');
var dir = path.join(__dirname, '../app/js'), bad = 0;
var banned = /\b(Promise|fetch|Object\.assign|Array\.from|\.includes\(|\.startsWith\(|\.endsWith\(|\.find\(|\.findIndex\(|classList|requestIdleCallback|IntersectionObserver|Symbol|Map\(|Set\()/;
// Third-party code in vendor/ must still be ES5 syntax, but isn't held to the API ban list.
var vdir = path.join(dir, 'vendor');
if (fs.existsSync(vdir)) {
  fs.readdirSync(vdir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
    try { acorn.parse(fs.readFileSync(path.join(vdir, f), 'utf8'), { ecmaVersion: 5 }); } catch (e) { bad++; console.log('vendor/' + f + ': ' + e.message); }
  });
}
fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
  var src = fs.readFileSync(path.join(dir, f), 'utf8');
  try { acorn.parse(src, { ecmaVersion: 5 }); } catch (e) { bad++; console.log(f + ': ' + e.message); }
  src.split('\n').forEach(function (l, i) { if (/^\s*(\/\*|\*|\/\/)/.test(l)) { return; } if (/es5-ok/.test(l)) { return; } var m = banned.exec(l); if (m) { bad++; console.log(f + ':' + (i + 1) + ' uses ' + m[1]); } });
});
console.log(bad ? 'FAIL' : 'ES5 OK'); process.exit(bad ? 1 : 0);
