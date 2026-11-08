/* Store layout, zones, FXR90 readers and antennas for the zone-based RFID POC.
 * Geometry is the simplified Citygate floor plan from the Phase 0 demo (viewBox 0 0 1000 580).
 * One antenna belongs to one zone. A zone can have several antennas or none.
 * Portal antennas come in inner/outer pairs and give direction at a doorway.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RFIDConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ANTENNA_MODELS = {
    AN520: {
      label: 'AN520', role: 'area', polarization: 'RHCP', gain: '5.5 dBiC', beam: '115°',
      use: 'Wide-angle area antenna, low profile. Ceiling or wall mount below the false ceiling.',
      coverR: 80
    },
    AN510: {
      label: 'AN510', role: 'portal', polarization: 'RHCP', gain: '8.5 dBiC', beam: '68°',
      use: 'Narrower beam for doorways. Used in inner/outer pairs to tell direction.',
      coverR: 42
    },
    AN670: {
      label: 'AN670', role: 'point', polarization: 'Near field', gain: 'Near field', beam: 'Short range',
      use: 'Near-field mat for a counter or table. Reads only what sits on it.',
      coverR: 26
    }
  };

  const READER_MODELS = {
    'FXR90-4': { ports: 4 },
    'FXR90-8': { ports: 8 }
  };

  const STORE = {
    name: 'Citygate Outlet',
    viewBox: [0, 0, 1000, 580],
    outline: '60,40 960,40 960,480 760,540 200,450 40,200',
    entranceGap: [822, 521, 898, 498],
    doors: [
      { id: 'boh-door', label: 'Stockroom door', x1: 713, y1: 120, x2: 757, y2: 120 },
      { id: 'service-door', label: 'Service door', x1: 682, y1: 40, x2: 718, y2: 40 }
    ],
    open: 10 * 3600,
    close: 22 * 3600
  };

  // kind: boh | floor | fr | cash | queue | over | exit | exclude
  const ZONES = [
    { id: 'boh', name: 'Stockroom', kind: 'boh', rects: [[640, 48, 190, 70]], label: [648, 66] },
    { id: 'polo', name: 'Polo Wall', kind: 'floor', rects: [[310, 50, 320, 36]], label: [318, 66] },
    { id: 'mens', name: "Men's", kind: 'floor', rects: [[300, 94, 336, 160], [642, 128, 188, 124]], label: [310, 112] },
    { id: 'clearance', name: 'Clearance', kind: 'floor', rects: [[82, 52, 210, 150], [128, 212, 164, 106]], label: [92, 72] },
    { id: 'topshelf', name: 'Top shelf overstock', kind: 'over', rects: [[300, 262, 170, 18]], label: [304, 275] },
    { id: 'children', name: 'Children', kind: 'floor', rects: [[300, 284, 170, 120]], label: [308, 302] },
    { id: 'accessories', name: 'Accessories', kind: 'floor', rects: [[480, 262, 128, 48]], label: [486, 278] },
    { id: 'womens', name: "Women's", kind: 'floor', rects: [[480, 318, 232, 106], [614, 262, 98, 50]], label: [488, 336] },
    { id: 'cashwrap', name: 'Cash wrap', kind: 'cash', rects: [[722, 288, 110, 62]], label: [728, 304] },
    { id: 'queue', name: 'Queue', kind: 'queue', rects: [[722, 354, 110, 40]], label: [728, 370] },
    { id: 'fitting', name: 'Fitting rooms', kind: 'fr', rects: [[842, 60, 106, 330]], label: [850, 78] },
    { id: 'entrance', name: 'Entrance', kind: 'exit', rects: [[800, 420, 120, 60]], label: [806, 450] },
    { id: 'window', name: 'Window display', kind: 'exclude', rects: [[590, 446, 160, 34]], label: [596, 462] }
  ];

  const READERS = [
    { id: 'FXR-A', model: 'FXR90-8', x: 800, y: 66, location: 'Stockroom, IT rack' },
    { id: 'FXR-B', model: 'FXR90-8', x: 760, y: 410, location: 'Cash wrap, under counter' }
  ];

  // side: inner/outer for portal antennas. Inner = stockroom side (boh-door) or store side (entrance).
  const ANTENNAS = [
    { id: 'A1', reader: 'FXR-A', port: 1, model: 'AN520', zone: 'boh', x: 700, y: 100, mount: 'Ceiling, below false ceiling' },
    { id: 'A2', reader: 'FXR-A', port: 2, model: 'AN510', zone: 'boh', portal: 'boh-door', side: 'inner', x: 735, y: 104, mount: 'Door header, stockroom side' },
    { id: 'A3', reader: 'FXR-A', port: 3, model: 'AN510', zone: 'mens', portal: 'boh-door', side: 'outer', x: 735, y: 138, mount: 'Door header, floor side' },
    { id: 'A4', reader: 'FXR-A', port: 4, model: 'AN520', zone: 'polo', x: 470, y: 68, mount: 'Ceiling, below false ceiling' },
    { id: 'A5', reader: 'FXR-A', port: 5, model: 'AN520', zone: 'mens', x: 410, y: 176, mount: 'Ceiling, below false ceiling' },
    { id: 'A6', reader: 'FXR-A', port: 6, model: 'AN520', zone: 'mens', x: 736, y: 196, mount: 'Ceiling, below false ceiling' },
    { id: 'A7', reader: 'FXR-A', port: 7, model: 'AN520', zone: 'fitting', x: 895, y: 140, mount: 'Corridor ceiling' },
    { id: 'A8', reader: 'FXR-A', port: 8, model: 'AN520', zone: 'fitting', x: 895, y: 305, mount: 'Corridor ceiling' },
    { id: 'B1', reader: 'FXR-B', port: 1, model: 'AN520', zone: 'clearance', x: 185, y: 120, mount: 'Ceiling, below false ceiling' },
    { id: 'B2', reader: 'FXR-B', port: 2, model: 'AN520', zone: 'clearance', x: 210, y: 268, mount: 'Ceiling, below false ceiling' },
    { id: 'B3', reader: 'FXR-B', port: 3, model: 'AN520', zone: 'children', x: 385, y: 348, mount: 'Ceiling, below false ceiling' },
    { id: 'B4', reader: 'FXR-B', port: 4, model: 'AN670', zone: 'accessories', x: 578, y: 298, mount: 'Under accessories table' },
    { id: 'B5', reader: 'FXR-B', port: 5, model: 'AN520', zone: 'womens', x: 596, y: 374, mount: 'Ceiling, below false ceiling' },
    { id: 'B6', reader: 'FXR-B', port: 6, model: 'AN670', zone: 'cashwrap', x: 806, y: 334, mount: 'Under cash wrap counter' },
    { id: 'B7', reader: 'FXR-B', port: 7, model: 'AN510', zone: 'entrance', portal: 'entrance', side: 'inner', x: 888, y: 434, mount: 'Entrance, store side' },
    { id: 'B8', reader: 'FXR-B', port: 8, model: 'AN510', zone: 'entrance', portal: 'entrance', side: 'outer', x: 872, y: 494, mount: 'Entrance, mall side' }
  ];

  // out = inner -> outer.
  const PORTALS = [
    { id: 'boh-door', name: 'Stockroom door', outLabel: 'Stockroom → floor', inLabel: 'Floor → stockroom' },
    { id: 'entrance', name: 'Entrance', outLabel: 'Left the store', inLabel: 'Came into the store' }
  ];

  const PARAMS = {
    windowSec: 10,          // FXR90 report window used to aggregate reads
    confirmWindows: 2,      // windows in a row a new zone must win before an item moves
    marginDb: 6,            // or win by this many dB in one window
    strongDbm: -60,         // a lone read this strong moves an item at once
    portalPairSec: 8,       // inner and outer reads within this gap give a direction
    portalMinDbm: -65,      // weaker portal reads are ignored for direction
    refTagPrefix: 'FFFF',   // fixed reference tags beside doorway antennas: health check only, not stock
    portalCooldownSec: 30,
    missingAfterSec: 4 * 3600,
    misplacedAfterSec: 15 * 60,
    leftInFittingSec: 15 * 60,
    antennaSilentSec: 10 * 60,
    frSessionGapSec: 45,
    replenCycleHours: 4
  };

  // Illustrative catalogue (no customer data). face = units the fixture should show per size.
  const CATALOGUE = [
    { sku: '526', name: 'Mesh polo, custom slim fit', color: 'Navy', hex: '#22355E', zone: 'polo', cat: "Men's polo", price: 690, face: 4 },
    { sku: '527', name: 'Mesh polo, custom slim fit', color: 'White', hex: '#EEEEEA', zone: 'polo', cat: "Men's polo", price: 690, face: 4 },
    { sku: '528', name: 'Mesh polo, custom slim fit', color: 'Red', hex: '#A4262C', zone: 'polo', cat: "Men's polo", price: 690, face: 3 },
    { sku: '529', name: 'Mesh polo, custom slim fit', color: 'Green', hex: '#1F6B45', zone: 'polo', cat: "Men's polo", price: 690, face: 3 },
    { sku: '531', name: 'Oxford shirt, classic fit', color: 'Blue', hex: '#8FB0D9', zone: 'mens', cat: "Men's shirts", price: 790, face: 3 },
    { sku: '315', name: 'Cable-knit cotton sweater', color: 'Cream', hex: '#E6DCC4', zone: 'mens', cat: "Men's knitwear", price: 1290, face: 3 },
    { sku: '316', name: 'Cable-knit cotton sweater', color: 'Navy', hex: '#26375A', zone: 'mens', cat: "Men's knitwear", price: 1290, face: 3 },
    { sku: '342', name: 'Quilted jacket', color: 'Olive', hex: '#5B6140', zone: 'mens', cat: "Men's outerwear", price: 2290, face: 2 },
    { sku: '351', name: 'Stretch chino, slim fit', color: 'Khaki', hex: '#C3A97A', zone: 'mens', cat: "Men's trousers", price: 890, face: 3, sizes: ['30', '32', '34', '36'] },
    { sku: '402', name: 'Floral summer dress', color: 'Blue floral', hex: '#6C8EBF', zone: 'womens', cat: "Women's dresses", price: 1590, face: 2, sizes: ['XS', 'S', 'M', 'L'] },
    { sku: '405', name: 'Polo shirt dress', color: 'Navy', hex: '#26375A', zone: 'womens', cat: "Women's dresses", price: 1190, face: 2, sizes: ['XS', 'S', 'M', 'L'] },
    { sku: '411', name: 'Cable-knit cardigan', color: 'Pink', hex: '#E3A9B4', zone: 'womens', cat: "Women's knitwear", price: 1390, face: 3, sizes: ['XS', 'S', 'M', 'L'] },
    { sku: '418', name: 'Linen shirt, relaxed fit', color: 'White', hex: '#F1F0EA', zone: 'womens', cat: "Women's shirts", price: 890, face: 3, sizes: ['XS', 'S', 'M', 'L'] },
    { sku: '602', name: 'Kids mesh polo', color: 'Yellow', hex: '#E8C547', zone: 'children', cat: 'Children', price: 390, face: 3, sizes: ['4', '6', '8', '10'] },
    { sku: '603', name: 'Kids mesh polo', color: 'Navy', hex: '#26375A', zone: 'children', cat: 'Children', price: 390, face: 3, sizes: ['4', '6', '8', '10'] },
    { sku: '611', name: 'Kids fleece hoodie', color: 'Grey', hex: '#9AA0A6', zone: 'children', cat: 'Children', price: 590, face: 2, sizes: ['4', '6', '8', '10'] },
    { sku: '702', name: 'Twill baseball cap', color: 'Navy', hex: '#26375A', zone: 'accessories', cat: 'Accessories', price: 390, face: 6, sizes: ['One size'] },
    { sku: '703', name: 'Twill baseball cap', color: 'Tan', hex: '#C8A878', zone: 'accessories', cat: 'Accessories', price: 390, face: 6, sizes: ['One size'] },
    { sku: '711', name: 'Crew socks, 3-pack', color: 'White', hex: '#F2F2EE', zone: 'accessories', cat: 'Accessories', price: 190, face: 8, sizes: ['One size'] },
    { sku: '812', name: 'Oxford shirt, last season', color: 'Pink', hex: '#E6B7C1', zone: 'clearance', cat: 'Clearance', price: 490, face: 4 },
    { sku: '815', name: 'Pima polo, last season', color: 'Grey', hex: '#9AA0A6', zone: 'clearance', cat: 'Clearance', price: 450, face: 4 },
    { sku: '821', name: 'Fair Isle sweater, last season', color: 'Red', hex: '#9E2B2F', zone: 'clearance', cat: 'Clearance', price: 790, face: 3 }
  ];
  CATALOGUE.forEach(c => { if (!c.sizes) c.sizes = ['S', 'M', 'L', 'XL']; });

  function defaultConfig() {
    return JSON.parse(JSON.stringify({ store: STORE, zones: ZONES, readers: READERS, antennas: ANTENNAS, portals: PORTALS, params: PARAMS }));
  }

  return { ANTENNA_MODELS, READER_MODELS, CATALOGUE, defaultConfig };
});
