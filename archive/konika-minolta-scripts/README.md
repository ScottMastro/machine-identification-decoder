# Konica Minolta research scripts (archive)

The original Python scripts used to reverse-engineer and decode the Konica
Minolta Machine Identification Code (MIC) dot patterns. They were moved here
from the sibling `konika/` research folder to keep a version-controlled record.

> **Note:** these are archived as-is. They read data files that live in the
> original `konika/` folder (`manual_dots/`, `printer_metadata.csv`,
> `target.txt`, etc.), so the relative paths will not resolve from this
> location without copying that data alongside them. They are kept for
> reference, not to be run in place. The live decoder used by the web app is
> the JavaScript port in `static/js/konica-decode.js`.

## `core_tools/` — data entry + decoding

| Script | Purpose |
|---|---|
| `select_dots.py` | Interactive Tkinter grid editor to hand-transcribe a 16×24 dot pattern; Save/Load `.txt`, export PNG. Produces the `.txt` files the other scripts consume. |
| `analysis.py` | The decoder: carves the grid into 30 fixed 3×2 base-6 blocks and decodes the model code + date/time. Source of truth that `static/js/konica-decode.js` was ported from. Outputs an annotated PNG and prints the model code. |
| `analysis_readin.py` | Simpler visual sanity check: overlays the 30-block layout on one sample (no value decoding). |

## `statistical/` — comparative / statistical analysis

Each operates on the corpus of dot `.txt` files (plus `printer_metadata.csv`).
The data-loading loop is duplicated inline across all of them.

| Script | Purpose |
|---|---|
| `total_average.py` | Mean dot matrix across the whole corpus as a heatmap. |
| `rank_similarity.py` | Ranks all files by similarity to `target.txt`; prints a sorted table joined with model/series metadata. |
| `target_vs_other.py` | Averages a target pair vs all others and plots the difference. |
| `magicolor_2300_2430.py` | Splits files into two model groups by metadata and contrasts their averages. |
| `correlation.py` | Pairwise Pearson correlation of dot cells; plots the top-20 co-varying cell pairs. |
| `pca.py` | sklearn PCA → 2D scatter colored by series / styled by brand. |
| `decision_tree.py` | Trains a depth-5 decision tree to classify a model from dot positions; prints accuracy and plots the tree. |

### Dependencies

`numpy`, `matplotlib`, and (for some) `pandas`, `scikit-learn`, `seaborn`;
`select_dots.py` also needs `tkinter` and `Pillow`.
