// Loading and saving grids — entirely client-side (no server).
// Save writes a .txt (CSV) and a .png screenshot as browser downloads.

async function makeScreenshotBlob() {
  document.querySelectorAll('.dot.parity-dot').forEach(dot => {
    dot.classList.remove('parity-good', 'parity-bad');
  });
  const target = document.querySelector('.grid-wrapper');
  const bar = document.getElementById('decoded-bar');
  const parity = document.getElementById('parity-live');
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:inline-block; background:#16213e; padding:1rem; border-radius:8px;';
  target.parentNode.insertBefore(wrapper, target);
  wrapper.appendChild(target);
  wrapper.appendChild(bar);
  try {
    const canvas = await html2canvas(wrapper, { backgroundColor: '#16213e' });
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  } finally {
    wrapper.parentNode.insertBefore(target, wrapper);
    wrapper.parentNode.insertBefore(bar, wrapper);
    wrapper.parentNode.insertBefore(parity, wrapper.nextSibling);
    wrapper.remove();
    updateParityIndicators();
  }
}

async function saveAll() {
  const name = prompt('File name:', 'xerox_mic');
  if (name === null) return;
  const prefix = name || 'xerox_mic';

  // Download straight to the browser's download folder. The File System Access
  // directory picker is deliberately avoided: Chrome blocks "system" folders
  // (including the localhost project dir), which just fails the save.
  const lines = grid.map(row => row.join(','));
  const txtBlob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const txtUrl = URL.createObjectURL(txtBlob);
  const a = document.createElement('a');
  a.href = txtUrl;
  a.download = prefix + '.txt';
  a.click();
  URL.revokeObjectURL(txtUrl);

  const pngBlob = await makeScreenshotBlob();
  const pngUrl = URL.createObjectURL(pngBlob);
  const link = document.createElement('a');
  link.href = pngUrl;
  link.download = prefix + '.png';
  link.click();
  URL.revokeObjectURL(pngUrl);
}

// Load a single grid file into the editor, parsing and decoding client-side.
function loadFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('upload-status');
  const reader = new FileReader();
  reader.onload = () => {
    const g = parseGridFromText(reader.result);
    if (!g) {
      statusEl.textContent = 'Invalid grid (need 8 rows x 15 columns of 0/1)';
      return;
    }
    grid = g;
    renderGrid();
    statusEl.textContent = 'Loaded: ' + file.name;
  };
  reader.onerror = () => { statusEl.textContent = 'Could not read ' + file.name; };
  reader.readAsText(file);
  e.target.value = '';
}
