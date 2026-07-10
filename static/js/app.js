// App bootstrap: tab switching, the calendar feature flag, and initial render.

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = el.id === 'tab-' + tab ? '' : 'none';
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

// The Calendar tab is hidden unless the page is opened with ?calendar in the
// URL. When absent, its button and content are removed from the DOM entirely.
function applyCalendarFlag() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('calendar')) return;
  document.querySelectorAll('[data-tab="calendar"], #tab-calendar').forEach(el => el.remove());
}

applyCalendarFlag();
initGrid();
renderGrid();
initKonica();
