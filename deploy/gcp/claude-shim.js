// Outside claude.ai there is no window.claude: this gives the hub the same small database API
// (collection(c).doc(id).set(data), collection(c).onSnapshot(cb, err)) backed by the server's /api/db.
(function () {
  if (window.claude) return;
  var subs = {}, timers = {};
  var fail = function (r) { var e = new Error(r.statusText || 'request failed'); e.code = r.status === 401 || r.status === 403 ? 'permission_denied' : 'unavailable'; throw e; };
  function refresh(c) {
    return fetch('api/db/' + c, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (!r.ok) fail(r); return r.json(); })
      .then(function (j) {
        var snap = { docs: j.docs.map(function (d) { return { id: d.id, data: function () { return d.data; } }; }) };
        (subs[c] || []).forEach(function (s) { s.cb(snap); });
      }, function (e) { (subs[c] || []).forEach(function (s) { if (s.err) s.err(e); }); });
  }
  var db = {
    collection: function (c) {
      return {
        doc: function (id) {
          return { set: function (data) {
            return fetch('api/db/' + c + '/' + encodeURIComponent(id), { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
              .then(function (r) { if (!r.ok) fail(r); refresh(c); });
          } };
        },
        // the first snapshot comes at once; others when this page writes, or every 30 s (other viewers' changes)
        onSnapshot: function (cb, err) {
          var s = { cb: cb, err: err };
          (subs[c] = subs[c] || []).push(s);
          refresh(c);
          if (!timers[c]) timers[c] = setInterval(function () { if (document.visibilityState !== 'hidden') refresh(c); }, 30000);
          return function () { subs[c] = (subs[c] || []).filter(function (x) { return x !== s; }); };
        }
      };
    }
  };
  window.claude = { use: function (name) { return Promise.resolve(name === 'db' ? db : null); } };
})();
