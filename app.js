// Selma — a slow mail journal.
// Everything is stored in this browser (localStorage); there is no server.

const STORE_KEY = 'selma.v1';
const state = loadState();

const $ = (sel) => document.querySelector(sel);
const mailingDialog = $('#mailing-dialog');
const mailingForm = $('#mailing-form');
const contactDialog = $('#contact-dialog');
const contactForm = $('#contact-form');

let editingMailingId = null;
let editingContactId = null;

const TYPE_LABELS = { postcard: 'Postcard', letter: 'Letter', other: 'Other' };
const TYPE_ICONS = {
  postcard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M12 9v6M6 11h3M6 14h3"/><rect x="15" y="9" width="3" height="3.5"/></svg>',
  letter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3.5 7.5 12 13l8.5-5.5"/></svg>',
  other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5 12 5l8 3.5v8L12 20l-8-3.5z"/><path d="M4 8.5 12 12l8-3.5M12 12v8"/></svg>',
};

// ---------- storage ----------

function loadState() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    if (isValidData(data)) return data;
  } catch {}
  return { mailings: [], contacts: [] };
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
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
  renderStats();
  renderMailings();
  renderContacts();
  renderSuggestions();
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
  if (m.arrivedDate) {
    const days = daysBetween(m.sentDate, m.arrivedDate);
    status = `<span class="pill arrived" title="Arrived ${formatDay(m.arrivedDate)}">${days === 0 ? 'Same day' : plural(days, 'day')}</span>`;
  } else {
    const days = Math.max(0, daysBetween(m.sentDate, todayStr()));
    status = `<span class="pill travelling">On its way · day ${days + 1}</span>
      <button class="link" data-action="mark-arrived" data-id="${m.id}">It arrived</button>`;
  }

  return `<article class="card mailing">
    <div class="mailing-icon ${m.type}">${TYPE_ICONS[m.type]}</div>
    <div class="mailing-body">
      <h3>${esc(recipientName(m))}</h3>
      <p class="meta">${meta}</p>
      ${m.notes ? `<p class="note">${esc(m.notes)}</p>` : ''}
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
  const contact = { id: editingContactId ?? crypto.randomUUID(), ...data };

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
  const summary = `${plural(data.mailings.length, 'mailing')} and ${plural(data.contacts.length, 'address')}`.replace('addresss', 'addresses');
  if (!confirm(`Replace everything here with the backup (${summary})?`)) return;
  state.mailings = data.mailings;
  state.contacts = data.contacts;
  saveState();
  render();
  toast('Backup restored');
});

// ---------- navigation & events ----------

function showView(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  $('#view-mailings').hidden = name !== 'mailings';
  $('#view-addresses').hidden = name !== 'addresses';
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
    case 'import': $('#import-file').click(); break;
  }
});

$('#mailing-search').addEventListener('input', renderMailings);
$('#mailing-type').addEventListener('change', renderMailings);
$('#contact-search').addEventListener('input', renderContacts);

render();
