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

// What each box means under each scheme, used to color the rectangles/mini-
// blocks and to build the legend. Order here is the legend order. Every box
// 0-29 is assigned exactly one category per mode.
const KONICA_FIELD_CATEGORIES = {
  new: [
    { key: 'serial',   label: 'Series &amp; model', boxes: [2, 3, 7, 10, 11, 15] },
    { key: 'brand',    label: 'Brand',              boxes: [27] },
    { key: 'region',   label: 'Region',             boxes: [21, 22] },
    { key: 'submodel', label: 'Sub-model',          boxes: [17, 18] },
    { key: 'batchnum', label: 'Batch &amp; number', boxes: [8, 9, 12, 13, 14, 19, 20] },
    { key: 'checksum', label: 'Checksum',           boxes: [28, 29] },
    { key: 'constant', label: 'Constant',           boxes: [0, 4, 5, 16, 23, 24, 25, 26] },
    { key: 'spacer',   label: 'Spacer',             boxes: [1, 6] },
  ],
  old: [
    { key: 'model',    label: 'Model code',         boxes: [2, 3, 7] },
    { key: 'time',     label: 'Timestamp',          boxes: [4, 5, 10, 11, 15, 24, 25, 26] },
    { key: 'parity',   label: 'Parity (mirrored)',  boxes: [8, 9, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 27, 28, 29] },
    { key: 'constant', label: 'Constant',           boxes: [0] },
    { key: 'spacer',   label: 'Spacer',             boxes: [1, 6] },
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
        'Implicit leading &ldquo;A&rdquo;; each later character = two boxes read as a '
        + 'decimal key, then looked up in the cypher.', parts: [
      { boxes: [7, 3],  conv: 'cypher', label: '2nd char' },
      { boxes: [2, 15], conv: 'cypher', label: '3rd char' },
      { boxes: [11, 10], conv: 'cypher', label: '4th char' },
    ] },
    { key: 'brand',    label: 'Brand',     parts: [{ boxes: [27, 4],  conv: 'cypher', label: 'brand' }] },
    { key: 'region',   label: 'Region',    parts: [{ boxes: [22, 21], conv: 'cypher', label: 'region' }] },
    { key: 'submodel', label: 'Sub-model', parts: [{ boxes: [17, 18], conv: 'cypher', label: 'sub-model' }] },
    { key: 'batchnum', label: 'Batch &amp; number', note:
        'Seven boxes read as one base-6 number &rarr; base-10, padded to 6 digits: '
        + 'first three = batch, last three = number.', parts: [
      { boxes: [19, 20, 12, 13, 14, 8, 9], conv: 'base6', pad: 6, split: true, label: 'batch + number' },
    ] },
    { key: 'checksum', label: 'Checksum', note:
        'Box&nbsp;28 checks the model boxes (2,3,7,10,11,15); box&nbsp;29 checks the serial '
        + 'boxes (8,9,12,13,14,17,18,19,20,21,22,23,27). Each = (6 &minus; &Sigma; mod 6) mod 6.', parts: [
      { boxes: [28], conv: 'none', label: 'model check' },
      { boxes: [29], conv: 'none', label: 'serial check' },
    ] },
    { key: 'constant', label: 'Constant', parts: [{ boxes: [0, 4, 5, 16, 23, 24, 25, 26], conv: 'none' }] },
    { key: 'spacer',   label: 'Spacer',   parts: [{ boxes: [1, 6], conv: 'none' }] },
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
    { key: 'constant', label: 'Constant', parts: [{ boxes: [0], conv: 'none' }] },
    { key: 'spacer',   label: 'Spacer',   parts: [{ boxes: [1, 6], conv: 'none' }] },
  ],
};

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

// Paint the legend into both the top (board) and middle (blocks) sections.
function renderKonicaLegends() {
  const html = konicaLegendHTML();
  for (const id of ['konica-legend-top', 'konica-legend-mid']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
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
  if (id === 0) return 0;
  return id in konicaBoxValues ? konicaBoxValues[id] : null;
}

// One mini-block: the 3x2 dot grid for a box, outlined in its field color, with
// the base-10 digit it encodes below.
function konicaMiniBlock(id) {
  const catMap = konicaCategoryMap(konicaCodeType);
  const val = konicaDigit(id);
  const cls = konicaShownCat(catMap[id] || 'default');

  const block = document.createElement('div');
  block.className = 'kblock kblock-' + cls;

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
function konicaRenderPart(part) {
  const wrap = document.createElement('div');
  wrap.className = 'kpart';

  const boxes = document.createElement('div');
  boxes.className = 'kpart-boxes';
  for (const id of part.boxes) boxes.appendChild(konicaMiniBlock(id));
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
      case 'serial':   return s.seriesModel;
      case 'brand':    return s.brand.digit == null ? null : s.brand.digit + ' &middot; ' + s.brand.name;
      case 'region':   return s.region.digit == null ? null : s.region.digit + ' &middot; ' + s.region.name;
      case 'submodel': return s.subModel == null ? null : String(s.subModel);
      case 'batchnum': return s.batchNumber == null ? null : s.batch + ' &middot; ' + s.number;
      default:         return null;
    }
  }
  if (key === 'model') return String(decodeKonicaModelCode(oneHot).code);
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
function renderKonicaBlocksView() {
  const host = document.getElementById('konica-blocks');
  if (!host) return;
  host.innerHTML = '';
  const oneHot = konicaCurrentOneHot();

  for (const sec of KONICA_SECTIONS[konicaCodeType]) {
    const field = document.createElement('div');
    field.className = 'kfield kfield-box-' + konicaShownCat(sec.key);

    const head = document.createElement('div');
    head.className = 'kfield-head';
    const title = document.createElement('span');
    title.className = 'kfield-title';
    title.innerHTML = sec.label;
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
    for (const part of sec.parts) parts.appendChild(konicaRenderPart(part));
    field.appendChild(parts);

    if (sec.note) {
      const note = document.createElement('div');
      note.className = 'kfield-note';
      note.innerHTML = sec.note;
      field.appendChild(note);
    }
    host.appendChild(field);
  }
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
  // Build the oneHot map the decoder expects. Box 0 is the marker and always 0;
  // spacers/empty boxes are null.
  const oneHot = {};
  for (let id = 0; id < 30; id++) {
    if (id === 0) oneHot[id] = 0;
    else oneHot[id] = id in konicaBoxValues ? konicaBoxValues[id] : null;
  }
  renderKonicaBlocksView();
  if (konicaCodeType === 'new') {
    renderKonicaNewDecode(decodeKonicaNewCode(oneHot));
  } else {
    renderKonicaDecode({
      model: decodeKonicaModelCode(oneHot),
      timestamps: decodeKonicaTimestamps(oneHot),
    });
  }
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
  if (typeof renderKonicaSampleMeta === 'function') renderKonicaSampleMeta(null);
  renderKonicaBoard();
  runKonicaDecode();
}

// Render one timestamp interpretation as a compact human string.
function formatKonicaTimestamp(fields) {
  const parts = [];
  if (fields.day && fields.month) {
    parts.push(fields.day + ' ' + KONICA_MONTHS[fields.month]);
  } else if (fields.month) {
    parts.push(KONICA_MONTHS[fields.month]);
  } else if (fields.day) {
    parts.push('day ' + fields.day);
  }
  if ('year' in fields) parts.push("'" + String(fields.year).padStart(2, '0'));
  if ('hour' in fields) parts.push(String(fields.hour).padStart(2, '0') + ':00');
  return parts.length ? parts.join('  ') : '—';
}

function renderKonicaDecode(result) {
  const { model, timestamps } = result;

  const modelsHTML = model.models.length
    ? model.models.map(m => '<li>' + m + '</li>').join('')
    : '<li class="muted">Unknown model code &mdash; not in reference table</li>';

  const yearHTML = model.year ? ('~' + model.year) : '—';

  const tsHTML = timestamps.map(t => {
    const label = t.format === 'HhDdMmYy'
      ? 'Magicolor 8650, Bizhub 350C, DiALTA CF-2001/1501'
      : 'Bizhub C754';
    return '<tr><td><code>' + t.format + '</code></td>'
      + '<td>' + formatKonicaTimestamp(t.fields) + '</td>'
      + '<td class="muted">' + label + '</td></tr>';
  }).join('');

  document.getElementById('konica-results').innerHTML =
    '<div class="decoded-bar">'
    + '<div class="decoded-field"><span class="decoded-label">Model code</span>'
    + '<span class="decoded-value">' + model.code + '</span></div>'
    + '<div class="decoded-field"><span class="decoded-label">Base&#8209;6</span>'
    + '<span class="decoded-value">' + model.base6 + '</span></div>'
    + '<div class="decoded-field"><span class="decoded-label">Introduced</span>'
    + '<span class="decoded-value">' + yearHTML + '</span></div>'
    + '</div>'
    + '<h3 class="konica-subhead">Likely printer</h3>'
    + '<ul class="konica-models">' + modelsHTML + '</ul>'
    + '<h3 class="konica-subhead">Print timestamp</h3>'
    + '<p class="muted konica-note">The Konica time layout varies by model, so both known '
    + 'interpretations are shown. Year is two digits; the century offset is model&#8209;dependent.</p>'
    + '<table class="ref-table"><thead><tr><th>Layout</th><th>Decoded</th><th>Used by</th></tr></thead>'
    + '<tbody>' + tsHTML + '</tbody></table>';
}

// Render the New Code decode: full serial number, its parts, the resolved
// printer model, and the two checksum verifications.
function renderKonicaNewDecode(nc) {
  const s = nc.serial;
  const unknown = '<span class="muted">?</span>';

  // Resolve the printer model line (exact, ambiguous, or unknown).
  let modelHTML;
  if (nc.model) {
    modelHTML = '<strong>' + nc.model.make + ' ' + nc.model.model + '</strong> '
      + '<span class="muted">(' + nc.model.color
      + (nc.model.year ? ', released ' + nc.model.year : '') + ')</span>';
  } else if (nc.candidates.length) {
    modelHTML = '<span class="muted">Sub&#8209;model ' + (s.subModel ?? '?')
      + ' didn’t match — candidates for <code>' + s.seriesModel + '</code>: </span>'
      + nc.candidates.map(m => m.make + ' ' + m.model).join(', ');
  } else {
    modelHTML = '<span class="muted">Serial&#8209;model code <code>' + s.seriesModel
      + '</code> not in reference table</span>';
  }

  const brandStr = s.brand.digit == null ? unknown : (s.brand.digit + ' — ' + s.brand.name);
  const regionStr = s.region.digit == null ? unknown : (s.region.digit + ' — ' + s.region.name);
  const batchNumStr = s.batchNumber == null ? unknown
    : ('<code>' + s.batch + '</code> &middot; <code>' + s.number + '</code>');

  const rows = [
    ['Series &amp; model', '<code>' + s.seriesModel + '</code>', 'A &middot; [7,3] &middot; [2,15] &middot; [11,10]'],
    ['Brand', brandStr, '[27, 4]'],
    ['Region', regionStr, '[22,21]'],
    ['Sub&#8209;model', s.subModel == null ? unknown : s.subModel, '[17,18]'],
    ['Batch &middot; number', batchNumStr, '[19,20,12,13,14,8,9] base&#8209;6'],
  ];
  const rowsHTML = rows.map(([label, val, ref]) =>
    '<tr><td>' + label + '</td><td>' + val + '</td><td class="muted">' + ref + '</td></tr>').join('');

  const ckLine = (label, c, box) => {
    if (c.expected == null || c.actual == null) {
      return '<li class="muted">' + label + ': not enough dots to verify</li>';
    }
    const tag = c.ok
      ? '<span class="parity-ok">&#10003; OK</span>'
      : '<span class="parity-err">&#10007; mismatch</span>';
    return '<li>' + label + ' (box ' + box + '): read ' + c.actual
      + ', expected ' + c.expected + ' ' + tag + '</li>';
  };

  document.getElementById('konica-results').innerHTML =
    '<div class="decoded-bar">'
    + '<div class="decoded-field"><span class="decoded-label">Serial number</span>'
    + '<span class="decoded-value">' + s.full + '</span></div>'
    + '</div>'
    + '<h3 class="konica-subhead">Printer</h3>'
    + '<ul class="konica-models"><li>' + modelHTML + '</li></ul>'
    + '<h3 class="konica-subhead">Serial breakdown</h3>'
    + '<table class="ref-table"><thead><tr><th>Field</th><th>Value</th><th>Boxes</th></tr></thead>'
    + '<tbody>' + rowsHTML + '</tbody></table>'
    + '<h3 class="konica-subhead">Checksum</h3>'
    + '<ul class="konica-models">'
    + ckLine('Model check', nc.checksum.model, 28)
    + ckLine('Serial check', nc.checksum.serial, 29)
    + '</ul>';
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
