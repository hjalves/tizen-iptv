/* IPTV — main UI (ES5, Tizen 2.4). */
(function (global) {
  'use strict';

  var U = global.U, M3U = global.M3U, Player = global.Player, Themes = global.Themes, KEY = U.KEY, $ = U.$;

  var PLAYLIST_URL = 'https://raw.githubusercontent.com/LITUATUI/M3UPT/main/M3U/M3UPT.m3u';
  var BUNDLED_URL = 'data/M3UPT.m3u';
  var LOGO_PREFIX = 'https://raw.githubusercontent.com/LITUATUI/M3UPT/main/logos/';
  var GROUP_ALL = 'All channels', GROUP_FAV = 'Favourites';

  var CH_ROWS = 10, CH_ROW_H = 76, GR_ROW_H = 64;
  var PREVIEW = { x: 1260, y: 120, w: 600, h: 338 };

  /* ---------- state ---------- */
  var all = [];                 // every channel, playlist order
  var groups = [];              // [{name, items}]
  var favs = U.store.get('favs', {});
  var hidden = U.store.get('hiddenGroups', null);   // {groupName: 1}; null → defaults from settings.js
  if (!hidden) {
    hidden = {};
    var defHidden = (global.SETTINGS && global.SETTINGS.hiddenGroups) || [];
    for (var hi = 0; hi < defHidden.length; hi++) { hidden[defHidden[hi]] = 1; }
  }
  var showHidden = false;       // hidden groups listed (dimmed) so they can be unhidden
  var visible = [];             // channels not in hidden groups ("All channels", zapping)
  var gSel = 0, gTop = 0;       // group cursor
  var cSel = 0, cTop = 0;       // channel cursor in current group
  var zone = 'channels';        // 'groups' | 'channels'
  var fullscreen = false;
  var playing = null, lastPlayed = null;
  var zapList = null;           // list used for CH+/- in full screen
  var bannerTimer = null, toastTimer = null, numTimer = null, numBuf = '';
  var playState = 'stopped', playDetail = null;
  var playlistSource = '';

  var gRows = [], cRows = [];

  /* ---------- logos ---------- */
  /* The playlist's logos are bundled under logos/ (same file names as in the
     repo) so lists render fast and offline; anything else loads remotely. */
  function localLogo(url) {
    var name = url && url.indexOf(LOGO_PREFIX) === 0 ? url.substring(LOGO_PREFIX.length) : '';
    // only plain ASCII names are bundled (see tools/update-data.sh)
    return /^[A-Za-z0-9._\-]+$/.test(name) ? 'logos/' + name : '';
  }
  function setLogo(img, ch, fallbackEl) {
    var want = ch ? (localLogo(ch.logo) || ch.logo) : '';
    if (img._want === want) { return; }
    img._want = want;
    img._remote = ch ? ch.logo : '';
    img.style.display = want ? '' : 'none';
    if (fallbackEl) { fallbackEl.style.display = want ? 'none' : ''; }
    if (want) { img.src = want; } else { img.removeAttribute('src'); }
  }
  function logoError() {
    var img = this;
    if (img._remote && img.src.indexOf(img._remote) < 0 && img._want !== img._remote) {
      img._want = img._remote;                 // local copy missing → try remote
      img.src = img._remote;
      return;
    }
    img.style.display = 'none';
    if (img._fallback) { img._fallback.style.display = ''; }
  }

  /* ---------- building rows (fixed pool, reused while scrolling) ---------- */
  function buildRows() {
    var gWrap = $('group-rows'), cWrap = $('channel-rows'), i, r, img;
    for (i = 0; i < 12; i++) {
      r = document.createElement('div');
      r.className = 'row';
      r.style.top = (i * GR_ROW_H) + 'px';
      r.innerHTML = '<span class="g-name"></span><span class="g-count"></span>';
      gWrap.appendChild(r);
      gRows.push({ el: r, name: r.childNodes[0], count: r.childNodes[1] });
    }
    for (i = 0; i < CH_ROWS; i++) {
      r = document.createElement('div');
      r.className = 'row';
      r.style.top = (i * CH_ROW_H) + 'px';
      r.innerHTML = '<span class="r-num"></span><span class="r-logo"><img alt=""><span class="r-initials"></span></span>' +
        '<span class="r-name"></span><span class="r-tags"></span>';
      cWrap.appendChild(r);
      img = r.childNodes[1].childNodes[0];
      img._fallback = r.childNodes[1].childNodes[1];
      img.onerror = logoError;
      cRows.push({ el: r, num: r.childNodes[0], img: img, initials: img._fallback, name: r.childNodes[2], tags: r.childNodes[3], ch: null });
    }
    $('preview-logo').onerror = logoError;
    $('banner-img').onerror = logoError;
    $('radio-logo').onerror = logoError;
  }

  /* ---------- data ---------- */
  function rebuildGroups(keepName) {
    var byName = {}, list = [], hiddenList = [], i, ch, g, favItems = [];
    visible = [];
    for (i = 0; i < all.length; i++) {
      ch = all[i];
      if (!byName[ch.group]) {
        g = byName[ch.group] = { name: ch.group, items: [], hidden: !!hidden[ch.group] };
        (g.hidden ? hiddenList : list).push(g);
      }
      byName[ch.group].items.push(ch);
      if (!hidden[ch.group]) { visible.push(ch); }
      if (favs[ch.key]) { favItems.push(ch); }
    }
    groups = [{ name: GROUP_FAV, items: favItems, fav: true }, { name: GROUP_ALL, items: visible }].concat(list);
    if (hiddenList.length) {
      if (showHidden) { groups = groups.concat(hiddenList); }
      groups.push({ name: (showHidden ? 'Hide' : 'Show') + ' hidden groups (' + hiddenList.length + ')', items: [], toggle: true });
    }
    gSel = -1;
    for (i = 0; i < groups.length; i++) { if (groups[i].name === keepName) { gSel = i; } }
    if (gSel < 0) { gSel = favItems.length ? 0 : 1; }
  }

  function curItems() { return groups[gSel] ? groups[gSel].items : []; }

  function loadPlaylist(forceNetwork) {
    var cached = U.store.get('playlist', null);
    $('loading').className = all.length ? '' : 'show';
    U.text($('status'), 'Loading playlist…');

    function use(text, source) {
      var parsed = M3U.parse(text);
      if (!parsed.channels.length) { return false; }
      var keepGroup = groups[gSel] ? groups[gSel].name : U.store.get('group', null);
      var keepKey = curItems()[cSel] ? curItems()[cSel].key : U.store.get('last', null);
      all = parsed.channels;
      rebuildGroups(keepGroup);
      selectByKey(keepKey);
      $('loading').className = '';
      playlistSource = source;
      renderAll();
      return true;
    }

    U.get(PLAYLIST_URL, 15000, function (err, text) {
      if (!err && use(text, 'online playlist')) {
        U.store.set('playlist', { text: text, time: new Date().getTime() });
        if (forceNetwork) { toast('Playlist updated'); }
        return;
      }
      if (cached && cached.text && use(cached.text, 'saved copy from ' + fmtDate(cached.time))) {
        if (forceNetwork) { toast('Offline — using saved playlist'); }
        return;
      }
      U.get(BUNDLED_URL, 10000, function (err2, text2) {
        if (!err2 && use(text2, 'built-in copy (offline)')) { return; }
        $('loading').className = 'show';
        U.text($('loading-text'), 'Could not load the playlist. Press the green button to retry.');
      });
    });
  }

  function fmtDate(t) {
    var d = new Date(t);
    return U.pad2(d.getDate()) + '/' + U.pad2(d.getMonth() + 1) + ' ' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  }

  function selectByKey(key) {
    var items = curItems(), i;
    cSel = 0;
    for (i = 0; i < items.length; i++) { if (items[i].key === key) { cSel = i; break; } }
    clampScroll();
  }

  function clampScroll() {
    var n = curItems().length;
    if (cSel >= n) { cSel = n - 1; }
    if (cSel < 0) { cSel = 0; }
    if (cSel < cTop) { cTop = cSel; }
    if (cSel >= cTop + CH_ROWS) { cTop = cSel - CH_ROWS + 1; }
    if (cTop > n - CH_ROWS) { cTop = Math.max(0, n - CH_ROWS); }
    if (cTop < 0) { cTop = 0; }
    if (gSel < gTop) { gTop = gSel; }
    if (gSel >= gTop + gRows.length) { gTop = gSel - gRows.length + 1; }
  }

  /* ---------- rendering ---------- */
  function renderGroups() {
    var i, g, row;
    for (i = 0; i < gRows.length; i++) {
      row = gRows[i]; g = groups[gTop + i];
      row.el.style.display = g ? '' : 'none';
      if (!g) { continue; }
      U.text(row.name, (g.fav ? '★ ' : '') + g.name);
      U.text(row.count, g.toggle ? '' : (g.hidden ? 'hidden' : g.items.length));
      U.toggleClass(row.el, 'sel', gTop + i === gSel);
      U.toggleClass(row.el, 'hidden-group', !!g.hidden);
      U.toggleClass(row.el, 'toggle-row', !!g.toggle);
    }
    U.toggleClass($('groups'), 'active', zone === 'groups' && !fullscreen);
    var cg = groups[gSel] || {};
    U.text($('red-label'), zone !== 'groups' ? 'Favourite' :
      (cg.fav || cg.name === GROUP_ALL || cg.toggle ? '—' : (cg.hidden ? 'Unhide group' : 'Hide group')));
  }

  function tagsHtml(ch, big) {
    var h = '';
    if (favs[ch.key]) { h += '<span class="tag fav">★' + (big ? ' Favourite' : '') + '</span>'; }
    if (ch.radio) { h += '<span class="tag radio">' + (big ? 'Radio' : 'R') + '</span>'; }
    if (ch.drmType) {
      h += Player.canDecrypt(ch) ? '<span class="tag">' + (big ? 'ClearKey (decrypted here)' : 'CK') + '</span>' :
        '<span class="tag drm">' + (big ? 'DRM — not playable' : 'DRM') + '</span>';
    }
    if (big && /\.mpd(\?|$)/i.test(ch.url)) { h += '<span class="tag">DASH</span>'; }
    if (big && /\.m3u8(\?|$)/i.test(ch.url)) { h += '<span class="tag">HLS</span>'; }
    return h;
  }

  function renderChannels() {
    var items = curItems(), i, ch, row, n = items.length;
    U.text($('channels-title'), groups[gSel] ? groups[gSel].name : '');
    U.text($('channels-pos'), n ? (cSel + 1) + ' / ' + n : '');
    $('channels-empty').style.display = n ? 'none' : 'block';
    U.text($('channels-empty'), groups[gSel] && groups[gSel].fav ? 'No favourites yet — press the red button on a channel' :
      (groups[gSel] && groups[gSel].toggle ? 'Press OK to ' + (showHidden ? 'hide' : 'show') + ' the hidden groups' : 'No channels'));
    for (i = 0; i < cRows.length; i++) {
      row = cRows[i]; ch = items[cTop + i];
      row.el.style.display = ch ? '' : 'none';
      if (!ch) { row.ch = null; continue; }
      if (row.ch !== ch) {
        row.ch = ch;
        U.text(row.num, ch.num);
        U.text(row.name, ch.name);
        U.text(row.initials, U.initials(ch.name));
        setLogo(row.img, ch, row.initials);
      }
      row.tags.innerHTML = tagsHtml(ch, false);
      U.toggleClass(row.el, 'sel', cTop + i === cSel);
      U.toggleClass(row.el, 'playing', ch === playing);
    }
    // scrollbar
    var bar = $('scrollthumb'), track = 752;
    if (n > CH_ROWS) {
      var h = Math.max(40, Math.round(track * CH_ROWS / n));
      bar.style.display = '';
      bar.style.height = h + 'px';
      bar.style.top = Math.round((track - h) * cTop / (n - CH_ROWS)) + 'px';
    } else { bar.style.display = 'none'; }
    U.toggleClass($('channels'), 'active', zone === 'channels' && !fullscreen);
  }

  function renderDetails() {
    // Show the playing channel while it plays in the preview; otherwise the focused one.
    var focused = curItems()[cSel] || null;
    var ch = zone === 'channels' ? focused : (playing || focused);
    if (!ch) {
      U.text($('info-num'), ''); U.text($('info-name'), ''); U.text($('info-group'), '');
      $('info-tags').innerHTML = '';
      setLogo($('preview-logo'), null);
      return;
    }
    U.text($('info-num'), 'CH ' + ch.num + (ch === playing ? '  ·  ON AIR' : ''));
    U.text($('info-name'), ch.name);
    U.text($('info-group'), ch.group);
    $('info-tags').innerHTML = tagsHtml(ch, true);
    // Artwork behind the preview: the playing channel's logo (radio) or the focused one when idle.
    var art = playing ? playing : ch;
    var showArt = !playing || playing.radio || playState !== 'playing';
    setLogo($('preview-logo'), art);
    $('preview-art').style.visibility = showArt ? 'visible' : 'hidden';
    renderPlayMsg();
  }

  function stateText() {
    switch (playState) {
      case 'loading': return 'Connecting…';
      case 'buffering': return 'Buffering' + (playDetail ? ' ' + playDetail + '%' : '…');
      case 'paused': return 'Paused';
      case 'error': return playDetail || 'Stream unavailable';
      case 'ended': return 'Stream ended';
      default: return '';
    }
  }

  function renderPlayMsg() {
    var msg = playing ? stateText() : '';
    var el = $('preview-msg');
    el.style.display = msg ? 'block' : 'none';
    U.text(el, playing && msg ? playing.name + ' — ' + msg : '');
    U.text($('banner-msg'), msg);
  }

  function renderStatus() {
    if (!all.length) { return; }
    var nGroups = 0, nHidden = 0, gi, gname, seen = {};
    for (gi = 0; gi < all.length; gi++) {
      gname = all[gi].group;
      if (!seen[gname]) { seen[gname] = 1; if (hidden[gname]) { nHidden++; } else { nGroups++; } }
    }
    U.text($('status'), visible.length + ' channels · ' + nGroups + (nGroups === 1 ? ' group' : ' groups') + (nHidden ? ' (+' + nHidden + ' hidden)' : '') +
      ' · ' + playlistSource + ' · player: ' + (Player.engine === 'avplay' ? 'AVPlay' : 'HTML5'));
  }

  function renderAll() { clampScroll(); renderStatus(); renderGroups(); renderChannels(); renderDetails(); }

  /* ---------- playback / full screen ---------- */
  function onPlayerState(s, detail) {
    playState = s; playDetail = detail;
    U.toggleClass(document.body, 'playing', !!playing && (s === 'playing' || s === 'buffering' || s === 'paused'));
    if (s === 'error' && fullscreen) { showBanner(true); }
    renderDetails();
    renderChannels();
  }

  function startChannel(ch, list) {
    if (!ch) { return; }
    if (playing && playing !== ch) { lastPlayed = playing; }
    playing = ch;
    zapList = list || zapList || visible;
    U.toggleClass(document.body, 'radio', !!ch.radio);
    U.store.set('last', ch.key);
    Player.play(ch);
    renderAll();
  }

  /* While zapping quickly, update the banner at once but open the stream
     only once the key presses settle. */
  var zapTimer = null;
  function zap(delta) {
    var list = zapList || visible, idx = list.indexOf(playing), ch;
    if (!list.length) { return; }
    idx = idx < 0 ? 0 : (idx + delta + list.length) % list.length;
    ch = list[idx];
    if (playing) { lastPlayed = playing; }
    playing = ch;
    U.toggleClass(document.body, 'radio', !!ch.radio);
    Player.stop();
    playState = 'loading'; playDetail = null;
    syncCursorTo(ch);
    showBanner(true);
    clearTimeout(zapTimer);
    zapTimer = setTimeout(function () { startChannel(ch, list); showBanner(true); }, 450);
  }

  function syncCursorTo(ch) {
    var items = curItems(), i = items.indexOf(ch);
    if (i < 0) {                     // not in the visible group → jump to "All channels"
      gSel = 1; items = curItems(); i = items.indexOf(ch);
    }
    if (i >= 0) { cSel = i; }
    clampScroll();
  }

  function enterFullscreen() {
    if (!playing) { return; }
    fullscreen = true;
    U.addClass(document.body, 'fullscreen');
    Player.setRect(0, 0, 1920, 1080);
    showBanner(true);
  }

  function exitFullscreen() {
    fullscreen = false;
    U.removeClass(document.body, 'fullscreen');
    hideBanner();
    Player.setRect(PREVIEW.x, PREVIEW.y, PREVIEW.w, PREVIEW.h);
    syncCursorTo(playing);
    zone = 'channels';
    renderAll();
  }

  function stopPlayback() {
    clearTimeout(zapTimer);
    if (playing) { lastPlayed = playing; }
    playing = null;
    Player.stop();
    if (fullscreen) { exitFullscreen(); }
    U.removeClass(document.body, 'playing');
    renderAll();
  }

  function showBanner(autoHide) {
    var ch = playing;
    if (!ch) { return; }
    U.text($('banner-num'), ch.num);
    U.text($('banner-name'), ch.name);
    var list = zapList || visible, idx = list.indexOf(ch);
    U.text($('banner-sub'), ch.group + (idx >= 0 ? '   ·   ' + (idx + 1) + ' of ' + list.length : '') +
      (favs[ch.key] ? '   ·   ★' : ''));
    setLogo($('banner-img'), ch);
    setLogo($('radio-logo'), ch);
    U.text($('radio-name'), ch.radio ? ch.name : '');
    renderPlayMsg();
    $('banner').className = 'show';
    clearTimeout(bannerTimer);
    if (autoHide) {
      bannerTimer = setTimeout(function () {
        if (playState === 'loading' || playState === 'buffering' || playState === 'error') { showBanner(true); return; }
        hideBanner();
      }, 5000);
    }
  }
  function hideBanner() { clearTimeout(bannerTimer); $('banner').className = ''; }

  function toast(msg) {
    var t = $('toast');
    U.text(t, msg);
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, 2500);
  }

  /* ---------- number entry ---------- */
  function numberKey(d) {
    numBuf = (numBuf + d).substring(0, 4);
    var el = $('numentry');
    U.text(el, numBuf);
    el.style.display = 'block';
    clearTimeout(numTimer);
    numTimer = setTimeout(commitNumber, numBuf.length >= String(all.length).length ? 600 : 1800);
  }
  function commitNumber() {
    var n = parseInt(numBuf, 10), ch = all[n - 1];
    numBuf = '';
    $('numentry').style.display = 'none';
    if (!ch) { toast('No channel ' + n); return; }
    if (hidden[ch.group]) { toast('Channel ' + n + ' is in a hidden group (' + ch.group + ')'); return; }
    if (fullscreen) {
      startChannel(ch, visible);
      syncCursorTo(ch);
      showBanner(true);
    } else {
      gSel = 1; cSel = visible.indexOf(ch); zone = 'channels';
      renderAll();
    }
  }

  /* ---------- favourites ---------- */
  function toggleFav(ch) {
    if (!ch) { return; }
    var keepGroup = groups[gSel].name, keepKey = (curItems()[cSel] || {}).key;
    if (favs[ch.key]) { delete favs[ch.key]; toast('Removed from favourites'); }
    else { favs[ch.key] = 1; toast('Added to favourites'); }
    U.store.set('favs', favs);
    rebuildGroups(keepGroup);
    selectByKey(keepKey);
    renderAll();
    if (fullscreen) { showBanner(true); }
  }

  /* ---------- hidden groups ---------- */
  function toggleHidden(g) {
    if (!g || g.fav || g.toggle || g.name === GROUP_ALL) { return; }
    if (hidden[g.name]) { delete hidden[g.name]; toast('"' + g.name + '" is visible again'); }
    else { hidden[g.name] = 1; toast('"' + g.name + '" hidden'); }
    U.store.set('hiddenGroups', hidden);
    var keep = hidden[g.name] && !showHidden ? GROUP_ALL : g.name;
    rebuildGroups(keep);
    cSel = 0; cTop = 0;
    renderAll();
  }

  function toggleShowHidden() {
    showHidden = !showHidden;
    rebuildGroups(null);
    gSel = groups.length - 1;               // stay on the toggle row
    cSel = 0; cTop = 0;
    renderAll();
  }

  /* ---------- theme picker ---------- */
  var picker = { open: false, sel: 0, orig: null, rows: [] };

  function buildPicker() {
    var wrap = $('tp-rows'), i, t, r;
    for (i = 0; i < Themes.list.length; i++) {
      t = Themes.list[i];
      r = document.createElement('div');
      r.className = 'tp-row';
      r.innerHTML = '<span class="tp-sw"><span style="background:' + t.bg + '"></span><span style="background:' + t.panel +
        '"></span><span style="background:' + t.accent + '"></span></span><span class="tp-name"></span><span class="tp-cur"></span>';
      U.text(r.childNodes[1], t.name);
      wrap.appendChild(r);
      picker.rows.push(r);
    }
  }

  function renderPicker() {
    var i, saved = U.store.get('theme', null) || picker.orig;
    for (i = 0; i < picker.rows.length; i++) {
      U.toggleClass(picker.rows[i], 'sel', i === picker.sel);
      U.text(picker.rows[i].childNodes[2], Themes.list[i].id === saved ? '✓' : '');
    }
  }

  function openPicker() {
    var i;
    picker.open = true;
    picker.orig = Themes.current();
    picker.sel = 0;
    for (i = 0; i < Themes.list.length; i++) { if (Themes.list[i].id === picker.orig) { picker.sel = i; } }
    $('theme-picker').className = 'show';
    renderPicker();
    var tp = $('theme-picker');
    tp.style.top = Math.max(20, Math.round((1080 - tp.offsetHeight) / 2)) + 'px';   // centre vertically
  }

  function closePicker(keep) {
    picker.open = false;
    $('theme-picker').className = '';
    if (keep) {
      U.store.set('theme', Themes.current());
      toast('Theme: ' + Themes.list[picker.sel].name);
    } else {
      Themes.apply(picker.orig);
    }
  }

  function onKeyPicker(k) {
    var n = Themes.list.length;
    if (k === 'UP') { picker.sel = (picker.sel - 1 + n) % n; }
    else if (k === 'DOWN') { picker.sel = (picker.sel + 1) % n; }
    else if (k === 'ENTER') { closePicker(true); return; }
    else if (k === 'RETURN' || k === 'INFO') { closePicker(false); return; }
    else { return; }
    Themes.apply(Themes.list[picker.sel].id);           // live preview
    renderPicker();
  }

  /* ---------- keys ---------- */
  function onKeyBrowser(k) {
    var items = curItems(), n = items.length;
    switch (k) {
      case 'UP':
        if (zone === 'groups') { if (gSel > 0) { gSel--; cSel = 0; cTop = 0; } }
        else if (cSel > 0) { cSel--; } else if (n) { cSel = n - 1; }
        break;
      case 'DOWN':
        if (zone === 'groups') { if (gSel < groups.length - 1) { gSel++; cSel = 0; cTop = 0; } }
        else if (cSel < n - 1) { cSel++; } else { cSel = 0; }
        break;
      case 'CH_UP':   // CH+ = towards higher channel numbers: page down the list
        if (zone === 'channels') { cSel = Math.min(n - 1, cSel + CH_ROWS); cTop = cTop + CH_ROWS; }
        break;
      case 'CH_DOWN': // CH- = towards lower numbers: page up the list
        if (zone === 'channels') { cSel = Math.max(0, cSel - CH_ROWS); cTop = Math.max(0, cTop - CH_ROWS); }
        break;
      case 'LEFT':
        if (zone === 'channels') { zone = 'groups'; }
        break;
      case 'RIGHT':
        if (zone === 'groups' && !(groups[gSel] && groups[gSel].toggle)) { zone = 'channels'; }
        break;
      case 'ENTER':
        if (zone === 'groups') {
          if (groups[gSel] && groups[gSel].toggle) { toggleShowHidden(); return; }
          zone = 'channels'; break;
        }
        if (!items[cSel]) { break; }
        if (items[cSel] !== playing || playState === 'error' || playState === 'ended') { startChannel(items[cSel], items); }
        else { zapList = items; }
        enterFullscreen();
        return;
      case 'RED':
        if (zone === 'groups') { toggleHidden(groups[gSel]); } else { toggleFav(items[cSel]); }
        return;
      case 'YELLOW': case 'STOP': stopPlayback(); return;
      case 'BLUE': case 'PREV_CH':
        if (lastPlayed) { var lp = lastPlayed; syncCursorTo(lp); startChannel(lp, curItems()); }
        return;
      case 'PLAYPAUSE': case 'PLAY': case 'PAUSE':
        if (playing) { enterFullscreen(); }
        return;
      case 'INFO': openPicker(); return;
      case 'RETURN':
        if (zone === 'channels' && playing) { stopPlayback(); return; }
        if (zone === 'channels') { zone = 'groups'; break; }
        exitApp();
        return;
      default: return;
    }
    if (zone === 'groups') { U.store.set('group', groups[gSel].name); }
    renderAll();
  }

  function onKeyFullscreen(k) {
    switch (k) {
      case 'CH_UP': case 'DOWN': zap(1); return;    // CH+ and Down: next (higher-numbered) channel
      case 'CH_DOWN': case 'UP': zap(-1); return;   // CH- and Up: previous channel, like moving in the list
      case 'ENTER': case 'INFO':
        if (U.hasClass($('banner'), 'show')) { hideBanner(); } else { showBanner(true); }
        return;
      case 'RETURN': case 'CH_LIST': case 'LEFT': case 'RIGHT': exitFullscreen(); return;
      case 'PLAYPAUSE': case 'PLAY': case 'PAUSE': Player.togglePause(); showBanner(true); return;
      case 'STOP': case 'YELLOW': stopPlayback(); return;
      case 'RED': toggleFav(playing); return;
      case 'GREEN': return;
      case 'BLUE': case 'PREV_CH':
        if (lastPlayed) { var lp = lastPlayed; startChannel(lp, zapList); syncCursorTo(lp); showBanner(true); }
        return;
      default: return;
    }
  }

  function onKey(ev) {
    var k = U.keyName(ev);
    if (k === null) { return; }
    ev.preventDefault();
    if (!all.length) {
      if (k === 'GREEN') { loadPlaylist(true); }
      else if (k === 'RETURN') { exitApp(); }
      return;
    }
    if (picker.open) { onKeyPicker(k); return; }
    if (/^[0-9]$/.test(k)) { numberKey(k); return; }
    if (k === 'GREEN') { loadPlaylist(true); return; }
    if (fullscreen) { onKeyFullscreen(k); } else { onKeyBrowser(k); }
  }

  function exitApp() {
    Player.stop();
    try { global.tizen.application.getCurrentApplication().exit(); } catch (e) { toast('Exit is only available on the TV'); }
  }

  /* ---------- clock ---------- */
  function tick() {
    var d = new Date();
    U.text($('clock'), U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()));
  }

  /* ---------- start ---------- */
  function init() {
    Themes.apply(U.store.get('theme', null) || (global.SETTINGS && global.SETTINGS.theme) || 'midnight');
    U.registerKeys();
    buildRows();
    buildPicker();
    Player.init($('av-holder'), $('html5-player'), onPlayerState);
    Player.setRect(PREVIEW.x, PREVIEW.y, PREVIEW.w, PREVIEW.h);
    document.addEventListener('keydown', onKey, false);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || document.webkitHidden) { Player.suspend(); } else { Player.resume(); }
    }, false);
    document.addEventListener('webkitvisibilitychange', function () {
      if (document.webkitHidden) { Player.suspend(); } else { Player.resume(); }
    }, false);
    tick();
    setInterval(tick, 10000);
    loadPlaylist(false);
  }

  global.App = { init: init, _state: function () { return { all: all, groups: groups, gSel: gSel, cSel: cSel, zone: zone, fullscreen: fullscreen, playing: playing }; } };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init, false); } else { init(); }
}(this));
