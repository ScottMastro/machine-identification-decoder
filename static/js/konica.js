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

// Current dot (0-5) selected in each editable box; absent = empty.
let konicaBoxValues = {};

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

// Read-only "blocks view": the same dot data, sliced into its 30 blocks and
// laid out in array order. Each block is a small 3x2 grid showing its single
// dot, outlined in its type color, with the base-10 digit it encodes below.
function renderKonicaBlocksView() {
  const host = document.getElementById('konica-blocks');
  if (!host) return;
  host.innerHTML = '';
  const catMap = konicaCategoryMap(konicaCodeType);
  for (let id = 0; id < 30; id++) {
    const val = id === 0 ? 0 : (id in konicaBoxValues ? konicaBoxValues[id] : null);
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

    host.appendChild(block);
  }
}

// One dot per box: clicking the active dot clears the box, else selects it.
function onKonicaCellClick(id, val) {
  if (konicaBoxValues[id] === val) {
    delete konicaBoxValues[id];
  } else {
    konicaBoxValues[id] = val;
  }
  renderKonicaBoard();
  runKonicaDecode();
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
  konicaBoxValues = {};
  document.getElementById('konica-status').textContent = '';
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
    const oneHot = extractKonicaBlocks(g);
    konicaBoxValues = {};
    for (let id = 0; id < 30; id++) {
      if (KONICA_LOCKED_BOXES.has(id)) continue; // marker anchor + spacers
      if (oneHot[id] !== null) konicaBoxValues[id] = oneHot[id];
    }
    renderKonicaBoard();
    runKonicaDecode();
    statusEl.textContent = 'Loaded: ' + file.name;
  };
  reader.onerror = () => { statusEl.textContent = 'Could not read ' + file.name; };
  reader.readAsText(file);
  e.target.value = '';
}

// Render the board immediately so the Konica tab is live without any file.
function initKonica() {
  konicaBoxValues = {};
  // setKonicaCodeType renders the legends, board, and decode for the initial mode.
  setKonicaCodeType(konicaCodeType);
}
