// Konica Minolta Machine Identification Code decoder.
// Single source of truth for the Konica decode — ported from konika/analysis.py.
//
// Unlike the Xerox scheme (a 7-bit binary column per field), Konica Minolta
// printers lay their tracking dots out as thirty 3-row x 2-column "blocks" on a
// 16 x 24 grid. Each block is *one-hot, base-6*: a single dot inside the 3x2
// block, whose position selects a digit 0-5 via this map:
//     [ [0, 1],
//       [2, 3],
//       [4, 5] ]
// Groups of blocks then spell out the model code and the print timestamp as
// base-6 numbers.

const KONICA_ROWS = 16;
const KONICA_COLS = 24;
const KONICA_BLOCK_HEIGHT = 3;
const KONICA_BLOCK_WIDTH = 2;

// Top-left (row, col) of each of the 30 blocks. Laid out diagonally, with the
// last column of blocks wrapping around the right edge of the grid.
const KONICA_BLOCK_POSITIONS = {
  0: [0, 0],  1: [0, 4],  2: [0, 8],  3: [0, 12],  4: [0, 16],  5: [0, 20],
  6: [3, 1],  7: [3, 5],  8: [3, 9],  9: [3, 13], 10: [3, 17], 11: [3, 21],
  12: [6, 2], 13: [6, 6], 14: [6, 10], 15: [6, 14], 16: [6, 18], 17: [6, 22],
  18: [9, 3], 19: [9, 7], 20: [9, 11], 21: [9, 15], 22: [9, 19], 23: [9, 23],
  24: [12, 0], 25: [12, 4], 26: [12, 8], 27: [12, 12], 28: [12, 16], 29: [12, 20],
};

// (row, col) within a block -> base-6 digit.
const KONICA_BLOCK_ANNOTATIONS = [[0, 1], [2, 3], [4, 5]];

// Which blocks carry which kind of information (used for grid highlighting).
const KONICA_BLOCK_CLASS = {
  0: 'constant', 1: 'constant', 6: 'constant',
  2: 'model', 3: 'model', 7: 'model',
  4: 'time', 5: 'time', 10: 'time', 11: 'time', 15: 'time',
  24: 'time', 25: 'time', 26: 'time',
};

// Model blocks, most-significant first: code = base6(block7, block3, block2).
const KONICA_MODEL_BLOCKS = [7, 3, 2];

// Time blocks in the order the format strings consume them.
const KONICA_TIME_BLOCK_ORDER = [25, 24, 4, 26, 10, 5, 15, 11];

// Two known timestamp layouts. Each character names the field a time block
// feeds; paired upper/lower letters are the high/low base-6 digits of a value.
//   HhDdMmYy - Magicolor 8650, Bizhub 350C, DiALTA Color CF-2001 / CF-1501
//   dDMmXyXY - Bizhub C754 (X = unknown / unused)
const KONICA_DATE_FORMATS = ['HhDdMmYy', 'dDMmXyXY'];

const KONICA_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Decimal model code -> approximate introduction year and known printer models.
// Derived from konika/model_code.txt. A code is shared across rebadges of the
// same engine (Minolta / Konica Minolta / Epson / Develop / etc.).
const KONICA_MODEL_TABLE = {
  1:   { year: 2001, models: ['Minolta-QMS Desklaser 2200', 'Minolta-QMS Magicolor 2210', 'Epson AcuLaser C2000'] },
  3:   { year: 2001, models: ['Minolta CF1501', 'Minolta DiALTA Color CF2001'] },
  5:   { year: 2003, models: ['Magicolor 2300DL', 'Epson AcuLaser C900', 'Epson AcuLaser C1900'] },
  7:   { year: 2003, models: ['Minolta-QMS Magicolor 7300'] },
  14:  { year: 2004, models: ['Konica Minolta Bizhub C350'] },
  18:  { year: 2005, models: ['Konica Minolta Bizhub C252'] },
  19:  { year: 2005, models: ['Konica Minolta Magicolor 2430DL'] },
  36:  { year: 2008, models: ['Konica Minolta Magicolor 8650'] },
  79:  { year: 2012, models: ['Konica Minolta Bizhub C754'] },
  108: { year: 2016, models: ['Konica Minolta (unknown model)'] },
  111: { year: 2016, models: ['Konica Minolta Bizhub C658'] },
  122: { year: 2019, models: ['Konica Minolta Bizhub C3350i / C3351i'] },
  128: { year: 2019, models: ['Konica Minolta Bizhub C250i', 'Konica Minolta Bizhub C300i', 'Konica Minolta Bizhub C360i'] },
  129: { year: 2019, models: ['Konica Minolta (unknown model)'] },
  141: { year: 2021, models: ['Konica Minolta Bizhub AccurioPrint C4065'] },
};

// Parse a whitespace- or comma-separated grid of 0/1 into a 2D array.
// Returns null if it isn't a plausible Konica grid (>= 15 rows, 24 columns).
function parseKonicaGrid(text) {
  const rows = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.split(/[\s,]+/).map(Number));

  if (rows.length < KONICA_ROWS - 1) return null;
  if (!rows.every(r => r.length === KONICA_COLS)) return null;
  if (!rows.every(r => r.every(v => v === 0 || v === 1))) return null;

  // Pad up to 16 rows with zeros so block extraction never runs off the end.
  while (rows.length < KONICA_ROWS) rows.push(new Array(KONICA_COLS).fill(0));
  return rows;
}

// For each block, find the dot and read off its base-6 digit (null if empty).
function extractKonicaBlocks(matrix) {
  const numRows = matrix.length;
  const numCols = matrix[0].length;
  const oneHot = {};
  for (const [blockId, pos] of Object.entries(KONICA_BLOCK_POSITIONS)) {
    const [r, c] = pos;
    let value = null;
    for (let i = 0; i < KONICA_BLOCK_HEIGHT; i++) {
      for (let j = 0; j < KONICA_BLOCK_WIDTH; j++) {
        const cell = matrix[(r + i) % numRows][(c + j) % numCols];
        if (cell === 1) value = KONICA_BLOCK_ANNOTATIONS[i][j];
      }
    }
    oneHot[blockId] = value;
  }
  return oneHot;
}

function decodeKonicaModelCode(oneHot) {
  const digits = KONICA_MODEL_BLOCKS.map(b => oneHot[b] ?? 0);
  const base6 = digits.join('');
  const code = parseInt(base6, 6);
  const entry = KONICA_MODEL_TABLE[code] || null;
  return { base6, code, year: entry ? entry.year : null, models: entry ? entry.models : [] };
}

// Convert a base-6 two-digit pair (high, low) to a decimal value.
function konicaPairToDecimal(high, low) {
  return parseInt(String(high) + String(low), 6);
}

// Decode the timestamp under each known format. Returns one result per format
// with whichever of hour/day/month/year that layout supplies.
function decodeKonicaTimestamps(oneHot) {
  return KONICA_DATE_FORMATS.map(format => {
    // Map each format character to the base-6 digit from its time block.
    const digits = {};
    for (let i = 0; i < format.length; i++) {
      digits[format[i]] = oneHot[KONICA_TIME_BLOCK_ORDER[i]] ?? 0;
    }

    const fields = {};
    const readField = (hi, lo) => {
      if (!(hi in digits) || !(lo in digits)) return null;
      return konicaPairToDecimal(digits[hi], digits[lo]);
    };

    const hour = readField('H', 'h');
    const day = readField('D', 'd');
    const month = readField('M', 'm');
    const year = readField('Y', 'y');

    if (hour !== null && hour >= 0 && hour < 24) fields.hour = hour;
    if (day !== null && day >= 1 && day <= 31) fields.day = day;
    if (month !== null && month >= 1 && month <= 12) fields.month = month;
    if (year !== null) fields.year = year; // 2-digit; century offset is model-dependent

    return { format, fields };
  });
}

// Full decode of a parsed Konica grid.
function decodeKonicaGrid(matrix) {
  const oneHot = extractKonicaBlocks(matrix);
  return {
    oneHot,
    model: decodeKonicaModelCode(oneHot),
    timestamps: decodeKonicaTimestamps(oneHot),
  };
}

// Export for Node-based tests; harmless in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseKonicaGrid, extractKonicaBlocks, decodeKonicaModelCode,
    decodeKonicaTimestamps, decodeKonicaGrid, KONICA_MODEL_TABLE,
  };
}
