/* Extended M3U parser (ES5). Understands:
     #EXTM3U url-tvg="..."
     #EXTINF:-1 key="value" ...,Display name
     #EXTGRP:Group
     #EXTVLCOPT:http-user-agent= / http-referrer= / http-origin=
     #KODIPROP:inputstream.adaptive.license_type= / license_key=
   Any other '#' line is a comment (this includes commented-out stream URLs). */
(function (global) {
  'use strict';

  var ATTR_RE = /^\s*([A-Za-z0-9_\-]+)\s*=\s*"([^"]*)"/;

  function unquote(s) {
    s = String(s).replace(/^\s+|\s+$/g, '');
    if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') { s = s.substring(1, s.length - 1); }
    return s;
  }

  /* Parse the part after "#EXTINF:" → {duration, attrs, name}. Attribute
     values may contain commas, so the name is whatever follows the comma
     that ends the attribute list. */
  function parseExtinf(rest) {
    var m = /^\s*(-?[0-9.]+)/.exec(rest), attrs = {}, a, name;
    var duration = m ? parseFloat(m[1]) : -1;
    rest = m ? rest.substring(m[0].length) : rest;
    while ((a = ATTR_RE.exec(rest)) !== null) {
      attrs[a[1].toLowerCase()] = a[2];
      rest = rest.substring(a[0].length);
    }
    var comma = rest.indexOf(',');
    name = comma >= 0 ? rest.substring(comma + 1) : rest;
    name = name.replace(/^\s+|\s+$/g, '');
    return { duration: duration, attrs: attrs, name: name };
  }

  function parse(text) {
    var lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
    var channels = [], groups = [], groupSeen = {}, epg = '';
    var pending = null, i, line, idx, key, val, info, group;

    function fresh() {
      return { name: '', group: '', logo: '', tvgId: '', radio: false, ua: '', referrer: '', origin: '',
        drmType: '', drmKey: '' };
    }

    for (i = 0; i < lines.length; i++) {
      line = lines[i].replace(/^\s+|\s+$/g, '');
      if (!line) { continue; }

      if (line.charAt(0) === '#') {
        if (line.indexOf('#EXTM3U') === 0) {
          var hdr = parseExtinf('0 ' + line.substring(7));
          epg = hdr.attrs['url-tvg'] || hdr.attrs['x-tvg-url'] || epg;
        } else if (line.indexOf('#EXTINF:') === 0) {
          info = parseExtinf(line.substring(8));
          pending = fresh();
          pending.name = info.name || 'Unnamed';
          pending.group = info.attrs['group-title'] || '';
          pending.logo = info.attrs['tvg-logo'] || '';
          pending.tvgId = info.attrs['tvg-id'] || '';
          pending.radio = info.attrs.radio === 'true';
        } else if (pending && line.indexOf('#EXTGRP:') === 0) {
          if (!pending.group) { pending.group = line.substring(8).replace(/^\s+/, ''); }
        } else if (pending && line.indexOf('#EXTVLCOPT:') === 0) {
          idx = line.indexOf('=');
          if (idx > 0) {
            key = line.substring(11, idx).toLowerCase();
            val = unquote(line.substring(idx + 1));
            if (key === 'http-user-agent') { pending.ua = val; }
            else if (key === 'http-referrer' || key === 'http-referer') { pending.referrer = val; }
            else if (key === 'http-origin') { pending.origin = val; }
          }
        } else if (pending && line.indexOf('#KODIPROP:') === 0) {
          idx = line.indexOf('=');
          if (idx > 0) {
            key = line.substring(10, idx).toLowerCase();
            val = unquote(line.substring(idx + 1));
            if (key === 'inputstream.adaptive.license_type') { pending.drmType = val; }
            else if (key === 'inputstream.adaptive.license_key') { pending.drmKey = val; }
          }
        }
        continue;
      }

      // A URL line closes the current entry.
      if (!pending) { pending = fresh(); pending.name = line; }
      pending.url = line;
      group = pending.group || 'Other';
      pending.group = group;
      if (!groupSeen[group]) { groupSeen[group] = true; groups.push(group); }
      pending.num = channels.length + 1;
      pending.key = group + '|' + pending.name;   // stable id for favourites
      channels.push(pending);
      pending = null;
    }

    return { epg: epg, groups: groups, channels: channels };
  }

  var M3U = { parse: parse, parseExtinf: parseExtinf };
  if (typeof module !== 'undefined' && module.exports) { module.exports = M3U; }
  else { global.M3U = M3U; }
}(this));
