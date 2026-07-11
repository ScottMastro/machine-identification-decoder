// Optional sample library for the Konica tab. Drop decoded 16x24 dot .txt
// files into the (gitignored) `samples/` directory and they show up in a
// dropdown. An optional `samples/meta.txt` (JSON) can attach info to each file.
//
// Files are discovered two ways, unioned together:
//   1. `samples/meta.txt` — JSON, either a map {"file.txt": {...meta}}, an
//      array [{name, ...}] / ["file.txt", ...], or {"files": [...]}.
//   2. The directory listing served by a static HTTP server (e.g.
//      `python -m http.server`), parsed for .txt links.
// If nothing is found (or the site is opened via file://, where fetch is
// blocked), the dropdown stays hidden.

const KONICA_SAMPLES_DIR = 'samples/';
let konicaSampleMeta = {}; // filename -> arbitrary metadata object

function konicaEscapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Pull filenames (and metadata) out of a parsed meta.txt payload.
function konicaCollectMetaFiles(data, files) {
  const addEntry = e => {
    const name = typeof e === 'string' ? e : (e && e.name);
    if (!name) return;
    files.push(name);
    if (e && typeof e === 'object') konicaSampleMeta[name] = e;
  };
  if (Array.isArray(data)) {
    data.forEach(addEntry);
  } else if (data && Array.isArray(data.files)) {
    data.files.forEach(addEntry);
  } else if (data && typeof data === 'object') {
    for (const [name, meta] of Object.entries(data)) {
      files.push(name);
      if (meta && typeof meta === 'object') konicaSampleMeta[name] = meta;
    }
  }
}

async function initKonicaSamples() {
  const select = document.getElementById('konica-samples');
  const wrap = document.getElementById('konica-samples-wrap');
  if (!select) return;

  konicaSampleMeta = {};
  let files = [];

  // 1) Optional meta.txt (JSON).
  try {
    const res = await fetch(KONICA_SAMPLES_DIR + 'meta.txt', { cache: 'no-store' });
    if (res.ok) konicaCollectMetaFiles(JSON.parse(await res.text()), files);
  } catch (e) { /* no meta.txt, or invalid JSON, or file:// */ }

  // 2) Directory autoindex (only when served over HTTP).
  try {
    const res = await fetch(KONICA_SAMPLES_DIR, { cache: 'no-store' });
    if (res.ok) {
      const html = await res.text();
      const re = /href="([^"?#]+\.txt)"/gi;
      let m;
      while ((m = re.exec(html))) {
        const name = decodeURIComponent(m[1].replace(/^.*\//, ''));
        if (name) files.push(name);
      }
    }
  } catch (e) { /* no listing, or file:// */ }

  // Dedupe, drop meta.txt itself, sort.
  files = [...new Set(files)]
    .filter(n => n && n.toLowerCase() !== 'meta.txt')
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    if (wrap) wrap.style.display = 'none';
    return;
  }

  select.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'Load a sample…';
  select.appendChild(def);
  for (const name of files) {
    const opt = document.createElement('option');
    opt.value = name;
    const meta = konicaSampleMeta[name];
    opt.textContent = meta && meta.label ? (name + ' — ' + meta.label) : name;
    select.appendChild(opt);
  }
  if (wrap) wrap.style.display = '';
}

// Load the chosen sample into the board and (optionally) show its metadata.
async function onKonicaSampleSelect(e) {
  const name = e.target.value;
  const statusEl = document.getElementById('konica-status');
  if (!name) { currentKonicaSampleName = null; renderKonicaSampleMeta(null); return; }
  currentKonicaSampleName = name;

  try {
    const res = await fetch(KONICA_SAMPLES_DIR + encodeURIComponent(name), { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    const g = parseKonicaGrid(await res.text());
    if (!g) { if (statusEl) statusEl.textContent = 'Invalid grid in ' + name; return; }

    konicaMatrix = konicaMatrixFromGrid(g);
    syncKonicaBoxValues();

    // A sample may declare which scheme it uses; if so, switch to it.
    const meta = konicaSampleMeta[name];
    if (meta && (meta.codeType === 'old' || meta.codeType === 'new')) {
      setKonicaCodeType(meta.codeType); // re-renders board + decode
    } else {
      renderKonicaBoard();
      runKonicaDecode();
    }
    if (statusEl) statusEl.textContent = 'Source: ' + name;
    renderKonicaSampleMeta(name);
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Could not load ' + name;
  }
}

// Show the selected sample's metadata as key/value chips (label/codeType are
// already reflected elsewhere, so they're skipped here).
function renderKonicaSampleMeta(name) {
  const el = document.getElementById('konica-sample-meta');
  if (!el) return;
  const meta = name ? konicaSampleMeta[name] : null;
  if (!meta || typeof meta !== 'object') { el.innerHTML = ''; return; }
  const entries = Object.entries(meta).filter(([k]) => k !== 'name' && k !== 'label' && k !== 'codeType');
  el.innerHTML = entries.map(([k, v]) =>
    '<span class="ksample-field"><span class="ksample-key">' + konicaEscapeHtml(k) + '</span> '
    + konicaEscapeHtml(typeof v === 'object' ? JSON.stringify(v) : v) + '</span>'
  ).join('');
}
