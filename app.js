// Selma — a slow mail journal.
// Everything is stored in this browser (localStorage); there is no server.

const STORE_KEY = 'selma-mail.v1';
const BACKUP_KEY = 'selma-mail.backup';
const REMIND_AFTER_CHANGES = 5;
const SLOW_AFTER_DAYS = 21;
adoptOldStorage();
const state = loadState();
const backup = loadBackupInfo();

const $ = (sel) => document.querySelector(sel);
const mailingDialog = $('#mailing-dialog');
const mailingForm = $('#mailing-form');
const contactDialog = $('#contact-dialog');
const contactForm = $('#contact-form');

const importDialog = $('#import-dialog');

let editingMailingId = null;
let editingContactId = null;
let pendingImport = null;
let calendarYear = new Date().getFullYear();
let calendarDay = null;

const TYPE_LABELS = { postcard: 'Postcard', letter: 'Letter', other: 'Other' };
const TYPE_ICONS = {
  postcard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M12 9v6M6 11h3M6 14h3"/><rect x="15" y="9" width="3" height="3.5"/></svg>',
  letter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3.5 7.5 12 13l8.5-5.5"/></svg>',
  other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5 12 5l8 3.5v8L12 20l-8-3.5z"/><path d="M4 8.5 12 12l8-3.5M12 12v8"/></svg>',
};

// ---------- storage ----------

// The journal used to be saved under plain "selma" names. The other Selma journals share
// this browser storage, so move anything found there to names that are clearly the mail journal's.
function adoptOldStorage() {
  for (const [oldKey, newKey] of [['selma.v1', STORE_KEY], ['selma.backup', BACKUP_KEY]]) {
    const old = localStorage.getItem(oldKey);
    if (old === null) continue;
    if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, old);
    if (localStorage.getItem(newKey) !== null) localStorage.removeItem(oldKey);
  }
}

function loadState() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    if (isValidData(data)) return data;
  } catch {}
  return { mailings: [], contacts: [] };
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  backup.changes += 1;
  saveBackupInfo();
}

// Tracks how much has changed since the last backup. Kept apart from the journal itself.
function loadBackupInfo() {
  try {
    const info = JSON.parse(localStorage.getItem(BACKUP_KEY));
    if (info && typeof info.changes === 'number') return info;
  } catch {}
  // Nothing recorded yet: treat whatever is already in the journal as not backed up.
  return { changes: state.mailings.length + state.contacts.length, lastDate: null, remindAt: REMIND_AFTER_CHANGES };
}

function saveBackupInfo() {
  localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
}

function markBackedUp() {
  backup.changes = 0;
  backup.lastDate = todayStr();
  backup.remindAt = REMIND_AFTER_CHANGES;
  saveBackupInfo();
  renderBackup();
}

function isValidData(data) {
  return Boolean(data) && Array.isArray(data.mailings) && Array.isArray(data.contacts);
}

// ---------- helpers ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Dates are kept as "YYYY-MM-DD" strings and treated as plain calendar days.
function parseDay(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(from, to) {
  const a = parseDay(from), b = parseDay(to);
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5
  );
}

const dayFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const formatDay = (str) => dayFormat.format(parseDay(str));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const addressCount = (n) => `${n} address${n === 1 ? '' : 'es'}`;

function contactById(id) {
  return state.contacts.find((c) => c.id === id);
}

function findContactByName(name) {
  const wanted = name.trim().toLowerCase();
  return state.contacts.find((c) => c.name.trim().toLowerCase() === wanted);
}

function recipientName(mailing) {
  return contactById(mailing.toContactId)?.name ?? mailing.toName;
}

function formatAddress(c) {
  const cityLine = [c.city, c.region, c.postcode].filter(Boolean).join(', ');
  return [c.name, c.line1, c.line2, cityLine, c.country].filter(Boolean).join('\n');
}

// Birthdays are a month and a day, no year. Returns e.g. { text: "Birthday 14 March · in 12 days", soon: true }.
const birthdayFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });
function birthdayInfo(c) {
  if (!c.birthMonth || !c.birthDay) return null;
  const month = Number(c.birthMonth) - 1, day = Number(c.birthDay);
  const text = `Birthday ${birthdayFormat.format(new Date(2024, month, day))}`;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), month, day);
  if (next < today) next = new Date(today.getFullYear() + 1, month, day);
  const daysAway = Math.round((next - today) / 864e5);

  if (daysAway === 0) return { text: `${text} · today`, soon: true };
  if (daysAway <= 21) return { text: `${text} · in ${plural(daysAway, 'day')}`, soon: true };
  return { text, soon: false };
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function emptyState(title, text, action, label) {
  const button = action ? `<button class="btn primary" data-action="${action}">${label}</button>` : '';
  return `<div class="empty"><img src="selma.svg" alt=""><h3>${title}</h3><p>${text}</p>${button}</div>`;
}

// ---------- rendering ----------

function render() {
  renderBackup();
  renderStats();
  renderMailings();
  renderContacts();
  renderCalendar();
  renderSuggestions();
}

function renderBackup() {
  $('#backup-status').textContent = backup.lastDate
    ? `Last backup saved ${formatDay(backup.lastDate)}.`
    : 'No backup saved yet.';

  const nudge = $('#backup-nudge');
  nudge.hidden = backup.changes < backup.remindAt;
  if (nudge.hidden) return;
  const changes = plural(backup.changes, 'change');
  const message = backup.lastDate
    ? `You have made ${changes} since your last backup.`
    : `You have made ${changes} and have not saved a backup yet.`;
  nudge.innerHTML = `<p>${message}</p>
    <button class="btn small primary" data-action="export">Save a backup</button>
    <button class="btn small quiet" data-action="snooze-backup">Later</button>`;
}

function renderStats() {
  const arrived = state.mailings.filter((m) => m.arrivedDate);
  const countries = new Set(state.mailings.map((m) => m.fromCountry?.trim().toLowerCase()).filter(Boolean));
  const average = arrived.length
    ? Math.round(arrived.reduce((sum, m) => sum + daysBetween(m.sentDate, m.arrivedDate), 0) / arrived.length)
    : null;

  const stats = [
    [state.mailings.length, 'sent'],
    [state.mailings.length - arrived.length, 'on their way'],
    [countries.size, countries.size === 1 ? 'country mailed from' : 'countries mailed from'],
    [average === null ? '–' : average, 'average days in transit'],
  ];
  $('#stats').innerHTML = stats.map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');
}

function renderMailings() {
  const list = $('#mailing-list');
  if (!state.mailings.length) {
    list.innerHTML = emptyState('Nothing in the post yet', 'Log your first postcard or letter and Selma will keep track of it.', 'new-mailing', 'Log a mailing');
    return;
  }

  const query = $('#mailing-search').value.trim().toLowerCase();
  const type = $('#mailing-type').value;
  const matches = state.mailings
    .filter((m) => !type || m.type === type)
    .filter((m) => !query || [recipientName(m), m.fromPlace, m.fromCountry, m.notes].join(' ').toLowerCase().includes(query))
    .sort((a, b) => b.sentDate.localeCompare(a.sentDate));

  if (!matches.length) {
    list.innerHTML = emptyState('No matches', 'Try a different search or kind.');
    return;
  }

  let html = '';
  let currentMonth = '';
  for (const m of matches) {
    const month = monthFormat.format(parseDay(m.sentDate));
    if (month !== currentMonth) {
      html += `<h2 class="month-heading">${esc(month)}</h2>`;
      currentMonth = month;
    }
    html += mailingCard(m);
  }
  list.innerHTML = html;
}

function mailingCard(m) {
  const from = [m.fromPlace, m.fromCountry].filter(Boolean).join(', ');
  const destination = contactById(m.toContactId)?.country;
  const meta = [
    TYPE_LABELS[m.type],
    from && `from ${esc(from)}`,
    destination && `to ${esc(destination)}`,
    `sent ${formatDay(m.sentDate)}`,
  ].filter(Boolean).join(' · ');

  let status;
  let nudge = '';
  if (m.arrivedDate) {
    const days = daysBetween(m.sentDate, m.arrivedDate);
    status = `<span class="pill arrived" title="Arrived ${formatDay(m.arrivedDate)}">${days === 0 ? 'Same day' : plural(days, 'day')}</span>`;
  } else {
    const days = Math.max(0, daysBetween(m.sentDate, todayStr()));
    if (days >= SLOW_AFTER_DAYS) {
      nudge = `<p class="meta soon">On its way for ${Math.floor(days / 7)} weeks — worth asking if it arrived?</p>`;
    }
    status = `<span class="pill travelling">On its way · day ${days + 1}</span>
      <button class="link" data-action="mark-arrived" data-id="${m.id}">It arrived</button>`;
  }

  return `<article class="card mailing">
    <div class="mailing-icon ${m.type}">${TYPE_ICONS[m.type]}</div>
    <div class="mailing-body">
      <h3>${esc(recipientName(m))}</h3>
      <p class="meta">${meta}</p>
      ${m.notes ? `<p class="note">${esc(m.notes)}</p>` : ''}
      ${nudge}
      <p class="meta"><button class="link" data-action="edit-mailing" data-id="${m.id}">Edit</button></p>
    </div>
    <div class="mailing-side">${status}</div>
  </article>`;
}

function renderContacts() {
  const list = $('#contact-list');
  if (!state.contacts.length) {
    list.innerHTML = emptyState('Your address book is empty', 'Add the people you write to, so their addresses are always close at hand.', 'new-contact', 'Add an address');
    return;
  }

  const query = $('#contact-search').value.trim().toLowerCase();
  const matches = state.contacts
    .filter((c) => !query || [c.name, c.city, c.region, c.country, c.notes].join(' ').toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!matches.length) {
    list.innerHTML = emptyState('No matches', 'Try a different name or place.');
    return;
  }

  let html = '';
  let currentLetter = '';
  for (const c of matches) {
    const letter = c.name.trim().charAt(0).toUpperCase();
    if (letter !== currentLetter) {
      html += `<h2 class="letter-heading">${esc(letter)}</h2>`;
      currentLetter = letter;
    }
    html += contactCard(c);
  }
  list.innerHTML = html;
}

function contactCard(c) {
  const sent = state.mailings.filter((m) => m.toContactId === c.id);
  const last = sent.map((m) => m.sentDate).sort().pop();
  const history = sent.length ? `${plural(sent.length, 'mailing')} · last sent ${formatDay(last)}` : 'Nothing sent yet';
  const address = formatAddress({ ...c, name: '' });
  const birthday = birthdayInfo(c);

  return `<article class="card contact">
    <div>
      <h3>${esc(c.name)}</h3>
      ${address ? `<address>${esc(address)}</address>` : ''}
      ${c.notes ? `<p class="note">${esc(c.notes)}</p>` : ''}
      ${birthday ? `<p class="meta${birthday.soon ? ' soon' : ''}">${esc(birthday.text)}</p>` : ''}
      <p class="meta">${history}</p>
    </div>
    <div class="contact-actions">
      <button class="btn small" data-action="copy-address" data-id="${c.id}">Copy address</button>
      <button class="btn small" data-action="new-mailing" data-id="${c.id}">Log a mailing</button>
      <button class="btn small quiet" data-action="edit-contact" data-id="${c.id}">Edit</button>
    </div>
  </article>`;
}

// A year at a glance: every day something went in the post is shaded, darker for more.
// Birthdays from the address book get a small dot.
function renderCalendar() {
  const byDay = new Map();
  for (const m of state.mailings) {
    if (!m.sentDate.startsWith(`${calendarYear}-`)) continue;
    byDay.set(m.sentDate, [...(byDay.get(m.sentDate) ?? []), m]);
  }

  const isLeapYear = new Date(calendarYear, 1, 29).getMonth() === 1;
  const birthdaysOn = new Map(); // "month-day" -> contacts
  for (const c of state.contacts) {
    if (!c.birthMonth || !c.birthDay) continue;
    // Someone born on 29 February is shown on the 28th in other years.
    const day = c.birthMonth === '2' && c.birthDay === '29' && !isLeapYear ? 28 : Number(c.birthDay);
    const key = `${Number(c.birthMonth)}-${day}`;
    birthdaysOn.set(key, [...(birthdaysOn.get(key) ?? []), c]);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const today = todayStr();
  const monthName = new Intl.DateTimeFormat(undefined, { month: 'long' });
  const weekdayName = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
  // 1 January 2024 was a Monday; weeks here start on Monday.
  const weekdays = Array.from({ length: 7 }, (_, i) => `<span class="weekday">${weekdayName.format(new Date(2024, 0, i + 1))}</span>`).join('');

  const perMonth = Array(12).fill(0);
  let html = '';
  for (let month = 0; month < 12; month++) {
    const blanks = (new Date(calendarYear, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(calendarYear, month + 1, 0).getDate();
    let days = '<span></span>'.repeat(blanks);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${calendarYear}-${pad(month + 1)}-${pad(day)}`;
      const sent = byDay.get(date) ?? [];
      const birthdays = birthdaysOn.get(`${month + 1}-${day}`) ?? [];
      const todayClass = date === today ? ' today' : '';
      if (!sent.length && !birthdays.length) {
        days += `<span class="day${todayClass}">${day}</span>`;
        continue;
      }
      perMonth[month] += sent.length;
      const label = [
        formatDay(date),
        sent.length && `${plural(sent.length, 'mailing')} to ${sent.map(recipientName).join(', ')}`,
        birthdays.length && `birthday of ${birthdays.map((c) => c.name).join(', ')}`,
      ].filter(Boolean).join(' · ');
      const classes = [
        'day',
        sent.length && `sent-${Math.min(sent.length, 3)}`,
        birthdays.length && 'birthday',
        date === today && 'today',
        date === calendarDay && 'selected',
      ].filter(Boolean).join(' ');
      days += `<button class="${classes}" data-action="show-day" data-date="${date}" title="${esc(label)}" aria-label="${esc(label)}">${day}</button>`;
    }
    html += `<section class="month"><h3>${monthName.format(new Date(calendarYear, month, 1))}</h3><div class="days">${weekdays}${days}</div></section>`;
  }
  $('#calendar').innerHTML = html;
  $('#calendar-year').textContent = calendarYear;

  const total = perMonth.reduce((a, b) => a + b, 0);
  const busiest = perMonth.indexOf(Math.max(...perMonth));
  $('#calendar-summary').textContent = total
    ? `${plural(total, 'mailing')} on ${plural(byDay.size, 'day')} · busiest month: ${monthName.format(new Date(calendarYear, busiest, 1))}`
    : `Nothing posted in ${calendarYear}.`;

  if (!calendarDay) {
    $('#calendar-day').innerHTML = '';
    return;
  }
  const [, chosenMonth, chosenDay] = calendarDay.split('-').map(Number);
  const birthdays = (birthdaysOn.get(`${chosenMonth}-${chosenDay}`) ?? []).map((c) => `<p class="card birthday-line">
      <span>${esc(c.name)}’s birthday</span>
      <button class="link" data-action="new-mailing" data-id="${c.id}">Log a mailing</button>
    </p>`);
  const cards = (byDay.get(calendarDay) ?? []).map(mailingCard);
  $('#calendar-day').innerHTML = `<h2 class="month-heading">${formatDay(calendarDay)}</h2>${birthdays.join('')}${cards.join('')}`;
}

// Autocomplete suggestions for the forms.
function renderSuggestions() {
  const options = (values) => [...new Set(values.filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">`).join('');
  $('#contact-names').innerHTML = options(state.contacts.map((c) => c.name));
  $('#country-names').innerHTML = options([
    ...state.mailings.map((m) => m.fromCountry),
    ...state.contacts.map((c) => c.country),
  ]);
}

// ---------- mailings ----------

function openMailingDialog(mailing, presetContactId) {
  editingMailingId = mailing?.id ?? null;
  mailingForm.reset();
  const f = mailingForm.elements;
  if (mailing) {
    f.type.value = mailing.type;
    f.toName.value = recipientName(mailing);
    f.fromPlace.value = mailing.fromPlace ?? '';
    f.fromCountry.value = mailing.fromCountry ?? '';
    f.sentDate.value = mailing.sentDate;
    f.arrivedDate.value = mailing.arrivedDate ?? '';
    f.notes.value = mailing.notes ?? '';
  } else {
    f.sentDate.value = todayStr();
    f.toName.value = contactById(presetContactId)?.name ?? '';
  }
  f.arrivedDate.min = f.sentDate.value;
  $('#mailing-dialog-title').textContent = mailing ? 'Edit mailing' : 'Log a mailing';
  mailingForm.querySelector('[data-action="delete-mailing"]').hidden = !mailing;
  mailingDialog.showModal();
}

mailingForm.elements.sentDate.addEventListener('change', (e) => {
  mailingForm.elements.arrivedDate.min = e.target.value;
});

mailingForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(mailingForm));
  const toName = data.toName.trim();
  const mailing = {
    id: editingMailingId ?? crypto.randomUUID(),
    type: data.type,
    toName,
    toContactId: findContactByName(toName)?.id ?? null,
    fromPlace: data.fromPlace.trim(),
    fromCountry: data.fromCountry.trim(),
    sentDate: data.sentDate,
    arrivedDate: data.arrivedDate || null,
    notes: data.notes.trim(),
    updatedAt: new Date().toISOString(),
  };
  const index = state.mailings.findIndex((m) => m.id === mailing.id);
  if (index >= 0) state.mailings[index] = mailing;
  else state.mailings.push(mailing);
  saveState();
  render();
  mailingDialog.close();
  toast(index >= 0 ? 'Mailing updated' : 'Mailing logged');
});

function deleteMailing() {
  if (!confirm('Delete this mailing? This cannot be undone.')) return;
  state.mailings = state.mailings.filter((m) => m.id !== editingMailingId);
  saveState();
  render();
  mailingDialog.close();
  toast('Mailing deleted');
}

// ---------- contacts ----------

function openContactDialog(contact) {
  editingContactId = contact?.id ?? null;
  contactForm.reset();
  if (contact) {
    for (const field of ['name', 'line1', 'line2', 'city', 'region', 'postcode', 'country', 'birthMonth', 'birthDay', 'notes']) {
      contactForm.elements[field].value = contact[field] ?? '';
    }
  }
  $('#contact-dialog-title').textContent = contact ? 'Edit address' : 'Add an address';
  contactForm.querySelector('[data-action="delete-contact"]').hidden = !contact;
  contactDialog.showModal();
}

contactForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(contactForm));
  for (const key of Object.keys(data)) data[key] = data[key].trim();
  if (Boolean(data.birthMonth) !== Boolean(data.birthDay)) {
    toast('A birthday needs both a month and a day');
    return;
  }
  // 2024 is a leap year, so 29 February is allowed.
  if (data.birthDay && Number(data.birthDay) > new Date(2024, Number(data.birthMonth), 0).getDate()) {
    toast('That month does not have that many days');
    return;
  }
  const contact = { id: editingContactId ?? crypto.randomUUID(), ...data, updatedAt: new Date().toISOString() };

  const index = state.contacts.findIndex((c) => c.id === contact.id);
  if (index >= 0) {
    state.contacts[index] = contact;
  } else {
    state.contacts.push(contact);
    // Link any earlier mailings that were logged under this name.
    for (const m of state.mailings) {
      if (!m.toContactId && m.toName.trim().toLowerCase() === contact.name.toLowerCase()) m.toContactId = contact.id;
    }
  }
  saveState();
  render();
  contactDialog.close();
  toast(index >= 0 ? 'Address updated' : 'Address saved');
});

function deleteContact() {
  const contact = contactById(editingContactId);
  if (!confirm(`Delete ${contact.name}'s address? Mailings you sent them will be kept.`)) return;
  for (const m of state.mailings) {
    if (m.toContactId === contact.id) {
      m.toName = contact.name;
      m.toContactId = null;
    }
  }
  state.contacts = state.contacts.filter((c) => c.id !== contact.id);
  saveState();
  render();
  contactDialog.close();
  toast('Address deleted');
}

async function copyAddress(id) {
  try {
    await navigator.clipboard.writeText(formatAddress(contactById(id)));
    toast('Address copied');
  } catch {
    toast('Could not copy — select the address instead');
  }
}

// ---------- backup ----------

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `selma-backup-${todayStr()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  markBackedUp();
}

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {}
  if (!isValidData(data)) {
    toast('That file is not a Selma backup');
    return;
  }
  // Nothing here to lose, so there is nothing to ask.
  if (!state.mailings.length && !state.contacts.length) {
    replaceWithBackup(data);
    return;
  }
  pendingImport = data;
  $('#import-summary').textContent = `This backup holds ${plural(data.mailings.length, 'mailing')} and ${addressCount(data.contacts.length)}.`;
  importDialog.showModal();
});

function replaceWithBackup(data) {
  state.mailings = data.mailings;
  state.contacts = data.contacts;
  saveState();
  markBackedUp();
  render();
  toast('Backup restored');
}

// Adds a backup to what is already here. The same entry on both sides is kept once,
// using whichever copy was edited most recently.
function mergeBackup(data) {
  const isNewer = (a, b) => (a.updatedAt ?? '') > (b.updatedAt ?? '');
  const mailingKey = (m) => [m.type, recipientName(m).trim().toLowerCase(), m.sentDate].join('|');
  const localIdFor = new Map(); // contact id in the backup -> contact id here
  let newMailings = 0, newContacts = 0;

  for (const incoming of data.contacts) {
    const existing = contactById(incoming.id) ?? findContactByName(incoming.name);
    if (!existing) {
      state.contacts.push(incoming);
      localIdFor.set(incoming.id, incoming.id);
      newContacts += 1;
      continue;
    }
    localIdFor.set(incoming.id, existing.id);
    if (isNewer(incoming, existing)) Object.assign(existing, incoming, { id: existing.id });
  }

  for (const original of data.mailings) {
    const incoming = { ...original, toContactId: localIdFor.get(original.toContactId) ?? null };
    const key = mailingKey(incoming);
    const existing = state.mailings.find((m) => m.id === incoming.id) ?? state.mailings.find((m) => mailingKey(m) === key);
    if (!existing) {
      state.mailings.push(incoming);
      newMailings += 1;
    } else if (isNewer(incoming, existing)) {
      Object.assign(existing, incoming, { id: existing.id });
    }
  }

  saveState();
  render();
  toast(newMailings || newContacts
    ? `Added ${plural(newMailings, 'mailing')} and ${addressCount(newContacts)}`
    : 'Nothing new in that backup');
}

// ---------- navigation & events ----------

function showView(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const view of ['mailings', 'addresses', 'calendar']) {
    $(`#view-${view}`).hidden = name !== view;
  }
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) return showView(tab.dataset.view);

  const target = e.target.closest('[data-action]');
  if (!target) return;
  const id = target.dataset.id;

  switch (target.dataset.action) {
    case 'new-mailing': openMailingDialog(null, id); break;
    case 'edit-mailing': openMailingDialog(state.mailings.find((m) => m.id === id)); break;
    case 'mark-arrived': {
      openMailingDialog(state.mailings.find((m) => m.id === id));
      const arrived = mailingForm.elements.arrivedDate;
      arrived.value = todayStr();
      arrived.focus();
      break;
    }
    case 'delete-mailing': deleteMailing(); break;
    case 'new-contact': openContactDialog(); break;
    case 'edit-contact': openContactDialog(contactById(id)); break;
    case 'delete-contact': deleteContact(); break;
    case 'copy-address': copyAddress(id); break;
    case 'close-dialog': target.closest('dialog').close(); break;
    case 'export': exportBackup(); break;
    case 'snooze-backup':
      backup.remindAt = backup.changes + REMIND_AFTER_CHANGES;
      saveBackupInfo();
      renderBackup();
      break;
    case 'import': $('#import-file').click(); break;
    case 'import-merge':
      importDialog.close();
      mergeBackup(pendingImport);
      break;
    case 'import-replace':
      if (!confirm('Erase what is on this device and use only the backup? This cannot be undone.')) break;
      importDialog.close();
      replaceWithBackup(pendingImport);
      break;
    case 'prev-year': calendarYear -= 1; calendarDay = null; renderCalendar(); break;
    case 'next-year': calendarYear += 1; calendarDay = null; renderCalendar(); break;
    case 'show-day':
      calendarDay = target.dataset.date === calendarDay ? null : target.dataset.date;
      renderCalendar();
      break;
  }
});

$('#mailing-search').addEventListener('input', renderMailings);
$('#mailing-type').addEventListener('change', renderMailings);
$('#contact-search').addEventListener('input', renderContacts);

render();

// Lets Selma open without a connection once she has been visited.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
