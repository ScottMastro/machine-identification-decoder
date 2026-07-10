// Interactive 8x15 dot grid: state, rendering, and parity indicators.

const ROWS = 8;
const COLS = 15;
const COL_LABELS = {
  1: 'parity', 2: 'minute', 3: 'unused', 4: 'unused',
  5: 'hour', 6: 'day', 7: 'month', 8: 'year',
  9: 'unused', 10: 'sep', 11: 'serial', 12: 'serial',
  13: 'serial', 14: 'serial', 15: 'serial?'
};
const UNUSED_COLS = new Set([3, 4, 9]);

let grid = [];

function initGrid() {
  grid = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push(new Array(COLS).fill(0));
  }
}

function isParity(r, c) {
  return r === 0 || c === 0;
}

function getParityErrors() {
  const rowErrors = new Set();
  const colErrors = new Set();
  // Skip row 0 (parity row) — it exists to make each column's total odd
  for (let r = 1; r < ROWS; r++) {
    let s = 0;
    for (let c = 0; c < COLS; c++) s += grid[r][c];
    if (s > 0 && s % 2 === 0) rowErrors.add(r);
  }
  // Skip column 0 (parity column) — with 8 rows its own parity is structurally determined
  for (let c = 1; c < COLS; c++) {
    let s = 0;
    for (let r = 0; r < ROWS; r++) s += grid[r][c];
    if (s > 0 && s % 2 === 0) colErrors.add(c);
  }
  return { rowErrors, colErrors };
}

function updateParityIndicators() {
  const { rowErrors, colErrors } = getParityErrors();
  const total = grid.flat().reduce((a, b) => a + b, 0);

  document.querySelectorAll('.dot.parity-dot').forEach(dot => {
    const r = parseInt(dot.dataset.r);
    const c = parseInt(dot.dataset.c);
    dot.classList.remove('parity-good', 'parity-bad');
    if (total === 0) return;
    if (r === 0 && c === 0) {
      // Corner dot: skip — neither row 1 nor col 1 are checked
    } else if (r === 0) {
      // Parity row: indicates column parity
      const colHasData = grid.some((row, ri) => ri > 0 && row[c]) || grid[0][c];
      if (colHasData) dot.classList.add(colErrors.has(c) ? 'parity-bad' : 'parity-good');
    } else if (c === 0) {
      // Parity column: indicates row parity
      const rowHasData = grid[r].some((v, ci) => ci > 0 && v) || grid[r][0];
      if (rowHasData) dot.classList.add(rowErrors.has(r) ? 'parity-bad' : 'parity-good');
    }
  });

  const el = document.getElementById('parity-live');
  const errorLabels = [];
  rowErrors.forEach(r => errorLabels.push('Row ' + (r + 1)));
  colErrors.forEach(c => errorLabels.push('Col ' + (c + 1)));
  if (total === 0) {
    el.className = 'parity-live';
    el.textContent = '';
  } else if (errorLabels.length === 0) {
    el.className = 'parity-live parity-ok';
    el.textContent = 'Parity OK';
  } else {
    el.className = 'parity-live parity-err';
    el.textContent = 'Parity error: ' + errorLabels.join(', ');
  }
}

// Refresh everything that depends on the grid contents.
function onDotChanged() {
  updateParityIndicators();
  decodeLocally();
}

function renderGrid() {
  const table = document.getElementById('mic-grid');
  table.innerHTML = '';

  const labelRow = document.createElement('tr');
  labelRow.appendChild(document.createElement('th'));
  for (let c = 0; c < COLS; c++) {
    const th = document.createElement('th');
    th.className = 'col-label';
    th.textContent = c + 1;
    labelRow.appendChild(th);
  }
  table.appendChild(labelRow);

  const infoRow = document.createElement('tr');
  infoRow.appendChild(document.createElement('th'));
  for (let c = 0; c < COLS; c++) {
    const th = document.createElement('th');
    const colNum = c + 1;
    th.className = UNUSED_COLS.has(colNum) ? 'col-info unused' : 'col-info';
    th.textContent = COL_LABELS[colNum] || '';
    infoRow.appendChild(th);
  }
  table.appendChild(infoRow);

  for (let r = 0; r < ROWS; r++) {
    const tr = document.createElement('tr');
    const rLabel = document.createElement('th');
    rLabel.className = 'row-label';
    rLabel.textContent = r + 1;
    tr.appendChild(rLabel);
    for (let c = 0; c < COLS; c++) {
      const td = document.createElement('td');
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.dataset.r = r;
      dot.dataset.c = c;
      const colNum = c + 1;
      if (isParity(r, c)) {
        dot.classList.add('parity-dot');
      } else if (UNUSED_COLS.has(colNum)) {
        dot.classList.add('unused-dot');
      }
      if (grid[r][c]) dot.classList.add('active');
      dot.addEventListener('click', () => {
        grid[r][c] = grid[r][c] ? 0 : 1;
        dot.classList.toggle('active');
        onDotChanged();
      });
      td.appendChild(dot);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  onDotChanged();
}

function clearGrid() {
  initGrid();
  renderGrid();
}
