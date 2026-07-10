// Xerox DocuColor MIC decoding — the single source of truth for the algorithm.
// Based on EFF research: https://w2.eff.org/Privacy/printers/docucolor/
//
// A grid is 8 rows x 15 columns of 0/1. Row 0 is the parity row and column 0
// is the parity column. Each data column (2-15) encodes a 7-bit value from
// rows 1-7 (MSB first). See the Column Reference table in index.html.

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Parse a CSV text file into an 8x15 grid of 0/1, or null if malformed.
function parseGridFromText(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const g = lines.map(l => l.trim().split(',').map(v => parseInt(v.trim())));
  if (g.length !== 8 || g.some(r => r.length !== 15)) return null;
  if (g.some(r => r.some(v => v !== 0 && v !== 1))) return null;
  return g;
}

// Decode an 8x15 grid into { serial, year, month, day, hour, minute }.
function decodeGridData(g) {
  const colValues = {};
  for (let ci = 1; ci < 15; ci++) {
    const colNum = ci + 1;
    let val = 0;
    for (let ri = 1; ri < 8; ri++) {
      val |= (g[ri][ci] << (6 - (ri - 1)));
    }
    colValues[colNum] = val;
  }
  const minute = colValues[2] || 0;
  const hour = colValues[5] || 0;
  const day = colValues[6] || 0;
  const month = colValues[7] || 0;
  const yearRaw = colValues[8] || 0;
  const year = yearRaw <= 50 ? 2000 + yearRaw : 1900 + yearRaw;

  const serialParts = [];
  [15, 14, 13, 12, 11].forEach(cn => {
    const v = colValues[cn] || 0;
    serialParts.push(String(Math.floor(v / 10)) + String(v % 10));
  });
  const serial = serialParts.join(' ');

  return { serial, year, month, day, hour, minute };
}

// Decode the live grid and paint the Serial / Printed fields under it.
function decodeLocally() {
  const total = grid.flat().reduce((a, b) => a + b, 0);
  const serialEl = document.getElementById('res-serial');
  const timestampEl = document.getElementById('res-timestamp');

  if (total === 0) {
    serialEl.innerHTML = '&mdash;';
    timestampEl.innerHTML = '&mdash;';
    return;
  }

  const d = decodeGridData(grid);
  serialEl.textContent = d.serial;

  const pad = (n) => String(n).padStart(2, '0');
  const validMonth = d.month >= 1 && d.month <= 12;
  const validDay = d.day >= 1 && d.day <= 31;
  const validHour = d.hour >= 0 && d.hour <= 23;
  const validMinute = d.minute >= 0 && d.minute <= 59;

  const monthStr = validMonth ? MONTHS[d.month] : '<span class="invalid">' + d.month + '</span>';
  const dayStr = validDay ? String(d.day) : '<span class="invalid">' + d.day + '</span>';
  const hourMinStr = (validHour && validMinute)
    ? pad(d.hour) + ':' + pad(d.minute)
    : '<span class="invalid">' + pad(d.hour) + ':' + pad(d.minute) + '</span>';

  timestampEl.innerHTML = dayStr + ' ' + monthStr + ' ' + d.year + ', ' + hourMinStr;
}
