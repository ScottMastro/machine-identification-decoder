# Xerox Machine Identification Code Decoder

A web-based tool for decoding [Machine Identification Codes](https://en.wikipedia.org/wiki/Machine_Identification_Code) (MIC) — the invisible yellow dot patterns printed by color laser printers on every page. Based on [EFF research](https://w2.eff.org/Privacy/printers/docucolor/) on the Xerox DocuColor tracking dot system.

## What are Machine Identification Codes?

Most color laser printers embed a nearly invisible pattern of tiny yellow dots on every printed page. This pattern encodes the printer's serial number, and the date and time the page was printed. The dots are arranged in a repeating 8-row by 15-column grid.

This tool decodes that grid to reveal the embedded information.

## Features

### Decoder
- Interactive 8x15 dot grid — click to toggle dots on/off
- Live decoding of serial number, date, and time as you edit
- Parity checking with visual indicators (green/red borders on parity dots)
- Load/save grid data as `.txt` files (CSV format)
- Export grid + decoded info as `.png` screenshot
- Column reference table explaining the encoding scheme

### Calendar View
- Batch upload multiple grid files at once
- Full-year calendar visualization showing which days had prints
- Click any highlighted day to see a detail table of prints (filename, serial, time)
- Year navigation with prev/next controls

## Setup

Requires Python 3 and Flask.

```bash
pip install flask
python app.py
```

The app runs at `http://localhost:5000`.

## Grid Format

Grid files are plain text CSV — 8 rows of 15 comma-separated values (0 or 1):

```
0,1,0,0,0,1,0,1,1,0,1,1,0,1,0
1,0,0,0,0,0,0,1,1,0,1,0,0,1,1
...
```

## Column Mapping

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
