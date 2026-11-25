/* Colour themes (ES5). Tizen 2.4's WebKit has no CSS custom properties, so each
   theme is a palette that css() turns into a <style> block of colour rules.
   Layout lives in style.css; this file only sets colours. */
(function (global) {
  'use strict';

  var THEMES = [
    { id: 'midnight', name: 'Midnight',
      bg: '#0b0f17', text: '#e8ecf3', strong: '#ffffff', dim: '#8c97ab', faint: '#5d6a82',
      panel: '#121826', selIdle: '#1f2a40', accent: '#2f9bff', accentText: '#ffffff', accentBorder: '#9fd0ff',
      onAccentDim: '#e6f2ff', playing: '#6fe39b', logoBg: '#0b0f17', tagBg: '#2a3550', tagText: '#c9d3e6',
      track: '#1b2232', thumb: '#4a5a7a', overlay: 'rgba(11, 15, 23, 0.88)', toast: 'rgba(30, 40, 60, 0.95)' },

    { id: 'sunset', name: 'Sunset',
      bg: '#1a1020', text: '#f6e9e4', strong: '#fff6f0', dim: '#b9949a', faint: '#7f6070',
      panel: '#24162c', selIdle: '#3a2338', accent: '#ff7a59', accentText: '#ffffff', accentBorder: '#ffc2a6',
      onAccentDim: '#fff0e8', playing: '#ffd166', logoBg: '#140b18', tagBg: '#432a42', tagText: '#f2d6d0',
      track: '#2e1d33', thumb: '#7a4a66', overlay: 'rgba(26, 16, 32, 0.88)', toast: 'rgba(58, 35, 56, 0.95)' },

    { id: 'oled', name: 'Black & White', edge: '#1e1e1e',
      bg: '#000000', text: '#f2f2f2', strong: '#ffffff', dim: '#9a9a9a', faint: '#666666',
      panel: '#0b0b0b', selIdle: '#1c1c1c', accent: '#ffffff', accentText: '#000000', accentBorder: '#9a9a9a',
      onAccentDim: '#333333', playing: '#4ade80', logoBg: '#000000', tagBg: '#222222', tagText: '#dddddd',
      track: '#151515', thumb: '#555555', overlay: 'rgba(0, 0, 0, 0.9)', toast: 'rgba(28, 28, 28, 0.97)' },

    { id: 'forest', name: 'Forest',
      bg: '#0b1410', text: '#e4f1ea', strong: '#f4fff9', dim: '#8fae9e', faint: '#5d7a6b',
      panel: '#111f18', selIdle: '#1c3328', accent: '#34c38f', accentText: '#04140d', accentBorder: '#a6f0d2',
      onAccentDim: '#0b3323', playing: '#f2c94c', logoBg: '#08100c', tagBg: '#22392e', tagText: '#cfe8db',
      track: '#16281f', thumb: '#3f6b56', overlay: 'rgba(11, 20, 16, 0.88)', toast: 'rgba(28, 51, 40, 0.95)' }
  ];

  THEMES.push(
    { id: 'fjord', name: 'Fjord',
      bg: '#2e3440', text: '#e5e9f0', strong: '#eceff4', dim: '#a3acbd', faint: '#7b8496',
      panel: '#3b4252', selIdle: '#4c566a', accent: '#88c0d0', accentText: '#1f2530', accentBorder: '#d8eef4',
      onAccentDim: '#2e3e48', playing: '#a3be8c', logoBg: '#262b35', tagBg: '#4c566a', tagText: '#e5e9f0',
      track: '#434c5e', thumb: '#7b8496', overlay: 'rgba(46, 52, 64, 0.92)', toast: 'rgba(59, 66, 82, 0.97)' },

    { id: 'espresso', name: 'Espresso',
      bg: '#1c1411', text: '#f0e4d8', strong: '#fff7ee', dim: '#b09884', faint: '#7a6656',
      panel: '#291d18', selIdle: '#3d2b22', accent: '#e0a458', accentText: '#2a1606', accentBorder: '#f6d4a6',
      onAccentDim: '#5c3812', playing: '#9ccf8a', logoBg: '#140e0b', tagBg: '#3a2a21', tagText: '#ecd9c6',
      track: '#33241d', thumb: '#7a6656', overlay: 'rgba(28, 20, 17, 0.9)', toast: 'rgba(61, 43, 34, 0.97)' },

    { id: 'lagoon', name: 'Lagoon',
      bg: '#04232b', text: '#dff6f4', strong: '#f2fffd', dim: '#86b3b5', faint: '#567f82',
      panel: '#07323d', selIdle: '#0d4652', accent: '#2ee6c5', accentText: '#002b24', accentBorder: '#b2fff1',
      onAccentDim: '#03574a', playing: '#ffd36b', logoBg: '#021a20', tagBg: '#0d4652', tagText: '#d4f2ef',
      track: '#0a3c48', thumb: '#4e8a8e', overlay: 'rgba(4, 35, 43, 0.9)', toast: 'rgba(13, 70, 82, 0.97)' },

    { id: 'royal', name: 'Royal',
      bg: '#12103a', text: '#ece9ff', strong: '#ffffff', dim: '#9d97cf', faint: '#6a649c',
      panel: '#1c1950', selIdle: '#2b2770', accent: '#ffcc4d', accentText: '#231a00', accentBorder: '#ffe9a8',
      onAccentDim: '#6b5000', playing: '#7ee8a0', logoBg: '#0c0a28', tagBg: '#2b2770', tagText: '#e2deff',
      track: '#241f62', thumb: '#5c56a0', overlay: 'rgba(18, 16, 58, 0.9)', toast: 'rgba(43, 39, 112, 0.97)' },

    // pure black (hides LCD backlight glow) with gold highlights and warm ivory text
    { id: 'noir-gold', name: 'Noir Gold', edge: '#221d14',
      bg: '#000000', text: '#f3ead7', strong: '#fff8e8', dim: '#a39882', faint: '#6b6252',
      panel: '#050505', selIdle: '#1a1610', accent: '#d4af37', accentText: '#140f00', accentBorder: '#f3dc8a',
      onAccentDim: '#4a3a08', playing: '#e9c46a', logoBg: '#000000', tagBg: '#1f1a12', tagText: '#f3ead7',
      track: '#1a1610', thumb: '#6b6252', overlay: 'rgba(0, 0, 0, 0.9)', toast: 'rgba(16, 16, 16, 0.97)' }
  );

  function css(t) {
    var r = [];
    function rule(sel, decl) { r.push(sel + ' { ' + decl + ' }'); }
    rule('html, body, #stage, #radio-art, #loading', 'background: ' + t.bg + '; color: ' + t.text + ';');
    rule('#brand, #clock, #numentry, #radio-name, #banner-name', 'color: ' + t.strong + ';');
    rule('#brand span, #info-num, #banner-num', 'color: ' + t.accent + ';');
    rule('#status, .panel-title, .g-count, .r-num, #info-group, #footer, #loading-text, .row.toggle-row .g-name',
      'color: ' + t.dim + ';');
    rule('.r-initials, #channels-empty, #info-help', 'color: ' + t.faint + ';');
    rule('.num', 'border-color: ' + t.dim + ';');
    rule('.panel, #info', 'background: ' + t.panel + ';');
    rule('.row.sel', 'background: ' + t.selIdle + ';');
    rule('.panel.active .row.sel', 'background: ' + t.accent + '; color: ' + t.accentText + '; border-color: ' + t.accentBorder + ';');
    rule('.panel.active .row.sel .g-count, .panel.active .row.sel .r-num', 'color: ' + t.onAccentDim + ';');
    rule('.panel.active .row.sel.toggle-row .g-name, .panel.active .row.sel.playing .r-name', 'color: ' + t.accentText + ';');
    rule('.row.playing .r-name', 'color: ' + t.playing + ';');
    rule('.r-logo', 'background: ' + t.logoBg + ';');
    rule('.tag', 'background: ' + t.tagBg + '; color: ' + t.tagText + ';');
    rule('#scrollbar', 'background: ' + t.track + ';');
    // programme guide
    rule('#guide', 'background: ' + t.bg + '; color: ' + t.text + ';');
    rule('#guide-list, #guide-detail', 'background: ' + t.panel + ';' + (t.edge ? ' -webkit-box-shadow: inset 0 0 0 2px ' + t.edge + '; box-shadow: inset 0 0 0 2px ' + t.edge + ';' : ''));
    rule('#guide-logo', 'background: ' + t.logoBg + ';');
    rule('#guide-ch, #gd-title', 'color: ' + t.strong + ';');
    rule('#guide-sub, #guide-hint, .g-day, .g-time, #gd-when, #guide-empty', 'color: ' + t.dim + ';');
    rule('#gd-desc', 'color: ' + t.text + ';');
    rule('.g-prog.sel', 'background: ' + t.accent + '; color: ' + t.accentText + '; border-color: ' + t.accentBorder + ';');
    rule('.g-prog.sel .g-time', 'color: ' + t.onAccentDim + ';');
    rule('.g-now', 'background: ' + t.accent + '; color: ' + t.accentText + ';');
    rule('.g-prog.sel .g-now', 'background: ' + t.accentText + '; color: ' + t.accent + ';');
    rule('#gd-bar', 'background: ' + t.selIdle + ';');
    rule('#gd-fill', 'background: ' + t.accent + ';');
    rule('#epg-loading', 'color: ' + t.dim + ';');
    rule('.mini-spinner', 'border-color: ' + t.selIdle + '; border-top-color: ' + t.accent + ';');
    rule('.r-now, .e-time, .e-label, #e-desc, #b-now-time, #b-next', 'color: ' + t.dim + ';');
    rule('.panel.active .row.sel .r-now', 'color: ' + t.onAccentDim + ';');
    rule('.e-title, #b-now-title', 'color: ' + t.strong + ';');
    rule('.e-next .e-title', 'color: ' + t.text + ';');
    rule('.e-bar, .b-bar', 'background: ' + t.selIdle + ';');
    rule('.e-fill, #b-fill', 'background: ' + t.accent + ';');
    // thin edge around panels (black themes); inset so the layout doesn't move
    rule('.panel, #info', t.edge ? '-webkit-box-shadow: inset 0 0 0 2px ' + t.edge + '; box-shadow: inset 0 0 0 2px ' + t.edge + ';' :
      '-webkit-box-shadow: none; box-shadow: none;');
    rule('#scrollthumb', 'background: ' + t.thumb + ';');
    rule('#banner', 'background: ' + t.overlay + '; border-top-color: ' + t.accent + ';');
    rule('#banner-msg', 'color: ' + t.text + ';');
    rule('#numentry', 'background: ' + t.overlay + '; border-color: ' + t.accent + ';');
    rule('#toast', 'background: ' + t.toast + '; color: ' + t.text + ';');
    rule('.spinner', 'border-color: ' + t.selIdle + '; border-top-color: ' + t.accent + ';');
    rule('#theme-picker', 'background: ' + t.panel + '; border-color: ' + t.accent + '; color: ' + t.text + ';');
    rule('#theme-picker .tp-title, #theme-picker .tp-help', 'color: ' + t.dim + ';');
    rule('#theme-picker .tp-row.sel', 'background: ' + t.accent + '; color: ' + t.accentText + ';');
    // Full screen must stay see-through so the video plane shows (keep last).
    rule('body.fullscreen, body.fullscreen #stage', 'background: transparent;');
    return r.join('\n');
  }

  var styleEl = null, currentId = null;

  var Themes = {
    list: THEMES,
    current: function () { return currentId; },
    byId: function (id) {
      for (var i = 0; i < THEMES.length; i++) { if (THEMES[i].id === id) { return THEMES[i]; } }
      return null;
    },
    apply: function (id) {
      var t = Themes.byId(id) || THEMES[0];
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'theme-css';
        document.getElementsByTagName('head')[0].appendChild(styleEl);
      }
      styleEl.textContent = css(t);
      currentId = t.id;
      return t.id;
    }
  };

  global.Themes = Themes;
}(this));
