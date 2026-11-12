// Offline stand-in for the claude.ai runtime: the same small database API the hub uses
// (collection(c).doc(id).set(data), collection(c).onSnapshot(cb, err)), kept in this browser's localStorage.
// On first open it is filled from offline-seed.js (the online hub's database when this copy was built).
(function () {
  if (window.claude) return;
  var PREFIX = 'offline.db.', subs = {};
  var read = function (c) { try { return JSON.parse(localStorage.getItem(PREFIX + c)) || {}; } catch (e) { return {}; } };
  var write = function (c, v) { localStorage.setItem(PREFIX + c, JSON.stringify(v)); };
  var seed = window.OFFLINE_SEED || {};
  try {
    Object.keys(seed.collections || {}).forEach(function (c) {
      if (localStorage.getItem(PREFIX + c) == null) write(c, seed.collections[c]);   // never overwrite offline edits
    });
  } catch (e) { /* storage blocked: the hub falls back to its own per-page storage */ }
  var emit = function (c) {
    var all = read(c), snap = { docs: Object.keys(all).map(function (id) { return { id: id, data: function () { return all[id]; } }; }) };
    (subs[c] || []).forEach(function (s) { try { s.cb(snap); } catch (e) { /* a listener failed */ } });
  };
  var db = {
    collection: function (c) {
      return {
        doc: function (id) {
          return { set: function (data) {
            return new Promise(function (ok, fail) {
              try { var all = read(c); all[id] = JSON.parse(JSON.stringify(data)); write(c, all); } catch (e) { var er = new Error('Could not save in this browser'); er.code = 'unavailable'; fail(er); return; }
              setTimeout(function () { emit(c); }, 0); ok();
            });
          } };
        },
        onSnapshot: function (cb, err) {
          var s = { cb: cb, err: err };
          (subs[c] = subs[c] || []).push(s);
          setTimeout(function () { emit(c); }, 0);
          return function () { subs[c] = (subs[c] || []).filter(function (x) { return x !== s; }); };
        }
      };
    }
  };
  // another open copy of the hub saved something: show it here too
  window.addEventListener('storage', function (e) { if (e.key && e.key.indexOf(PREFIX) === 0) emit(e.key.slice(PREFIX.length)); });
  window.claude = { use: function (name) { return Promise.resolve(name === 'db' ? db : null); } };
})();
