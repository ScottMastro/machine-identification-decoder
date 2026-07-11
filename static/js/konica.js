// Konica Minolta tab: one real 16x24 dot grid (the source of truth) with the
// 30 decode blocks drawn on top as aesthetic rectangles. Clicking any dot
// toggles it and re-decodes live. No file needed.
// Decoding logic lives in konica-decode.js (the single source of truth).

const KONICA_GRID_ROWS = 16;
const KONICA_GRID_COLS = 24;

// The upside-down "L" registration marker: three dots that anchor the pattern
// and are present on every page (see "Basics of the code" in the PDF, and the
// empirical check across the sample set). These are always colored and locked.
//   (0,0) = box 0's dot (always 0)   (0,2) and (3,0) = out-of-box marker dots
const KONICA_MARKER_CELLS = [[0, 0], [0, 2], [3, 0]];

// Boxes that never hold data: 0 is the marker anchor; 1 and 6 are always-empty
// spacers. None of these are user-editable.
const KONICA_LOCKED_BOXES = new Set([0, 1, 6]);

// The raw 16x24 dot matrix is the source of truth. konicaBoxValues (box -> 0-5)
// is derived from it for decoding and the blocks / mini-block views.
const KONICA_MARKER_SET = new Set(KONICA_MARKER_CELLS.map(([r, c]) => r + ',' + c));
let konicaMatrix = konicaBlankMatrix();

// Current dot (0-5) selected in each editable box; absent = empty. Derived from
// konicaMatrix via syncKonicaBoxValues().
let konicaBoxValues = {};

// Which board view is shown: 'blocks' = rectangles + one-dot-per-box input;
// 'grid' = a plain uniform grid where any dot toggles freely (like the source
// Python tool), which is easier when transcribing a raw dot pattern.
let konicaView = 'blocks';

// Name of the loaded sample/file (drives the exported image's filename); null
// when the board was cleared or hand-edited from blank.
let currentKonicaSampleName = null;

// A fresh matrix with only the locked registration marker set.
function konicaBlankMatrix() {
  const m = Array.from({ length: 16 }, () => new Array(24).fill(0));
  for (const cell of new Set([[0, 0], [0, 2], [3, 0]].map(([r, c]) => r + ',' + c))) {
    const [r, c] = cell.split(',').map(Number);
    m[r][c] = 1;
  }
  return m;
}

// Build a matrix from a parsed grid, forcing the marker cells on.
function konicaMatrixFromGrid(g) {
  const m = konicaBlankMatrix();
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 24; c++) {
      if (g[r] && g[r][c]) m[r][c] = 1;
    }
  }
  return m;
}

// Recompute the derived box values (box -> 0-5) from the raw matrix.
function syncKonicaBoxValues() {
  const oneHot = extractKonicaBlocks(konicaMatrix);
  konicaBoxValues = {};
  for (let id = 0; id < 30; id++) {
    if (KONICA_LOCKED_BOXES.has(id)) continue; // marker anchor + spacers
    if (oneHot[id] !== null) konicaBoxValues[id] = oneHot[id];
  }
}

// Which decoding scheme to apply. 'old' = model number + timestamp (printers
// made before ~2007); 'new' = full serial number + checksums (2013+). The board
// itself is identical either way — only the decode interpretation changes.
let konicaCodeType = 'new';

const KONICA_MODE_HINTS = {
  old: 'Model code + print timestamp. Used by printers made before ~2007.',
  new: 'Full serial number, brand, region &amp; model. Used by printers made ~2013+.',
};

// Pseudo-box id for the brand's low digit. The real box is ONE of the always-5
// boxes (4, 5, 23-26) but is unidentifiable while every known sample is brand
// Konica ('0' = pair 1,5 — they all read 5). Rendered as a "?" mini-block whose
// value is fixed to 5; replace with the real box id once a non-Konica sample
// reveals it.
const KONICA_BRAND_LO = '?';

// New-code boxes that hold the same value on every known sample (null = blank).
// They carry no serial data, but they act as a sanity check: a box that differs
// means the pattern was mis-traced (or this printer breaks the pattern).
// Verified invariant across all new-code samples in the dataset.
const KONICA_NEW_CONSTANTS = {
  0: 0, 1: null, 4: 5, 5: 5, 6: null, 18: 0, 23: 5, 24: 5, 25: 5, 26: 5,
};

// Display order: the marker/blank/zero boxes first (0, 1, 6, 18), then the
// always-5 boxes in numerical order.
const KONICA_NEW_CONSTANT_ORDER = [0, 1, 6, 18, 4, 5, 23, 24, 25, 26];

// What each box means under each scheme, used to color the rectangles/mini-
// blocks and to build the legend. Order here is the legend order. Every box
// 0-29 is assigned exactly one category per mode.
const KONICA_FIELD_CATEGORIES = {
  new: [
    { key: 'serial',   label: 'Series &amp; model', boxes: [2, 3, 7, 10, 11, 15] },
    { key: 'brand',    label: 'Brand',              boxes: [27] },
    { key: 'region',   label: 'Region',             boxes: [21, 22] },
    { key: 'submodel', label: 'Sub-model',          boxes: [17, 16] },
    { key: 'batchnum', label: 'Batch &amp; number', boxes: [8, 9, 12, 13, 14, 19, 20] },
    { key: 'checksum', label: 'Checksum',           boxes: [28, 29] },
    { key: 'constant', label: 'Constant',           boxes: [0, 1, 4, 5, 6, 18, 23, 24, 25, 26] },
  ],
  old: [
    { key: 'model',    label: 'Model code',         boxes: [2, 3, 7] },
    { key: 'time',     label: 'Timestamp',          boxes: [4, 5, 10, 11, 15, 24, 25, 26] },
    { key: 'parity',   label: 'Parity (mirrored)',  boxes: [8, 9, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 27, 28, 29] },
    { key: 'constant', label: 'Constant',           boxes: [0, 1, 6] },
  ],
};

// Field sections for the "Blocks by field" panel. Each section is a decoded
// field; its `parts` list the boxes IN CONSUMPTION ORDER (not array order),
// grouped into the combinations the decoder actually reads. `conv` says how a
// part's boxes translate into a value:
//   'cypher' - two boxes concatenated as a DECIMAL key -> cypher character
//   'base6'  - N boxes read as one base-6 number -> base-10
//   'mirror' - a mirrored parity pair; the two boxes should match
//   'none'   - shown as-is (checksums, constants, spacers)
// Section/part order and box grouping mirror konica-decode.js and the reference
// PDF ("Deciphering the Konica Minolta MIC Dots", Donovan R.).
const KONICA_SECTIONS = {
  new: [
    { key: 'serial', label: 'Series &amp; model', note:
        'Each character = two boxes read as a decimal key, then looked up in the cypher. '
        + 'Every serial also starts with a fixed &ldquo;A&rdquo; that isn&rsquo;t encoded in the '
        + 'dots, so it&rsquo;s dropped here (but kept in the full serial above).', parts: [
      { boxes: [7, 3],  conv: 'cypher', label: '2nd char' },
      { boxes: [2, 15], conv: 'cypher', label: '3rd char' },
      { boxes: [11, 10], conv: 'cypher', label: '4th char' },
    ] },
    { key: 'brand',    label: 'Brand', note:
        'Box&nbsp;27 is the high digit. The low digit is <em>one of</em> the always-5 boxes '
        + '(4, 5, 23&ndash;26) &mdash; every known sample is brand Konica (&ldquo;0&rdquo; = pair 1,5), so '
        + 'all six read 5 and the real box can&rsquo;t be identified yet. Shown as &ldquo;?&rdquo; with '
        + 'its value fixed to 5 until a non-Konica sample settles it.', parts: [
      { boxes: [27, KONICA_BRAND_LO], conv: 'cypher', label: 'brand' },
    ] },
    { key: 'region',   label: 'Region',    parts: [{ boxes: [22, 21], conv: 'cypher', label: 'region' }] },
    { key: 'submodel', label: 'Sub-model', parts: [{ boxes: [17, 16], conv: 'cypher', label: 'sub-model' }] },
    { key: 'batchnum', label: 'Batch &amp; number', note:
        'Seven boxes read as one base-6 number &rarr; base-10, padded to 6 digits: '
        + 'first three = batch, last three = number.', parts: [
      { boxes: [19, 20, 12, 13, 14, 8, 9], conv: 'base6', pad: 6, split: true, label: 'batch + number' },
    ] },
    { key: 'checksum', label: 'Checksum', note:
        'Box&nbsp;28 checks the model boxes (2,3,7,10,11,15); box&nbsp;29 checks the serial '
        + 'boxes (8,9,12,13,14,16,17,18,19,20,21,22,?,27). Each = (6 &minus; &Sigma; mod 6) mod 6.', parts: [
      { boxes: [28], conv: 'none', label: 'model check' },
      { boxes: [29], conv: 'none', label: 'serial check' },
    ] },
    { key: 'constant', label: 'Constant', parts: [{ boxes: [0, 1, 4, 5, 6, 18, 23, 24, 25, 26], conv: 'none' }] },
  ],
  old: [
    { key: 'model', label: 'Model code', note:
        'Boxes 7,3,2 read as base-6 &rarr; base-10 (box&nbsp;7 is always 0).', parts: [
      { boxes: [7, 3, 2], conv: 'base6', label: 'model code' },
    ] },
    { key: 'time', label: 'Timestamp', note:
        'Each field = two boxes as base-6 &rarr; base-10. Add 1990 to the year; the hour is '
        + '24-hour. Most printers leave these all 5 (no timestamp recorded).', parts: [
      { boxes: [15, 11], conv: 'base6', label: 'year' },
      { boxes: [10, 5],  conv: 'base6', label: 'month' },
      { boxes: [4, 26],  conv: 'base6', label: 'day' },
      { boxes: [25, 24], conv: 'base6', label: 'hour' },
    ] },
    { key: 'parity', label: 'Parity (mirrored)', note:
        'The old code repeats values in mirrored box pairs; each pair should match.', parts: [
      { boxes: [16, 18], conv: 'mirror' }, { boxes: [14, 27], conv: 'mirror' },
      { boxes: [17, 19], conv: 'mirror' }, { boxes: [8, 28],  conv: 'mirror' },
      { boxes: [9, 29],  conv: 'mirror' }, { boxes: [20, 21], conv: 'mirror' },
      { boxes: [12, 22], conv: 'mirror' }, { boxes: [13, 23], conv: 'mirror' },
    ] },
    { key: 'constant', label: 'Constant', parts: [{ boxes: [0, 1, 6], conv: 'none' }] },
  ],
};

// The full serial number laid out on ONE row, in serial-character order. Each
// column is one field; reading the resolved values left to right spells the
// serial (e.g. A7 · PU · 0 · 0 · 1 · 006799 = A7PU001006799). `cat` picks the
// accent color; `boxes` are the dots feeding that field; `value` pulls the
// resolved chunk from the decoded serial. Batch & number share one base-6
// value across the same seven boxes, so they stay a single column.
const KONICA_SERIAL_ROW = [
  { cat: 'serial',   label: 'Series',           boxes: [7, 3],                      value: s => s.series.slice(1),
    meaning: () => null },
  { cat: 'serial',   label: 'Model',            boxes: [2, 15, 11, 10],             value: s => s.model,
    meaning: (s, nc) => nc.model ? nc.model.make + ' ' + nc.model.model : null },
  { cat: 'brand',    label: 'Brand',            boxes: [27, KONICA_BRAND_LO],       value: s => s.brand.digit,
    meaning: s => s.brand.name },
  { cat: 'region',   label: 'Region',           boxes: [22, 21],                    value: s => s.region.digit,
    meaning: s => s.region.name },
  { cat: 'submodel', label: 'Sub-model',        boxes: [17, 16],                    value: s => s.subModel,
    meaning: () => null },
  { cat: 'batchnum', label: 'Batch',            boxes: [19, 20, 12],                value: s => s.batch,
    meaning: () => null },
  { cat: 'batchnum', label: 'Number',           boxes: [13, 14, 8, 9],              value: s => s.number,
    meaning: () => null },
];

// Box id -> category key for the active scheme.
function konicaCategoryMap(mode) {
  const map = {};
  for (const cat of KONICA_FIELD_CATEGORIES[mode]) {
    for (const b of cat.boxes) map[b] = cat.key;
  }
  return map;
}

// Field categories whose color is currently hidden (toggled off via the legend).
let konicaHiddenColors = new Set();

// Resolve a box's display category, collapsing to the neutral color if hidden.
function konicaShownCat(cls) {
  return konicaHiddenColors.has(cls) ? 'default' : cls;
}

// Build the legend chips for the active scheme. Each chip is a toggle that
// shows/hides that field's color on the board and mini-blocks.
function konicaLegendHTML() {
  return KONICA_FIELD_CATEGORIES[konicaCodeType]
    .map(c => {
      const off = konicaHiddenColors.has(c.key) ? ' kchip-off' : '';
      return '<button type="button" class="kchip kfield-' + c.key + off
        + '" onclick="toggleKonicaColor(\'' + c.key + '\')">' + c.label + '</button>';
    })
    .join(' ');
}

// Toggle a field category's color on/off, then repaint everything it colors.
function toggleKonicaColor(key) {
  if (konicaHiddenColors.has(key)) konicaHiddenColors.delete(key);
  else konicaHiddenColors.add(key);
  renderKonicaLegends();
  renderKonicaBoard();
  renderKonicaBlocksView();
}

// Paint the legend into the top (board) section. The Decoded section is always
// fully colored, so it has no legend of its own.
function renderKonicaLegends() {
  const el = document.getElementById('konica-legend-top');
  if (el) el.innerHTML = konicaLegendHTML();
}

// Grid placement helpers (CSS grid is 1-indexed). Rows never wrap; only the
// last-column box wraps horizontally.
function konicaGridRow(r) { return String(r + 1); }
function konicaGridCol(c) { return String((c % KONICA_GRID_COLS) + 1); }

// Map every grid cell to its role. Cells inside an editable box are fillable;
// marker cells are the locked L; everything else is an unfillable placeholder.
function konicaCellRoles() {
  const roles = {}; // "r,c" -> {kind:'fill', id, val} | {kind:'marker'}
  for (const [r, c] of KONICA_MARKER_CELLS) roles[r + ',' + c] = { kind: 'marker' };
  for (const [idStr, pos] of Object.entries(KONICA_BLOCK_POSITIONS)) {
    const id = Number(idStr);
    if (KONICA_LOCKED_BOXES.has(id)) continue; // marker anchor + spacers
    const [r, c] = pos;
    for (let val = 0; val < 6; val++) {
      const rr = r + Math.floor(val / 2);
      const cc = (c + (val % 2)) % KONICA_GRID_COLS;
      roles[rr + ',' + cc] = { kind: 'fill', id, val };
    }
  }
  return roles;
}

function renderKonicaBoard() {
  const board = document.getElementById('konica-board');
  board.innerHTML = '';
  board.classList.toggle('konica-board--grid', konicaView === 'grid');
  if (konicaView === 'grid') { renderKonicaGridView(board); return; }
  const roles = konicaCellRoles();
  const catMap = konicaCategoryMap(konicaCodeType);

  // Layer 1: one element per cell across the full 16x24 grid, so every
  // position is visible. Fillable positions are clickable; the marker is a
  // locked colored dot; all other positions are shown faint and unfillable.
  for (let r = 0; r < KONICA_GRID_ROWS; r++) {
    for (let c = 0; c < KONICA_GRID_COLS; c++) {
      const role = roles[r + ',' + c];
      let dot;
      if (role && role.kind === 'fill') {
        dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'kdot' + (konicaBoxValues[role.id] === role.val ? ' active' : '');
        dot.addEventListener('click', () => onKonicaCellClick(role.id, role.val));
      } else if (role && role.kind === 'marker') {
        dot = document.createElement('div');
        dot.className = 'kdot kdot-marker';
        dot.title = 'Registration marker (always present)';
      } else {
        dot = document.createElement('div');
        dot.className = 'kdot kdot-empty';
        dot.title = 'No dot position here';
      }
      dot.style.gridRow = konicaGridRow(r);
      dot.style.gridColumn = konicaGridCol(c);
      board.appendChild(dot);
    }
  }

  // Layer 2: the block rectangles, drawn on the same CSS grid so they align to
  // the tracks exactly. Purely aesthetic — pointer-events are off so clicks
  // fall through to the dots underneath.
  for (const [id, pos] of Object.entries(KONICA_BLOCK_POSITIONS)) {
    const [r, c] = pos;
    const cls = konicaShownCat(catMap[id] || 'default');
    // A block is 2 columns wide; the last-column block (23) wraps the edge, so
    // it becomes two half-rectangles at the right and left of the grid.
    const spans = c + 1 < KONICA_GRID_COLS
      ? [[c + 1, 2]]
      : [[KONICA_GRID_COLS, 1], [1, 1]];
    spans.forEach(([gcol, gspan], i) => {
      const rect = document.createElement('div');
      rect.className = 'krect krect-' + cls;
      rect.style.gridRow = (r + 1) + ' / span 3';
      rect.style.gridColumn = gcol + ' / span ' + gspan;
      if (i === 0) {
        const label = document.createElement('span');
        label.className = 'krect-label';
        label.textContent = id;
        rect.appendChild(label);
      }
      board.appendChild(rect);
    });
  }
}

// The base-6 digit currently in a box (box 0 is the marker anchor, always 0;
// null = empty box).
function konicaDigit(id) {
  if (id === KONICA_BRAND_LO) return 5; // unidentified always-5 box (see KONICA_BRAND_LO)
  if (id === 0) return 0;
  return id in konicaBoxValues ? konicaBoxValues[id] : null;
}

// One mini-block: the 3x2 dot grid for a box, outlined in its field color, with
// the base-10 digit it encodes below. `forceColor` keeps the field color even
// when it's been toggled off on the board (used in the always-colored Decoded
// section).
function konicaMiniBlock(id, forceColor) {
  const catMap = konicaCategoryMap(konicaCodeType);
  const val = konicaDigit(id);
  const raw = id === KONICA_BRAND_LO ? 'brand' : (catMap[id] || 'default');
  const cls = forceColor ? raw : konicaShownCat(raw);

  const block = document.createElement('div');
  block.className = 'kblock kblock-' + cls;
  if (id === KONICA_BRAND_LO) {
    block.title = 'One of the always-5 boxes (4, 5, 23–26). Which one carries the '
      + 'brand’s low digit is unknown — value fixed to 5 until a non-Konica '
      + 'sample identifies it.';
  }

  const head = document.createElement('div');
  head.className = 'kblock-id';
  head.textContent = id;
  block.appendChild(head);

  const cells = document.createElement('div');
  cells.className = 'kblock-cells';
  for (let v = 0; v < 6; v++) {
    const cell = document.createElement('div');
    cell.className = 'kblock-cell' + (val === v ? ' filled' : '');
    cells.appendChild(cell);
  }
  block.appendChild(cells);

  const digit = document.createElement('div');
  digit.className = 'kblock-digit' + (val === null ? ' empty' : '');
  digit.textContent = val === null ? '·' : String(val);
  block.appendChild(digit);
  return block;
}

// The translation text for one part: base-6 -> base-10, decimal-key -> cypher
// character, or a mirrored-pair match check.
function konicaConvText(part) {
  const ds = part.boxes.map(konicaDigit);
  const incomplete = ds.some(d => d == null);

  if (part.conv === 'cypher') {
    if (incomplete) return '&rarr; <span class="kconv-inc">&hellip;</span>';
    const key = ds[0] * 10 + ds[1];
    const ch = KONICA_CYPHER[key];
    return '&rarr; <span class="kconv-key">' + key + '</span> &rarr; '
      + '<span class="kconv-out">' + (ch === undefined ? '?' : ch) + '</span>';
  }
  if (part.conv === 'base6') {
    if (incomplete) return '&rarr; <span class="kconv-inc">&hellip;</span>';
    const b6 = ds.join('');
    let decStr = String(parseInt(b6, 6));
    if (part.pad) decStr = decStr.padStart(part.pad, '0');
    let out = '&rarr; <span class="kconv-key">' + b6 + '<sub>6</sub></span> &rarr; '
      + '<span class="kconv-out">' + decStr + '</span>';
    if (part.split) out += ' <span class="kconv-split">(' + decStr.slice(0, 3)
      + ' &middot; ' + decStr.slice(3) + ')</span>';
    return out;
  }
  if (part.conv === 'mirror') {
    if (incomplete) return '<span class="kconv-inc">pair</span>';
    return ds[0] === ds[1]
      ? '<span class="parity-ok">&#10003;</span>'
      : '<span class="parity-err">&#10007;</span>';
  }
  return '';
}

// One part: its boxes (in consumption order), the translation, and a label.
function konicaRenderPart(part, forceColor) {
  const wrap = document.createElement('div');
  wrap.className = 'kpart';

  const boxes = document.createElement('div');
  boxes.className = 'kpart-boxes';
  for (const id of part.boxes) boxes.appendChild(konicaMiniBlock(id, forceColor));
  wrap.appendChild(boxes);

  if (part.conv && part.conv !== 'none') {
    const conv = document.createElement('div');
    conv.className = 'kpart-conv';
    conv.innerHTML = konicaConvText(part);
    wrap.appendChild(conv);
  }
  if (part.label) {
    const lab = document.createElement('div');
    lab.className = 'kpart-label';
    lab.textContent = part.label;
    wrap.appendChild(lab);
  }
  return wrap;
}

// The oneHot map (box -> 0-5 or null) for the current board.
function konicaCurrentOneHot() {
  const oneHot = {};
  for (let id = 0; id < 30; id++) {
    oneHot[id] = id === 0 ? 0 : (id in konicaBoxValues ? konicaBoxValues[id] : null);
  }
  return oneHot;
}

// The resolved value shown at the right of a section header (null = nothing to
// show yet). Ties the per-part translations together into the decoded field.
function konicaSectionSummary(key, oneHot) {
  if (konicaCodeType === 'new') {
    const s = decodeKonicaNewCode(oneHot).serial;
    switch (key) {
      case 'serial':   return s.seriesModel.slice(1); // drop the implicit leading "A" (not dot-encoded)
      case 'brand':    return s.brand.digit == null ? null : s.brand.digit + ' &middot; ' + s.brand.name;
      case 'region':   return s.region.digit == null ? null : s.region.digit + ' &middot; ' + s.region.name;
      case 'submodel': return s.subModel == null ? null : String(s.subModel);
      case 'batchnum': return s.batchNumber == null ? null : s.batch + ' &middot; ' + s.number;
      default:         return null;
    }
  }
  if (key === 'model') return String(decodeKonicaModelCode(oneHot).code);
  if (key === 'time') {
    const rd = bx => { const ds = bx.map(konicaDigit); return ds.some(d => d == null) ? null : parseInt(ds.join(''), 6); };
    const y = rd([15, 11]), mo = rd([10, 5]), d = rd([4, 26]), h = rd([25, 24]);
    const out = [];
    if (d != null && mo != null && mo >= 1 && mo <= 12) out.push(d + ' ' + KONICA_MONTHS[mo]);
    else if (mo != null && mo >= 1 && mo <= 12) out.push(KONICA_MONTHS[mo]);
    if (y != null) out.push(String(1990 + y));
    if (h != null && h >= 0 && h < 24) out.push(String(h).padStart(2, '0') + ':00');
    return out.length ? out.join(' &middot; ') : null;
  }
  if (key === 'parity') {
    let ok = 0, tot = 0;
    for (const p of KONICA_SECTIONS.old.find(s => s.key === 'parity').parts) {
      const a = konicaDigit(p.boxes[0]), b = konicaDigit(p.boxes[1]);
      if (a != null && b != null) { tot++; if (a === b) ok++; }
    }
    return tot ? ok + '/' + tot + ' match' : null;
  }
  return null;
}

// Read-only "blocks by field" view: the same dot data, grouped into its decoded
// fields (each field's boxes in consumption order), showing the base-6 -> base-10
// and cypher translations, plus the resolved value per field.
// One horizontal strip: the full serial number, field by field, in serial
// order. Reading the value under each column spells A7PU001006799.
function renderKonicaSerialStrip(oneHot) {
  const nc = decodeKonicaNewCode(oneHot);
  const s = nc.serial;
  const row = document.createElement('div');
  row.className = 'kserial-row';

  for (const col of KONICA_SERIAL_ROW) {
    const cell = document.createElement('div');
    cell.className = 'kscol kscol-' + col.cat;

    const lab = document.createElement('div');
    lab.className = 'kscol-label';
    lab.innerHTML = col.label;
    cell.appendChild(lab);

    const boxes = document.createElement('div');
    boxes.className = 'kscol-boxes';
    for (const id of col.boxes) boxes.appendChild(konicaMiniBlock(id, true));
    cell.appendChild(boxes);

    const v = col.value(s);
    const val = document.createElement('div');
    val.className = 'kscol-value';
    val.textContent = (v == null || String(v).indexOf('?') !== -1) ? '—' : v;
    cell.appendChild(val);

    // The decoded meaning of that value, where the decoder knows it.
    const m = col.meaning ? col.meaning(s, nc) : null;
    const mean = document.createElement('div');
    mean.className = 'kscol-meaning';
    if (m == null || String(m).indexOf('?') !== -1) mean.classList.add('empty');
    else mean.innerHTML = m;
    cell.appendChild(mean);

    row.appendChild(cell);
  }
  return row;
}

// A "Decoded" summary bar: one or more label/value pairs (e.g. Serial number,
// or Model code / Base-6 / Introduced).
function konicaDecodedBar(fields) {
  const bar = document.createElement('div');
  bar.className = 'decoded-bar';
  for (const f of fields) {
    const fd = document.createElement('div');
    fd.className = 'decoded-field';
    fd.innerHTML = '<span class="decoded-label">' + f.label + '</span>'
      + '<span class="decoded-value">' + f.value + '</span>';
    bar.appendChild(fd);
  }
  return bar;
}

// A subheading + a <ul class="konica-models"> of lines.
function konicaSubsection(title, itemsHTML) {
  const frag = document.createDocumentFragment();
  const h = document.createElement('h3');
  h.className = 'konica-subhead';
  h.innerHTML = title;
  frag.appendChild(h);
  const ul = document.createElement('ul');
  ul.className = 'konica-models';
  ul.innerHTML = itemsHTML;
  frag.appendChild(ul);
  return frag;
}

// One checksum row: the boxes being summed (with their values), the expected
// check digit that sum produces, the value actually read from the check box,
// and a check / cross. `checkBoxes` are the data boxes summed; `checkBox` is
// the box that stores the resulting digit.
function konicaChecksumRow(label, checkBoxes, checkBox, c, oneHot) {
  if (c.expected == null || c.actual == null) {
    return '<li class="muted">' + label + ' (box ' + checkBox + '): not enough dots to verify</li>';
  }
  const sum = checkBoxes.reduce((a, b) => a + (b === KONICA_BRAND_LO ? konicaDigit(b) : oneHot[b]), 0);
  // Each summed box as a full mini-block, just like the serial strip above.
  const terms = checkBoxes.map(b => konicaMiniBlock(b, true).outerHTML)
    .join('<span class="kck-op">+</span>');
  const tag = c.ok
    ? '<span class="parity-ok">&#10003;</span>'
    : '<span class="parity-err">&#10007;</span>';
  // The check box itself, also a mini-block, shown to the right of the result.
  const checkBlock = konicaMiniBlock(checkBox, true).outerHTML;
  return '<li class="kck-item">'
    + '<div class="kck-label">' + label + '</div>'
    + '<div class="kck-row">'
    + '<span class="kck-sum">' + terms
    + '<span class="kck-op">=</span><span class="kck-total">' + sum + '</span></span>'
    + '<span class="kck-exp">mod 6 = <b>' + c.expected + '</b></span>'
    + '<span class="kck-arrow">&rarr;</span>' + checkBlock
    + tag
    + '</div>'
    + '</li>';
}

// The constant boxes, shown as a check: each should hold its fixed value, so a
// deviation flags a mis-traced pattern even though these boxes carry no serial.
function konicaConstantsRow(oneHot) {
  const cells = KONICA_NEW_CONSTANT_ORDER.map(b => {
    const exp = KONICA_NEW_CONSTANTS[b];
    const got = oneHot[b] == null ? null : oneHot[b];
    const match = got === exp;
    const mark = match
      ? '<span class="parity-ok">&#10003;</span>'
      : '<span class="parity-err">&#10007;</span>';
    return '<span class="kconst" title="box ' + b + ' &mdash; expected '
      + (exp == null ? 'blank' : exp) + '">'
      + konicaMiniBlock(b, true).outerHTML
      + '<span class="kconst-exp">' + (exp == null ? '&middot;' : exp) + ' ' + mark + '</span>'
      + '</span>';
  }).join('');
  return '<li class="kck-item">'
    + '<div class="kck-row">' + cells + '</div>'
    + '</li>'
    + '<li class="kconst-note muted">The value under each box is what it should read &mdash; every '
    + 'known sample holds these same values (blank, 0 or 5). They carry no serial data, but if one '
    + 'differs the pattern was probably mis-traced.</li>';
}

// One field-by-field box (mini-blocks + conversions + resolved value). Always
// colored, since it lives in the always-colored Decoded section. `label`
// overrides the section's own label when given.
function konicaFieldBox(sec, oneHot, label) {
  const field = document.createElement('div');
  field.className = 'kfield kfield-box-' + sec.key;

  const head = document.createElement('div');
  head.className = 'kfield-head';
  const title = document.createElement('span');
  title.className = 'kfield-title';
  title.innerHTML = label != null ? label : sec.label;
  head.appendChild(title);
  const summary = konicaSectionSummary(sec.key, oneHot);
  if (summary != null) {
    const res = document.createElement('span');
    res.className = 'kfield-result';
    res.innerHTML = summary;
    head.appendChild(res);
  }
  field.appendChild(head);

  const parts = document.createElement('div');
  parts.className = 'kfield-parts';
  for (const part of sec.parts) parts.appendChild(konicaRenderPart(part, true));
  field.appendChild(parts);

  if (sec.note) {
    const note = document.createElement('div');
    note.className = 'kfield-note';
    note.innerHTML = sec.note;
    field.appendChild(note);
  }
  return field;
}

function konicaSectionByKey(key) {
  return KONICA_SECTIONS[konicaCodeType].find(s => s.key === key);
}

// The "Decoded" panel. Consolidates the serial/model summary, the field-by-field
// blocks (always colored), and the verification (checksum / parity) into one
// read-only view.
function renderKonicaBlocksView() {
  const host = document.getElementById('konica-blocks');
  if (!host) return;
  host.innerHTML = '';
  const oneHot = konicaCurrentOneHot();
  if (konicaCodeType === 'new') renderKonicaDecodedNew(host, oneHot);
  else renderKonicaDecodedOld(host, oneHot);
}

// New scheme: full serial number, the field-by-field strip, and checksums.
function renderKonicaDecodedNew(host, oneHot) {
  const nc = decodeKonicaNewCode(oneHot);
  host.appendChild(konicaDecodedBar([{ label: 'Serial number', value: nc.serial.full }]));
  host.appendChild(renderKonicaSerialStrip(oneHot));
  const brandNote = document.createElement('div');
  brandNote.className = 'kfield-note';
  brandNote.innerHTML = 'The &ldquo;?&rdquo; box: the brand&rsquo;s second digit sits in one of the '
    + 'constant-5 boxes (4, 5, 23&ndash;26), but every known sample reads 5 there, so which '
    + 'box it is can&rsquo;t be determined yet.';
  host.appendChild(brandNote);
  // The serial sum is displayed with the "?" pseudo-box in place of box 23:
  // the checksum arithmetic proves exactly one always-5 box is summed, but not
  // which one (the decoder uses 23 for the math; the value is 5 either way).
  const serialCheckDisplay = KONICA_SERIAL_CHECK_BOXES.map(b => b === 23 ? KONICA_BRAND_LO : b);
  host.appendChild(konicaSubsection('Checksum (Parity)',
    konicaChecksumRow('Model check', KONICA_MODEL_CHECK_BOXES, 28, nc.checksum.model, oneHot)
    + konicaChecksumRow('Serial check', serialCheckDisplay, 29, nc.checksum.serial, oneHot)));
  const checkNote = document.createElement('div');
  checkNote.className = 'kfield-note';
  checkNote.innerHTML = 'Two boxes in the serial sum are provisional: the &ldquo;?&rdquo; box &mdash; the '
    + 'checksum provably includes exactly one of the always-5 boxes (4, 5, 23&ndash;26), most '
    + 'likely the brand&rsquo;s low digit, but which one is unknown &mdash; and box&nbsp;18, always 0 '
    + 'in every known sample with an unknown role, kept in the sum where a 0 changes nothing.';
  host.appendChild(checkNote);
  host.appendChild(konicaSubsection('Constants', konicaConstantsRow(oneHot)));
}

// Old scheme: model code up top, likely printer, then Date and Parity sections.
function renderKonicaDecodedOld(host, oneHot) {
  const model = decodeKonicaModelCode(oneHot);
  host.appendChild(konicaDecodedBar([
    { label: 'Model code',  value: model.code },
    { label: 'Base&#8209;6', value: model.base6 },
    { label: 'Introduced', value: model.year ? '~' + model.year : '&mdash;' },
  ]));

  const printerHTML = model.models.length
    ? model.models.map(m => '<li>' + m + '</li>').join('')
    : '<li class="muted">Unknown model code &mdash; not in reference table</li>';
  host.appendChild(konicaSubsection('Likely printer', printerHTML));

  host.appendChild(konicaFieldBox(konicaSectionByKey('time'), oneHot, 'Date'));
  host.appendChild(konicaFieldBox(konicaSectionByKey('parity'), oneHot));
}

// Fixed thick grid lines, matching select_dots.py: a thick line to the LEFT of
// these columns and ABOVE these rows. A uniform reference grid, independent of
// the blocks.
const KONICA_THICK_COLS = new Set([3, 6, 9, 12, 15, 18, 21]);
const KONICA_THICK_ROWS = new Set([4, 8, 12]);

// Grid view: a tight square-cell grid like the source Python tool — thin cell
// lines with fixed thick lines at the grid divisions. Only in-block cells are
// fillable (one dot per block); off-block cells are shown but disabled.
function renderKonicaGridView(board) {
  const roles = konicaCellRoles();
  for (let r = 0; r < KONICA_GRID_ROWS; r++) {
    for (let c = 0; c < KONICA_GRID_COLS; c++) {
      const key = r + ',' + c;
      const role = roles[key];
      let cell;
      let cls = 'kcell';
      if (KONICA_THICK_ROWS.has(r)) cls += ' kt'; // thick line above this row
      if (KONICA_THICK_COLS.has(c)) cls += ' kl'; // thick line left of this col
      if (role && role.kind === 'marker') {
        cell = document.createElement('div');
        cell.className = cls + ' kcell-fill filled';
        cell.title = 'Registration marker (always present)';
      } else if (role && role.kind === 'fill') {
        cell = document.createElement('button');
        cell.type = 'button';
        const on = konicaMatrix[r][c] === 1;
        cell.className = cls + ' kcell-fill' + (on ? ' filled' : '');
        cell.addEventListener('click', () => onKonicaCellClick(role.id, role.val));
      } else {
        cell = document.createElement('div');
        cell.className = cls + ' kcell-off';
        cell.title = 'No dot position here';
      }
      cell.style.gridRow = String(r + 1);
      cell.style.gridColumn = String(c + 1);
      board.appendChild(cell);
    }
  }
}

// Blocks view — one dot per box: clicking the active dot clears the box, else
// selects it (clearing any other dot in that box).
function onKonicaCellClick(id, val) {
  const [br, bc] = KONICA_BLOCK_POSITIONS[id];
  const cells = [];
  for (let v = 0; v < 6; v++) {
    cells.push([(br + Math.floor(v / 2)) % KONICA_GRID_ROWS, (bc + (v % 2)) % KONICA_GRID_COLS, v]);
  }
  const [tr, tc] = cells.find(cell => cell[2] === val);
  const already = konicaMatrix[tr][tc] === 1;
  for (const [r, c] of cells) konicaMatrix[r][c] = 0; // one dot per box
  if (!already) konicaMatrix[tr][tc] = 1;
  syncKonicaBoxValues();
  renderKonicaBoard();
  runKonicaDecode();
}

const KONICA_VIEW_HELP = {
  blocks: 'Each box holds exactly one dot &mdash; click a position inside a box to set it '
    + '(its location encodes a digit 0&ndash;5). The yellow upside&#8209;down&nbsp;&ldquo;L&rdquo; '
    + 'is the fixed registration marker. Rectangles are colored by the field each box encodes:',
  grid: 'A tight reference grid like the source tool &mdash; easier for transcribing a raw pattern. '
    + 'Click a cell inside a block to set its dot (one per block); off&#8209;block cells can’t be '
    + 'filled. The yellow&nbsp;&ldquo;L&rdquo; is the fixed registration marker.',
};

// Switch between the Blocks and Grid board views.
function setKonicaView(view) {
  konicaView = view;
  document.querySelectorAll('#konica-view-toggle .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  // Keep the legend shown in both views: it still controls the middle
  // "Blocks (array order)" coloring, and leaving it in place keeps the board
  // in the exact same position/size when toggling views (no layout jump).
  const help = document.getElementById('konica-help-text');
  if (help) help.innerHTML = KONICA_VIEW_HELP[view] || '';
  renderKonicaBoard();
}

function runKonicaDecode() {
  // The Decoded panel now renders the full summary, blocks, and verification.
  renderKonicaBlocksView();
}

// Switch between the Old and New decoding schemes and re-decode.
function setKonicaCodeType(type) {
  konicaCodeType = type;
  document.querySelectorAll('#konica-toggle .konica-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.code === type);
  });
  const hint = document.getElementById('konica-mode-hint');
  if (hint) hint.innerHTML = KONICA_MODE_HINTS[type] || '';
  renderKonicaLegends();
  renderKonicaBoard(); // recolor the rectangles for this scheme
  runKonicaDecode();   // re-decode + recolor the mini-blocks
}

function clearKonica() {
  konicaMatrix = konicaBlankMatrix();
  syncKonicaBoxValues();
  document.getElementById('konica-status').textContent = '';
  const sel = document.getElementById('konica-samples');
  if (sel) sel.value = '';
  currentKonicaSampleName = null;
  if (typeof renderKonicaSampleMeta === 'function') renderKonicaSampleMeta(null);
  renderKonicaBoard();
  runKonicaDecode();
}

// The current 16x24 dot matrix as CSV text — the exact format loadKonicaFile /
// onKonicaSampleSelect parse back in, so a saved grid is round-trippable.
function konicaGridToText() {
  return konicaMatrix.map(row => row.join(',')).join('\n');
}

// The 30 decode rectangles as CSV: box index -> base-6 value (0..5), or -1 when
// the box holds no dot. Just the raw per-rectangle values, no interpretation,
// so it can be the substrate for analysing what each means.
function konicaBoxesToText() {
  const oneHot = konicaCurrentOneHot();
  const lines = ['box,value'];
  for (let id = 0; id < 30; id++) {
    const v = oneHot[id];
    lines.push(id + ',' + (v == null ? -1 : v));
  }
  return lines.join('\n');
}

// The plain black/white grid render, matching the archived select_dots.py
// "Save Grid (PNG)": a black cell per dot on white, gray cell outlines, and
// thick borders after the block-boundary columns/rows. Drawn straight to a
// canvas, so it does not depend on html2canvas or the current board view.
function makeKonicaGridImageBlob() {
  const ROWS = KONICA_GRID_ROWS, COLS = KONICA_GRID_COLS, CS = 40;
  const THICK_COLS = new Set([3, 6, 9, 12, 15, 18, 21]);
  const THICK_ROWS = new Set([4, 8, 12]);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CS;
  canvas.height = ROWS * CS;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      const x = j * CS, y = i * CS;
      ctx.fillStyle = konicaMatrix[i][j] === 1 ? 'black' : 'white';
      ctx.fillRect(x, y, CS, CS);
      ctx.strokeStyle = 'gray';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, CS, CS);   // +0.5 for a crisp 1px line
    }
  }
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 3;
  for (const col of THICK_COLS) {
    const x = col * CS;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ROWS * CS); ctx.stroke();
  }
  for (const row of THICK_ROWS) {
    const y = row * CS;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(COLS * CS, y); ctx.stroke();
  }
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

// Save the current dot layout — a reloadable .txt grid plus a .png visual —
// mirroring the Xerox Save so a hand-traced pattern can be produced and later
// re-uploaded. Prefers the File System Access directory picker, else downloads.
async function saveKonica() {
  const meta = currentKonicaSampleName ? (konicaSampleMeta[currentKonicaSampleName] || null) : null;
  const suggested = (meta && meta.device && meta.id ? meta.device + '.' + meta.id
    : (currentKonicaSampleName ? currentKonicaSampleName.replace(/\.txt$/, '') : 'konica_mic'));
  const name = prompt('File name:', suggested);
  if (name === null) return;
  const prefix = name || 'konica_mic';

  const txtBlob = new Blob([konicaGridToText()], { type: 'text/plain' });
  const boxesBlob = new Blob([konicaBoxesToText()], { type: 'text/plain' });
  const pngBlob = await makeKonicaGridImageBlob();     // plain b/w grid image

  // Download straight to the browser's download folder. The File System Access
  // directory picker is deliberately avoided: Chrome blocks "system" folders
  // (including the localhost project dir), which just fails the save.
  downloadBlob(txtBlob, prefix + '.txt');
  downloadBlob(boxesBlob, prefix + '.boxes.txt');
  if (pngBlob) downloadBlob(pngBlob, prefix + '.png');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Optional: load a real 16x24 grid file and populate the board from it.
function loadKonicaFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('konica-status');
  const reader = new FileReader();
  reader.onload = () => {
    const g = parseKonicaGrid(reader.result);
    if (!g) {
      statusEl.textContent = 'Invalid grid (need 16 rows x 24 columns of 0/1)';
      return;
    }
    konicaMatrix = konicaMatrixFromGrid(g);
    syncKonicaBoxValues();
    currentKonicaSampleName = file.name;
    renderKonicaBoard();
    runKonicaDecode();
    statusEl.textContent = 'Source: ' + file.name;
  };
  reader.onerror = () => { statusEl.textContent = 'Could not read ' + file.name; };
  reader.readAsText(file);
  e.target.value = '';
}

// Render the board immediately so the Konica tab is live without any file.
function initKonica() {
  konicaMatrix = konicaBlankMatrix();
  syncKonicaBoxValues();
  // setKonicaCodeType renders the legends, board, and decode for the initial mode.
  setKonicaCodeType(konicaCodeType);
  setKonicaView('blocks'); // sets the view toggle, help text, and legend visibility
}

// ---------------------------------------------------------------------------
// Decode cypher help modal. Builds the key -> character table straight from
// KONICA_CYPHER (single source of truth) the first time it's opened.
// ---------------------------------------------------------------------------
function buildKonicaCypherGrid() {
  const host = document.getElementById('kcy-grid');
  if (!host || host.childElementCount) return; // build once
  Object.keys(KONICA_CYPHER).map(Number).sort((a, b) => a - b).forEach(key => {
    const ch = KONICA_CYPHER[key];
    const isDigit = /[0-9]/.test(ch);
    const cell = document.createElement('div');
    cell.className = 'kcy-cell ' + (isDigit ? 'digit' : 'letter');
    // Key is two block digits (each 0-5) concatenated, so pad to 2: 00, 01, ... 55.
    cell.innerHTML = '<span class="kcy-key">' + String(key).padStart(2, '0') + '</span>'
      + '<span class="kcy-char">' + ch + '</span>';
    host.appendChild(cell);
  });
}

function openKonicaCypher() {
  buildKonicaCypherGrid();
  const modal = document.getElementById('konica-cypher-modal');
  if (!modal) return;
  modal.hidden = false;
  document.addEventListener('keydown', konicaCypherKeydown);
}

function closeKonicaCypher() {
  const modal = document.getElementById('konica-cypher-modal');
  if (!modal) return;
  modal.hidden = true;
  document.removeEventListener('keydown', konicaCypherKeydown);
}

function konicaCypherKeydown(e) {
  if (e.key === 'Escape') closeKonicaCypher();
}
