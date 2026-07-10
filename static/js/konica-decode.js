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

// ---------------------------------------------------------------------------
// New Code (printers made ~2013+). Instead of a model number + timestamp, the
// blocks spell out the printer's full serial number, plus checksum boxes.
//
// Two block digits (each 0-5) are concatenated as DECIMAL to form a key 0..55,
// which the cypher maps to one serial character. E.g. box7=3, box3=3 -> key 33
// -> "A". Reference: "Deciphering the Konica Minolta MIC Dots" (Donovan R.).
// ---------------------------------------------------------------------------

const KONICA_CYPHER = {
  0: 'P', 1: 'Q', 2: 'R', 3: 'S', 4: 'T', 5: 'U',
  10: 'V', 11: 'W', 12: 'X', 13: 'Y', 14: 'Z', 15: '0',
  20: '1', 21: '2', 22: '3', 23: '4', 24: '5', 25: '6',
  30: '7', 31: '8', 32: '9', 33: 'A', 34: 'B', 35: 'C',
  40: 'D', 41: 'E', 42: 'F', 43: 'G', 44: 'H', 45: 'I',
  50: 'J', 51: 'K', 52: 'L', 53: 'M', 54: 'N', 55: 'O',
};

const KONICA_BRANDS = { 0: 'Konica', 1: 'Develop', 2: 'Lexmark', 3: 'Olivetti' };
const KONICA_REGIONS = {
  0: 'Japan (100V)', 1: 'United States (120V)', 2: 'Europe (220-240V)', 4: 'Unknown region',
};

// Checksum boxes: box 28 checks the model, box 29 checks the serial. The
// expected value is (6 - (sum % 6)) % 6 over the summed box values.
const KONICA_MODEL_CHECK_BOXES = [2, 3, 7, 10, 11, 15];
const KONICA_SERIAL_CHECK_BOXES = [8, 9, 12, 13, 14, 17, 18, 19, 20, 21, 22, 23, 27];

// Serial-model code (+ sub-model) -> actual printer. From the model table at
// the end of the reference PDF. The release year is the earliest a document
// from that model could have been printed.
const KONICA_NEW_MODELS = [
  { serial: 'A00J', sub: 0, make: 'bizhub', model: 'C550', color: 'Color', year: '3/2007' },
  { serial: 'A02E', sub: 1, make: 'bizhub', model: 'C253', color: 'Color', year: '10/2007' },
  { serial: 'A02E', sub: 2, make: 'bizhub', model: 'C203', color: 'Color', year: '10/2007' },
  { serial: 'A0ED', sub: 1, make: 'bizhub', model: 'C360', color: 'Color', year: '9/2009' },
  { serial: 'A0ED', sub: 2, make: 'bizhub', model: 'C280', color: 'Color', year: '9/2009' },
  { serial: 'A0ED', sub: 3, make: 'bizhub', model: 'C220', color: 'Color', year: '9/2009' },
  { serial: 'A0ED', sub: null, make: 'bizhub Pro', model: 'C1060L', color: 'Color', year: '2/2014' },
  { serial: 'A0P1', sub: 1, make: 'bizhub', model: 'C552', color: 'Color', year: '2/2009' },
  { serial: 'A0PN', sub: 1, make: 'bizhub', model: '751', color: 'BW', year: '12/2008' },
  { serial: 'A0R5', sub: 1, make: 'bizhub', model: '501', color: 'BW', year: '6/2008' },
  { serial: 'A0VD', sub: 3, make: 'bizhub', model: 'C35P', color: 'Color', year: '10/2010' },
  { serial: 'A1UD', sub: 1, make: 'bizhub', model: '423', color: 'BW', year: '6/2010' },
  { serial: 'A1UE', sub: 2, make: 'bizhub', model: '363', color: 'BW', year: '6/2010' },
  { serial: 'A1UF', sub: 1, make: 'bizhub', model: '283', color: 'BW', year: '6/2010' },
  { serial: 'A1UG', sub: 1, make: 'bizhub', model: '223', color: 'BW', year: '6/2010' },
  { serial: 'A2WV', sub: 1, make: 'bizhub', model: '552', color: 'BW', year: '2/2011' },
  { serial: 'A2X0', sub: 7, make: 'bizhub', model: 'C754e', color: 'Color', year: '7/2013' },
  { serial: 'A2X1', sub: 7, make: 'bizhub', model: 'C654e', color: 'Color', year: '7/2013' },
  { serial: 'A2YF', sub: 1, make: 'bizhub', model: 'C25', color: 'Color', year: '4/2011' },
  { serial: 'A32P', sub: 1, make: 'bizhub', model: '20P', color: 'BW', year: '8/2010' },
  { serial: 'A3R2', sub: 1, make: 'bizhub', model: '195', color: 'BW', year: null },
  { serial: 'A4FJ', sub: 1, make: 'bizhub', model: 'C454', color: 'Color', year: '7/2013' },
  { serial: 'A4Y4', sub: 1, make: 'bizhub', model: 'C3350', color: 'Color', year: '1/2014' },
  { serial: 'A50V', sub: 1, make: 'bizhub Press', model: 'C1060', color: 'Color', year: '2/2014' },
  { serial: 'A5AX', sub: 1, make: 'bizhub Press', model: 'C1085', color: 'Color', year: '7/2014' },
  { serial: 'A5AY', sub: 1, make: 'bizhub', model: 'C554e', color: 'Color', year: '4/2013' },
  { serial: 'A5C0', sub: 1, make: 'bizhub', model: 'C454e', color: 'Color', year: '4/2013' },
  { serial: 'A5C1', sub: 1, make: 'bizhub', model: 'C364e', color: 'Color', year: '3/2013' },
  { serial: 'A5C2', sub: 1, make: 'bizhub', model: 'C284e', color: 'Color', year: '4/2013' },
  { serial: 'A5C4', sub: 1, make: 'bizhub', model: 'C224e', color: 'Color', year: '4/2013' },
  { serial: 'A5YN', sub: 7, make: 'bizhub', model: '654N', color: 'BW', year: '10/2013' },
  { serial: 'A61D', sub: 1, make: 'bizhub', model: '554e', color: 'BW', year: '10/2013' },
  { serial: 'A61E', sub: 1, make: 'bizhub', model: '454e', color: 'BW', year: '11/2013' },
  { serial: 'A61F', sub: 1, make: 'bizhub', model: '364e', color: 'BW', year: '11/2013' },
  { serial: 'A61G', sub: 1, make: 'bizhub', model: '284e', color: 'BW', year: '11/2013' },
  { serial: 'A61H', sub: 1, make: 'bizhub', model: '224e', color: 'BW', year: '11/2013' },
  { serial: 'A63N', sub: 1, make: 'bizhub', model: '4700P', color: 'BW', year: '4/2013' },
  { serial: 'A63R', sub: 1, make: 'bizhub', model: '4000P', color: 'BW', year: '4/2013' },
  { serial: 'A6DR', sub: 2, make: 'bizhub', model: 'C3100P', color: 'Color', year: '6/2014' },
  { serial: 'A6DT', sub: 2, make: 'bizhub', model: 'C3110', color: 'Color', year: '6/2014' },
  { serial: 'A6F7', sub: 1, make: 'bizhub', model: '4750', color: 'BW', year: '2/2014' },
  { serial: 'A6VF', sub: 1, make: 'bizhub', model: '4050', color: 'BW', year: '2/2014' },
  { serial: 'A6WD', sub: 1, make: 'bizhub', model: '4020', color: 'BW', year: '2/2014' },
  { serial: 'A6WP', sub: 1, make: 'bizhub', model: '3320', color: 'BW', year: '2/2014' },
  { serial: 'A72R', sub: 1, make: 'bizhub', model: 'C3850FS', color: 'Color', year: '2/2015' },
  { serial: 'A789', sub: 7, make: 'bizhub', model: '367', color: 'BW', year: null },
  { serial: 'A797', sub: 1, make: 'bizhub', model: 'C287', color: 'Color', year: '2/2016' },
  { serial: 'A798', sub: 1, make: 'bizhub', model: 'C227', color: 'Color', year: null },
  { serial: 'A79J', sub: 3, make: 'bizhub', model: 'C658', color: 'Color', year: '7/2016' },
  { serial: 'A79K', sub: 1, make: 'bizhub', model: 'C558', color: 'Color', year: '7/2016' },
  { serial: 'A79M', sub: 1, make: 'bizhub', model: 'C458', color: 'Color', year: '7/2016' },
  { serial: 'A7AH', sub: 1, make: 'bizhub', model: '287', color: 'BW', year: '7/2015' },
  { serial: 'A7AK', sub: 1, make: 'bizhub', model: '227', color: 'BW', year: '7/2015' },
  { serial: 'A7PU', sub: null, make: 'bizhub', model: 'C368', color: 'Color', year: '8/2015' },
  { serial: 'A7PY', sub: 1, make: 'bizhub', model: 'C308', color: 'Color', year: '8/2015' },
  { serial: 'A7R0', sub: null, make: 'bizhub', model: 'C258', color: 'Color', year: '2/2016' },
  { serial: 'A85C', sub: 1, make: 'AccurioPress', model: 'C2070', color: 'Color', year: '1/2017' },
  { serial: 'A8JE', sub: 1, make: 'bizhub', model: 'C759', color: 'Color', year: '12/2017' },
  { serial: 'A8KN', sub: 1, make: 'bizhub', model: '808', color: 'BW', year: '6/2016' },
  { serial: 'A92F', sub: 1, make: 'bizhub', model: 'C3351', color: 'Color', year: '3/2017' },
  { serial: 'A92G', sub: 1, make: 'bizhub', model: 'C3851FS', color: 'Color', year: '3/2017' },
  { serial: 'A93E', sub: 1, make: 'bizhub', model: 'C3350i', color: 'Color', year: '6/2019' },
  { serial: 'A9HG', sub: 1, make: 'bizhub', model: '558i', color: 'BW', year: '2/2017' },
  { serial: 'A9HH', sub: 1, make: 'bizhub', model: '458i', color: 'BW', year: '2/2017' },
  { serial: 'AA1P', sub: 1, make: 'bizhub', model: '4752', color: 'BW', year: '7/2018' },
  { serial: 'AA1R', sub: 1, make: 'bizhub', model: '4052', color: 'BW', year: '7/2018' },
  { serial: 'AA2J', sub: 1, make: 'bizhub', model: 'C360i', color: 'Color', year: '6/2019' },
  { serial: 'AA2K', sub: 1, make: 'bizhub', model: 'C300i', color: 'Color', year: '6/2019' },
  { serial: 'AA2M', sub: 1, make: 'bizhub', model: 'C250i', color: 'Color', year: '6/2019' },
  { serial: 'AA6T', sub: 1, make: 'bizhub', model: '558e', color: 'BW', year: '11/2017' },
  { serial: 'AA6U', sub: 1, make: 'bizhub', model: '458e', color: 'BW', year: '12/2017' },
  { serial: 'AA7N', sub: 1, make: 'bizhub', model: 'C650i', color: 'Color', year: '2/2020' },
  { serial: 'AA7P', sub: 7, make: 'bizhub', model: 'C550i', color: 'Color', year: '2/2020' },
  { serial: 'AA7R', sub: 7, make: 'bizhub', model: 'C450i', color: 'Color', year: '1/2020' },
  { serial: 'AAFN', sub: 1, make: 'bizhub', model: '3622', color: 'BW', year: '6/2018' },
  { serial: 'AAJN', sub: 1, make: 'bizhub', model: 'C4050i', color: 'Color', year: '6/2019' },
  { serial: 'AAJP', sub: 1, make: 'bizhub', model: 'C3320i', color: 'Color', year: null },
  { serial: 'AAJR', sub: 1, make: 'bizhub', model: 'C4000i', color: 'Color', year: '6/2019' },
  { serial: 'AAJR', sub: 7, make: 'bizhub', model: 'C3351i', color: 'Color', year: '1/2024' },
  { serial: 'AAJT', sub: 1, make: 'bizhub', model: 'C3300i', color: 'Color', year: '6/2019' },
  { serial: 'AAJT', sub: 7, make: 'bizhub', model: 'C3321i', color: 'Color', year: null },
  { serial: 'AC74', sub: 7, make: 'bizhub', model: '650i', color: 'BW', year: '9/2020' },
  { serial: 'AC75', sub: 7, make: 'bizhub', model: '550i', color: 'BW', year: null },
  { serial: 'AC76', sub: 7, make: 'bizhub', model: '450i', color: 'BW', year: '9/2020' },
  { serial: 'AC77', sub: 1, make: 'bizhub', model: '360i', color: 'BW', year: '9/2020' },
  { serial: 'AC78', sub: 1, make: 'bizhub', model: '300i', color: 'BW', year: '9/2020' },
  { serial: 'ACER', sub: 1, make: 'bizhub', model: '4020i', color: 'BW', year: '10/2019' },
  { serial: 'ACET', sub: 1, make: 'bizhub', model: '4000i', color: 'BW', year: '10/2019' },
  { serial: 'ACEU', sub: 1, make: 'bizhub', model: '5020i', color: 'BW', year: '9/2019' },
  { serial: 'ACF1', sub: 1, make: 'bizhub', model: '5000i', color: 'BW', year: '10/2019' },
  { serial: 'ACKN', sub: 7, make: 'bizhub', model: 'C750i', color: 'Color', year: null },
  { serial: 'ACN2', sub: 1, make: 'bizhub', model: '225i', color: 'BW', year: null },
  { serial: 'ACT8', sub: 1, make: 'bizhub', model: '4750i', color: 'BW', year: '2/2021' },
  { serial: 'ACT8', sub: 7, make: 'bizhub', model: '4751i', color: 'BW', year: '3/2024' },
  { serial: 'ACT9', sub: 1, make: 'bizhub', model: '4050i', color: 'BW', year: '2/2021' },
  { serial: 'ACT9', sub: 7, make: 'bizhub', model: 'C4051i', color: 'Color', year: null },
  { serial: 'ACTA', sub: 1, make: 'bizhub', model: '4700i', color: 'BW', year: '2/2021' },
  { serial: 'ACV7', sub: 7, make: 'bizhub', model: '750i', color: 'BW', year: '9/2020' },
  { serial: 'ACVD', sub: 1, make: 'bizhub', model: 'C257i', color: 'Color', year: null },
  { serial: 'ACVW', sub: 1, make: 'AccurioPrint', model: '850i', color: 'BW', year: null },
  { serial: 'ACVX', sub: 1, make: 'AccurioPrint', model: '950i', color: 'BW', year: null },
  { serial: 'ADXG', sub: null, make: 'bizhub', model: 'C451i', color: 'Color', year: '6/2024' },
  { serial: 'AE1V', sub: 1, make: 'bizhub', model: 'C3120i', color: 'Color', year: '11/2022' },
  { serial: 'AE1X', sub: 1, make: 'bizhub', model: 'C3100i', color: 'Color', year: '11/2022' },
  { serial: 'DC43', sub: null, make: 'bizhub', model: '25', color: 'BW', year: '7/2011' },
  { serial: 'DD13', sub: null, make: 'bizhub', model: '25e', color: 'BW', year: null },
];

// Map two block digits (concatenated as a decimal key) to a serial character.
function konicaCypher(hiBox, loBox, oneHot) {
  const hi = oneHot[hiBox];
  const lo = oneHot[loBox];
  if (hi == null || lo == null) return null;
  const ch = KONICA_CYPHER[hi * 10 + lo];
  return ch === undefined ? null : ch;
}

// Same, but only accept a decoded digit 0-9 (for brand/region/sub-model).
function konicaCypherDigit(hiBox, loBox, oneHot) {
  const ch = konicaCypher(hiBox, loBox, oneHot);
  return ch !== null && /^[0-9]$/.test(ch) ? Number(ch) : null;
}

// Brand: box 27 combined with any of the always-5 boxes.
function konicaBrandDigit(oneHot) {
  if (oneHot[27] == null) return null;
  for (const lo of [4, 5, 23, 24, 25, 26]) {
    if (oneHot[lo] != null) {
      const ch = KONICA_CYPHER[oneHot[27] * 10 + oneHot[lo]];
      return ch !== undefined && /^[0-9]$/.test(ch) ? Number(ch) : null;
    }
  }
  return null;
}

// Look up the printer by its 4-char serial-model code and sub-model.
function lookupKonicaNewModel(seriesModel, subModel) {
  const candidates = KONICA_NEW_MODELS.filter(m => m.serial === seriesModel);
  let model = candidates.find(m => m.sub === subModel) || null;
  if (!model && candidates.length === 1) model = candidates[0];
  return { model, candidates };
}

// One checksum digit: (6 - (sum of box values % 6)) % 6, or null if incomplete.
function konicaChecksum(boxes, oneHot) {
  if (!boxes.every(b => oneHot[b] != null)) return null;
  const sum = boxes.reduce((acc, b) => acc + oneHot[b], 0);
  return (6 - (sum % 6)) % 6;
}

// Decode the New Code: full serial number, its parts, model lookup, checksums.
function decodeKonicaNewCode(oneHot) {
  // Series & model: implicit leading 'A' then three cyphered characters.
  const c2 = konicaCypher(7, 3, oneHot);
  const c3 = konicaCypher(2, 15, oneHot);
  const c4 = konicaCypher(11, 10, oneHot);
  const seriesModel = 'A' + (c2 ?? '?') + (c3 ?? '?') + (c4 ?? '?');
  const series = 'A' + (c2 ?? '?');
  const modelChars = (c3 ?? '?') + (c4 ?? '?');

  const brandDigit = konicaBrandDigit(oneHot);
  const regionDigit = konicaCypherDigit(22, 21, oneHot);
  const subModel = konicaCypherDigit(17, 18, oneHot);

  // Batch & number: seven blocks read as one base-6 number, then base-10.
  const bnBoxes = [19, 20, 12, 13, 14, 8, 9];
  let batchNumber = null, batch = null, number = null;
  if (bnBoxes.every(b => oneHot[b] != null)) {
    const dec = parseInt(bnBoxes.map(b => oneHot[b]).join(''), 6);
    batchNumber = String(dec).padStart(6, '0');
    batch = batchNumber.slice(0, 3);
    number = batchNumber.slice(3);
  }

  const part = v => (v == null ? '?' : String(v));
  const full = seriesModel
    + part(brandDigit) + part(regionDigit) + part(subModel)
    + (batchNumber ?? '??????');

  const { model, candidates } = lookupKonicaNewModel(seriesModel, subModel);

  const modelCheck = konicaChecksum(KONICA_MODEL_CHECK_BOXES, oneHot);
  const serialCheck = konicaChecksum(KONICA_SERIAL_CHECK_BOXES, oneHot);

  return {
    serial: {
      full, seriesModel, series, model: modelChars,
      brand: { digit: brandDigit, name: brandDigit == null ? null : (KONICA_BRANDS[brandDigit] ?? 'Unknown') },
      region: { digit: regionDigit, name: regionDigit == null ? null : (KONICA_REGIONS[regionDigit] ?? 'Unknown') },
      subModel, batch, number, batchNumber,
    },
    model, candidates,
    checksum: {
      model: { expected: modelCheck, actual: oneHot[28] ?? null, ok: modelCheck != null && modelCheck === oneHot[28] },
      serial: { expected: serialCheck, actual: oneHot[29] ?? null, ok: serialCheck != null && serialCheck === oneHot[29] },
    },
  };
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
    decodeKonicaNewCode, lookupKonicaNewModel, konicaChecksum, KONICA_NEW_MODELS,
  };
}
