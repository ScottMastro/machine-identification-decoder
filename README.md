# Machine Identification Code Decoder

## What is a Machine Identification Code?

Most color laser printers secretly embed a nearly invisible pattern of tiny yellow dots on every page they print. These [Machine Identification Codes](https://en.wikipedia.org/wiki/Machine_Identification_Code) (MIC) encode identifying information such as the printer's serial number and the date and time the page was printed.

## What does this tool do?

A web-based decoder for reading those dot patterns. Transcribe the dots from a printed page onto an interactive grid, and the tool decodes the embedded information live. It supports two schemes:

- **Xerox / DocuColor** — an 8×15 dot grid encoding serial number, date, and time.
- **Konica Minolta** — a 16×24 grid of one-hot base-6 blocks encoding the model / serial number (and, on older printers, a timestamp).

## Running it

A fully static site — no build step. Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## References

- [EFF DocuColor Tracking Dots](https://w2.eff.org/Privacy/printers/docucolor/)
- [Machine Identification Code — Wikipedia](https://en.wikipedia.org/wiki/Machine_Identification_Code)
