// App bootstrap: tab switching, the calendar feature flag, and initial render.

function switchTab(tab, updateUrl = true) {
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = el.id === 'tab-' + tab ? '' : 'none';
  });
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // Remember the tab in the URL hash so a refresh lands back here.
  if (updateUrl && window.location.hash.replace('#', '') !== tab) {
    history.replaceState(null, '', '#' + tab);
  }
}

// The Calendar tab is hidden unless the page is opened with ?calendar in the
// URL. When absent, its button and content are removed from the DOM entirely.
function applyCalendarFlag() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('calendar')) return;
  document.querySelectorAll('[data-tab="calendar"], #tab-calendar').forEach(el => el.remove());
}

// Open a specific tab on load via the URL, so a refresh keeps you where you
// were. Accepts ?tab=xerox|konica|calendar, plus a few friendly aliases, and
// also honors a matching #hash (e.g. index.html#konica).
function applyInitialTab() {
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get('tab') || window.location.hash.replace('#', '') || '').toLowerCase();
  const aliases = {
    xerox: 'xerox',
    konica: 'konica', km: 'konica', 'konica-minolta': 'konica', minolta: 'konica',
    calendar: 'calendar', cal: 'calendar',
  };
  const tab = aliases[raw];
  // Only switch if the tab exists (calendar may have been removed above).
  if (tab && document.getElementById('tab-' + tab)) switchTab(tab);
}

applyCalendarFlag();
initGrid();
renderGrid();
initKonica();
initKonicaSamples(); // async; populates the sample dropdown if any files exist
applyInitialTab();
