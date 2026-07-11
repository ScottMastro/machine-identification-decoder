# Machine Identification Code Decoder

A web-based tool for decoding [Machine Identification Codes](https://en.wikipedia.org/wiki/Machine_Identification_Code) (MIC) — the nearly invisible yellow dot patterns color laser printers embed on every page. Supports both the **Xerox** DocuColor scheme and the **Konica Minolta** dot-block scheme.

## What are Machine Identification Codes?

Most color laser printers embed a nearly invisible pattern of tiny yellow dots on every printed page, encoding identifying information such as the printer's serial number and the date and time the page was printed. Different manufacturers lay the dots out differently:

- **Xerox / DocuColor** — an 8-row by 15-column grid encoding the serial number, date, and time. Based on [EFF research](https://w2.eff.org/Privacy/printers/docucolor/).
- **Konica Minolta** — thirty one-hot base-6 "blocks" on a 16×24 grid encoding the model / serial number (and, on older models, a print timestamp).

This tool decodes those patterns to reveal the embedded information.

## Features

### Xerox decoder
- Interactive 8×15 dot grid — click to toggle dots, in a labeled **Dots** view or a tight **Grid** view
- Live decoding of serial number, date, and time as you edit
- Parity checking with visual indicators (green/red on parity dots)
- Load/save grid data as `.txt` files (CSV format); export grid + decoded info as `.png`
- Column reference table explaining the encoding scheme

### Konica Minolta decoder
- Interactive 16×24 board with a **Blocks** view (one dot per 3×2 block) or a tight **Grid** view
- Live decode of the full serial number — series, model, brand, region, sub-model, batch/number — plus checksum verification
- Handles both the **Old code** (model number + timestamp) and **New code** (full serial number) schemes
- A **Blocks by field** breakdown grouping the boxes into their decoded fields and showing the base-6 → base-10 / cypher translation for each
- Optional sample library for quick loading (see below)

## Setup

This is a fully static site — no server or build step. Open `index.html`
directly in a browser, or serve the folder over HTTP:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

Open a specific tab directly with `?tab=xerox|konica` (or the matching `#hash`,
e.g. `#konica`). Whichever tab you click is also written to the URL, so a
refresh keeps you on it.

### Konica sample library

Create a `samples/` directory (gitignored) and drop decoded 16×24 dot `.txt`
files into it. When the site is served over HTTP, the Konica tab shows a
**sample dropdown** listing them; empty (or opened via `file://`, where `fetch`
is blocked) means no dropdown.

An optional `samples/meta.txt` (JSON) attaches info to each file. It can be a
map keyed by filename, an array of `{name, ...}`, or `{"files": [...]}`:

```json
{
  "bizhub_c250i.txt": {
    "label": "Bizhub C250i",
    "codeType": "new",
    "expectedSerial": "AA2M021002826",
    "source": "Reference PDF worked example"
  }
}
```

`label` shows next to the filename; `codeType` (`old`/`new`) auto-selects the
decode mode on load; any other keys render as an info line under the board.
Files are discovered from `meta.txt` **and** the server's directory listing, so
you can drop a file in without editing `meta.txt`.

### Project layout

```
index.html            markup for both decoder tabs
static/css/style.css  all styles
static/js/
  xerox-decode.js     Xerox MIC decoding algorithm (single source of truth)
  grid.js             interactive dot grid + parity indicators
  fileio.js           load / save / PNG export (client-side)
  konica-decode.js    Konica Minolta decoding algorithm (single source of truth)
  konica.js           interactive one-hot base-6 block board
  samples.js          optional samples/ dropdown loader for the Konica tab
  app.js              tab switching + bootstrap
samples/              gitignored: decoded dot .txt files + optional meta.txt
archive/              archived Konica research scripts (see archive/konika-scripts/)
```

## Xerox grid format

Grid files are plain text CSV — 8 rows of 15 comma-separated values (0 or 1):

```
0,1,0,0,0,1,0,1,1,0,1,1,0,1,0
1,0,0,0,0,0,0,1,1,0,1,0,0,1,1
...
```

### Column mapping

| Column | Field | Description |
|--------|-------|-------------|
| 1 | Parity | Row parity (odd parity per row) |
| 2 | Minute | Minute the page was printed |
| 3–4 | Unused | Typically zero |
| 5 | Hour | Hour printed (24h) |
| 6 | Day | Day of month |
| 7 | Month | Month (1–12) |
| 8 | Year | Year without century (e.g. 26 = 2026) |
| 9 | Unused | Typically zero |
| 10 | Separator | Often all 1s (127) |
| 11–14 | Serial | Printer serial number (BCD, two digits per column) |
| 15 | Serial? | Constant per printer |

Row 1 is a parity row. Each column's 7 data bits (rows 2–8) encode a value, MSB at row 2. All rows and columns maintain odd parity.

## References

- [EFF DocuColor Tracking Dots](https://w2.eff.org/Privacy/printers/docucolor/)
- [Machine Identification Code — Wikipedia](https://en.wikipedia.org/wiki/Machine_Identification_Code)
- "Deciphering the Konica Minolta MIC Dots" (Donovan R.) — basis for the Konica decoder
