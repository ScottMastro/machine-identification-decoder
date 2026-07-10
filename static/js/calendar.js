// Print Activity Calendar: batch-decode grid files and plot which days printed.
// Gated behind the ?calendar URL flag (see app.js).

let calendarEntries = [];
let printsByDate = {};
let calViewYear = 2026;
let calSelectedDate = null;

function handleCalendarUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  const statusEl = document.getElementById('cal-status');
  statusEl.innerHTML = 'Reading files...';
  calendarEntries = [];
  printsByDate = {};
  calSelectedDate = null;
  document.getElementById('cal-detail').style.display = 'none';

  const readers = files.map(file => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, text: reader.result });
    reader.onerror = () => resolve({ name: file.name, text: null });
    reader.readAsText(file);
  }));

  Promise.all(readers).then(results => {
    let decoded = 0, errors = 0;
    results.forEach(({ name, text }) => {
      if (!text) { errors++; return; }
      const g = parseGridFromText(text);
      if (!g) { errors++; return; }
      const d = decodeGridData(g);
      if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > 31) { errors++; return; }
      const pad = n => String(n).padStart(2, '0');
      const dateKey = d.year + '-' + pad(d.month) + '-' + pad(d.day);
      const entry = { filename: name, serial: d.serial, hour: d.hour, minute: d.minute, dateKey };
      calendarEntries.push(entry);
      if (!printsByDate[dateKey]) printsByDate[dateKey] = [];
      printsByDate[dateKey].push(entry);
      decoded++;
    });

    let statusHTML = '<span class="count">' + decoded + ' file' + (decoded !== 1 ? 's' : '') + ' decoded</span>';
    if (errors > 0) statusHTML += ', <span class="errors">' + errors + ' skipped</span>';
    statusEl.innerHTML = statusHTML;

    if (decoded > 0) {
      const dates = Object.keys(printsByDate).sort();
      calViewYear = parseInt(dates[0].split('-')[0]);
      document.getElementById('cal-panel').style.display = '';
      renderCalendar();
    } else {
      document.getElementById('cal-panel').style.display = 'none';
    }

    event.target.value = '';
  });
}

function renderCalendar() {
  document.getElementById('cal-year-label').textContent = calViewYear;
  const container = document.getElementById('cal-year-grid');
  container.innerHTML = '';
  const pad = n => String(n).padStart(2, '0');

  for (let month = 1; month <= 12; month++) {
    const card = document.createElement('div');
    card.className = 'cal-month-card';

    const title = document.createElement('div');
    title.className = 'cal-month-title';
    title.textContent = MONTHS_FULL[month];
    card.appendChild(title);

    const gridEl = document.createElement('div');
    gridEl.className = 'cal-grid';

    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => {
      const div = document.createElement('div');
      div.className = 'cal-dow';
      div.textContent = d;
      gridEl.appendChild(div);
    });

    const firstDay = new Date(calViewYear, month - 1, 1).getDay();
    const daysInMonth = new Date(calViewYear, month, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      const div = document.createElement('div');
      div.className = 'cal-day';
      gridEl.appendChild(div);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = calViewYear + '-' + pad(month) + '-' + pad(d);
      const div = document.createElement('div');
      div.className = 'cal-day';
      div.textContent = d;

      if (printsByDate[dateKey]) {
        div.classList.add('has-prints');
        if (calSelectedDate === dateKey) div.classList.add('selected');
        div.addEventListener('click', () => onCalendarDayClick(dateKey));
      }

      gridEl.appendChild(div);
    }

    card.appendChild(gridEl);
    container.appendChild(card);
  }
}

function calPrevYear() {
  calViewYear--;
  calSelectedDate = null;
  document.getElementById('cal-detail').style.display = 'none';
  renderCalendar();
}

function calNextYear() {
  calViewYear++;
  calSelectedDate = null;
  document.getElementById('cal-detail').style.display = 'none';
  renderCalendar();
}

function onCalendarDayClick(dateKey) {
  if (calSelectedDate === dateKey) {
    calSelectedDate = null;
    document.getElementById('cal-detail').style.display = 'none';
    renderCalendar();
    return;
  }
  calSelectedDate = dateKey;
  renderCalendar();

  const entries = printsByDate[dateKey].slice().sort((a, b) => {
    return (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute);
  });

  const parts = dateKey.split('-');
  const m = parseInt(parts[1]);
  const d = parseInt(parts[2]);
  document.getElementById('cal-detail-title').textContent =
    'Prints on ' + d + ' ' + MONTHS[m] + ' ' + parts[0];

  const tbody = document.getElementById('cal-detail-body');
  tbody.innerHTML = '';
  const pad = n => String(n).padStart(2, '0');
  entries.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + e.filename + '</td><td>' + e.serial + '</td><td>' + pad(e.hour) + ':' + pad(e.minute) + '</td>';
    tbody.appendChild(tr);
  });

  document.getElementById('cal-detail').style.display = '';
}
