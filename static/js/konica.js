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
    const cls = KONICA_BLOCK_CLASS[id] || 'default';
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
  renderKonicaDecode({
    model: decodeKonicaModelCode(oneHot),
    timestamps: decodeKonicaTimestamps(oneHot),
  });
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
  renderKonicaBoard();
  runKonicaDecode();
}
