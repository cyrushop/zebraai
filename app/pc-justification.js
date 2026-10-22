/* PC justification text builder + Zebra → competitor model lookup.
 *
 * Works in the browser (window.PCJ) and in Node (module.exports) so the text
 * format and the model lookup can be tested without a UI.
 *
 * Competitor models are suggestions from public product pages and reseller
 * listings, checked 2026-10-22. Only models found in a source are listed; a
 * category with no confirmed model is left empty for the user to fill in.
 */
(function (root) {
  'use strict';

  var BRANDS = ['Honeywell', 'TSC', 'Chainway', 'Urovo', 'Evolis'];
  var DEMANDS = ['WMS', 'Asset Management', 'Staff Card'];

  // Zebra model → category. First match wins, so the narrower patterns
  // (RFID variants of keypad devices, ultra-rugged touch) come first.
  var CATEGORIES = [
    { key: 'rfid', label: 'UHF RFID handheld', re: /^(RFD\d|MC3\d{2}0X?R|MC9\d{2}0R)/ },
    { key: 'fixedrfid', label: 'Fixed RFID reader', re: /^(FX\d|ATR\d)/ },
    { key: 'wearable', label: 'Wearable computer', re: /^(WS\d|WT\d)/ },
    { key: 'tablet', label: 'Rugged tablet', re: /^(ET\d|L10)/ },
    { key: 'touch-ultra', label: 'Ultra-rugged touch mobile computer', re: /^TC[78]\d/ },
    { key: 'touch-mid', label: 'Rugged touch mobile computer', re: /^(TC5\d|HC5\d)/ },
    { key: 'touch-entry', label: 'Entry touch mobile computer', re: /^(TC[12]\d|EC\d|HC[12]\d)/ },
    { key: 'keypad-ultra', label: 'Ultra-rugged keypad mobile computer', re: /^MC9\d/ },
    { key: 'keypad', label: 'Keypad mobile computer', re: /^MC[23]\d/ },
    { key: 'printer-card-retransfer', label: 'Retransfer card printer', re: /^ZXP(SERIES)?9/ },
    { key: 'printer-card', label: 'Card printer', re: /^(ZC\d|ZXP)/ },
    { key: 'printer-mobile', label: 'Mobile printer', re: /^(ZQ\d|ZR\d|QLN|IMZ)/ },
    { key: 'printer-industrial', label: 'Industrial printer', re: /^(ZT\d|ZE\d|XI4)/ },
    { key: 'printer-desktop', label: 'Desktop printer', re: /^(ZD\d|GK\d|GX\d|GC\d)/ },
    { key: 'scanner-rugged', label: 'Ultra-rugged scanner', re: /^(DS36|LI36)/ },
    { key: 'scanner', label: 'Barcode scanner', re: /^(DS\d|LI\d|LS\d|CS\d)/ }
  ];

  // category → brand → [{model, note}], best match first.
  var COMPETITORS = {
    'rfid': {
      Honeywell: [{ model: 'IH40', note: 'UHF RFID handheld reader for CT/EDA series' },
                  { model: 'IH45', note: 'UHF RFID handheld reader, pairs with CT30 XP / CT47 / EDA52' }],
      TSC: [{ model: 'Bluebird RFR901', note: 'UHF RFID handheld reader (Bluebird, TSC group)' },
            { model: 'Bluebird HF550X', note: 'Short-range RFID mobile computer' }],
      Chainway: [{ model: 'C72', note: 'Android UHF RFID handheld' },
                 { model: 'SR160', note: 'UHF RFID + 2D scanner' }],
      Urovo: [{ model: 'DT50U', note: 'Long-range UHF RFID handheld' },
               { model: 'DT50P Lite', note: 'UHF RFID handheld' },
               { model: 'RFDT50', note: 'UHF sled for DT50' }]
    },
    'fixedrfid': {
      Chainway: [{ model: 'URA8', note: '8-port Android fixed UHF reader' }]
    },
    'wearable': {
      Honeywell: [{ model: 'CW45', note: 'Wearable computer; listings show no built-in scan engine' }]
    },
    'tablet': {
      Chainway: [{ model: 'P80', note: '8" rugged tablet, optional UHF' }]
    },
    'touch-ultra': {
      Honeywell: [{ model: 'CT70', note: 'Ultra-rugged, 5G' }, { model: 'CT47', note: '5.5", 5G' }],
      TSC: [{ model: 'Bluebird S50', note: 'Full-rugged 6", 5G, IP68' }],
      Chainway: [{ model: 'MC51', note: '6", Android 14' }, { model: 'MC50', note: '6", 5G' }],
      Urovo: [{ model: 'DT66', note: '6.5", 5G, IP68, 1.8 m drop' }]
    },
    'touch-mid': {
      Honeywell: [{ model: 'CT47', note: '5.5", 5G, Wi-Fi 6E' }, { model: 'CT37', note: '6", Wi-Fi 6E' }],
      TSC: [{ model: 'Bluebird EF550', note: '5.5" rugged, IP68' }, { model: 'Bluebird S50', note: 'Full-rugged 6", 5G' }],
      Chainway: [{ model: 'MC50', note: '6", 5G' }, { model: 'MC51', note: '6", Android 14' }, { model: 'C66', note: '5.5"' }],
      Urovo: [{ model: 'DT50', note: '5.7", IP67' }, { model: 'DT66', note: '6.5", 5G' }]
    },
    'touch-entry': {
      Honeywell: [{ model: 'CT30 XP', note: 'Compact 5.5", retail' }, { model: 'EDA52', note: 'ScanPal enterprise' }],
      TSC: [{ model: 'Bluebird S20', note: 'Standard range, Wi-Fi' }],
      Chainway: [{ model: 'C66', note: '5.5"' }],
      Urovo: [{ model: 'CT48', note: 'Lightweight, indoor' }, { model: 'CT58', note: 'Entry-level, IP67' }]
    },
    'keypad-ultra': {
      Honeywell: [{ model: 'CK67', note: 'Ultra-rugged keypad, 5G, hot-swap' }],
      TSC: [{ model: 'Bluebird EK430', note: '4.3" keypad, hot-swap; trigger handle variant' }],
      Chainway: [{ model: 'C61', note: 'Keypad handheld' }],
      Urovo: [{ model: 'RT40S', note: 'IP68, long range up to 15 m, cold chain' }]
    },
    'keypad': {
      Honeywell: [{ model: 'CK67', note: 'Rugged keypad, 5G, hot-swap' }],
      TSC: [{ model: 'Bluebird EK430', note: '4.3" keypad, IP65, hot-swap' }],
      Chainway: [{ model: 'C61', note: 'Keypad handheld' }],
      Urovo: [{ model: 'DT40', note: '4" full keypad' }, { model: 'RT40S', note: 'IP68, long range' }]
    },
    'printer-card-retransfer': {
      Evolis: [{ model: 'Avansia', note: 'Retransfer, 600 dpi' }, { model: 'Agilia', note: 'Retransfer, edge-to-edge' }]
    },
    'printer-card': {
      Evolis: [{ model: 'Primacy 2', note: 'High-volume, single / dual-sided' },
               { model: 'Zenius', note: 'Compact desktop' },
               { model: 'Badgy200', note: 'Entry level' }]
    },
    'printer-mobile': {
      Honeywell: [{ model: 'RP4f', note: '4" mobile printer' }],
      TSC: [{ model: 'Alpha-40L', note: '4" mobile printer' }, { model: 'Alpha-40L RFID', note: 'Mobile RFID printer' }],
      Urovo: [{ model: 'K329', note: 'Portable direct-thermal' }, { model: 'K388 Pro', note: 'Mobile label printer' }]
    },
    'printer-industrial': {
      Honeywell: [{ model: 'PM45', note: 'Mid-range industrial' }, { model: 'PX940', note: 'High-end industrial' },
                  { model: 'PD45S', note: 'Commercial grade industrial' }],
      TSC: [{ model: 'MH240', note: 'Industrial, 203/300/600 dpi' }, { model: 'ML240P', note: 'Compact industrial' }]
    },
    'printer-desktop': {
      Honeywell: [{ model: 'PC45', note: 'Desktop, 203/300 dpi' }],
      TSC: [{ model: 'TE210', note: 'Desktop (TE200 series)' }, { model: 'TX210', note: 'Desktop thermal transfer' }],
      Urovo: [{ model: 'D7000', note: 'Thermal transfer desktop' }]
    },
    'scanner-rugged': {
      Honeywell: [{ model: 'Granit 1990i', note: 'Ultra-rugged corded, IP65/IP67' }]
    },
    'scanner': {
      Honeywell: [{ model: 'Xenon 1950g', note: 'Corded area imager' }, { model: 'Voyager 1472g', note: 'Cordless 1D/2D' }],
      Urovo: [{ model: 'SR5600', note: 'Portable wireless scanner' }]
    }
  };

  // "TC530K-1HEA..." → "TC530K1HEA"; matching is on the prefix only.
  function normModel(s) {
    return String(s || '').toUpperCase().replace(/^ZEBRA\s+/, '').replace(/[\s\-_.]/g, '');
  }

  function category(zebraModel) {
    var m = normModel(zebraModel);
    if (!m) return null;
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].re.test(m)) return CATEGORIES[i];
    return null;
  }

  // "TC53, ZD421 / DS2208" → ["TC53", "ZD421", "DS2208"]
  function splitProducts(s) {
    return String(s || '').split(/[,，、\/+&;\n]| and /i).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  // Suggestions for one brand across every Zebra product the user typed.
  // Returns [{zebra, category, options: [{model, note}]}].
  function suggest(zebraProducts, brand) {
    return splitProducts(zebraProducts).map(function (z) {
      var cat = category(z);
      var opts = cat && COMPETITORS[cat.key][brand] || [];
      return { zebra: z, category: cat, options: opts.slice() };
    });
  }

  // The one brand with a match for every product typed (card printers →
  // Evolis), or null when several brands fit or none fits them all.
  function autoBrand(zebraProducts) {
    var cats = splitProducts(zebraProducts).map(category);
    if (!cats.length || cats.some(function (c) { return !c; })) return null;
    var fits = BRANDS.filter(function (b) {
      return cats.every(function (c) { return (COMPETITORS[c.key][b] || []).length; });
    });
    return fits.length === 1 ? fits[0] : null;
  }

  // ------------------------------------------------------------------ text
  function pad(n) { var s = n + '.'; return s + (s.length < 3 ? '    ' : '  '); }
  function yn(v) { return v ? 'Yes' : 'No'; }
  function pct(v) {
    var s = String(v == null ? '' : v).trim();
    return s === '' || /%$/.test(s) ? s : s + '%';
  }

  var DEFAULTS = {
    pcRebate: false, sideway: false, freeUnits: false, emc: false, invoice: true, bundle: true, annual: false,
    distMargin: '5', resellerMargin: '12', otherComments: 'Nil', attachment: 'Nil'
  };

  function withDefaults(f) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    for (var j in f || {}) if (f[j] !== undefined) o[j] = f[j];
    return o;
  }

  // Shared items 1–9 of the new PC (2–10 of the repeat PC).
  function commonLines(f) {
    return [
      'Front-end PC',
      'PC+Rebate: ' + yn(f.pcRebate),
      'Sideway Selling: ' + yn(f.sideway),
      'Has Free units Request: ' + yn(f.freeUnits),
      'EMC Market Share Acceleration: ' + yn(f.emc),
      'End-user Invoice Providing: ' + yn(f.invoice),
      ['Margin Information：',
       '    a.  Distributor Margin：' + pct(f.distMargin),
       '    b.  Reseller Margin：' + pct(f.resellerMargin)],
      ['Bundle Service: ' + yn(f.bundle),
       'Customer Contact Information：' + (f.contact || '').trim()],
      'Annual Agreement: ' + yn(f.annual)
    ];
  }

  function render(items) {
    var out = [];
    items.forEach(function (it, i) {
      var lines = Array.isArray(it) ? it : [it];
      out.push(pad(i + 1) + lines[0]);
      for (var j = 1; j < lines.length; j++) out.push(lines[j]);
    });
    return out.join('\n');
  }

  function competitorText(f) {
    var brand = (f.competitorBrand || '').trim();
    var model = (f.competitorModel || '').trim();
    return [brand, model].filter(Boolean).join(' ') || 'Nil';
  }

  function buildNew(fields) {
    var f = withDefaults(fields);
    return render(commonLines(f).concat([
      'Customer Demand：' + (f.demand || '').trim(),
      'Zebra Product & Solution：' + (f.zebraProduct || '').trim(),
      'Competitor & Model：' + competitorText(f),
      'Other Comments & Update: ' + ((f.otherComments || '').trim() || 'Nil'),
      'Attachment: ' + ((f.attachment || '').trim() || 'Nil')
    ]));
  }

  function buildRepeat(fields) {
    var f = withDefaults(fields);
    return render(['Previous Repeat PC#: ' + (f.previousPc || '').trim()].concat(commonLines(f)));
  }

  var api = {
    BRANDS: BRANDS, DEMANDS: DEMANDS, CATEGORIES: CATEGORIES, COMPETITORS: COMPETITORS, DEFAULTS: DEFAULTS,
    category: category, splitProducts: splitProducts, suggest: suggest, autoBrand: autoBrand, buildNew: buildNew, buildRepeat: buildRepeat
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PCJ = api;
})(this);
