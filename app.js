// -- Storage helpers ----------------------------------------------
const load = key => JSON.parse(localStorage.getItem(key) || '[]');
const save = (key, val) => localStorage.setItem(key, JSON.stringify(val));

// -- Runtime environment detection --------------------------------
// true only when running inside the Electron desktop app
const IS_DESKTOP = !!window.electronAPI;

let customers = load('customers');
let transactions = load('transactions');
let kataEntries = load('kataEntries');
let products = load('products');
const DEFAULT_REMINDER = `?? *{shop}*

Vanakkam {name},

This is a gentle reminder that the following payment is pending:

{items}

*Total Due: {total}*

Kindly settle the amount at your earliest convenience.
{upi}

Thank you! ??`;

let settings = JSON.parse(localStorage.getItem('settings') || JSON.stringify({
  nameTamil: '',
  nameEnglish: '',
  phone: '',
  addr1: '',
  addr2: '',
  city: '',
  state: '',
  upi: '',
  gst: '',
  footer: 'Thank you for your business!',
  reminderTemplate: DEFAULT_REMINDER
}));
// backfill reminderTemplate if missing from older saved settings
if (!settings.reminderTemplate) {
  settings.reminderTemplate = DEFAULT_REMINDER;
  localStorage.setItem('settings', JSON.stringify(settings));
}

// -- Navigation ---------------------------------------------------
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(item.dataset.page).classList.add('active');
    if (item.dataset.page === 'dashboard') renderDashboard();
    if (item.dataset.page === 'messages') renderMsgCheckboxes();
    if (item.dataset.page === 'products') renderProducts();
    if (item.dataset.page === 'settings') loadSettingsForm();
    if (item.dataset.page === 'billing') setBillPaidStatus('paid');
  });
});

// -- Confirm Dialog ----------------------------------------------
function showDialog(msg, onConfirm) {
  document.getElementById('confirm-modal-msg').textContent = msg;
  const btn = document.getElementById('confirm-modal-ok');
  btn.onclick = () => { closeModal('confirm-modal'); onConfirm(); };
  openModal('confirm-modal');
}

// -- Toast --------------------------------------------------------
function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  setTimeout(() => t.className = 'toast hidden', 3000);
}

// -- Modal --------------------------------------------------------
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// -- Dashboard ----------------------------------------------------
function renderDashboard() {
  const today = new Date().toDateString();
  const todayTxns = transactions.filter(t => new Date(t.date).toDateString() === today);
  const totalUnpaid = kataEntries.filter(k => k.paidStatus === 'unpaid').reduce((s, k) => s + k.total, 0);

  document.getElementById('stat-customers').textContent = customers.length;
  document.getElementById('stat-txns').textContent = transactions.length;
  document.getElementById('stat-today').textContent = '?' + todayTxns.reduce((s, t) => s + t.total, 0).toFixed(2);
  document.getElementById('stat-revenue').textContent = '?' + transactions.reduce((s, t) => s + t.total, 0).toFixed(2);

  const unpaidEl = document.getElementById('stat-unpaid');
  if (unpaidEl) unpaidEl.textContent = '?' + totalUnpaid.toFixed(2);

  const tbody = document.getElementById('recent-txns-body');
  const recent = [...transactions].reverse().slice(0, 8);
  tbody.innerHTML = recent.map(t => `
    <tr>
      <td>${new Date(t.date).toLocaleDateString('en-IN')}</td>
      <td>${t.customerName || 'Walk-in'}</td>
      <td>${t.items.map(i => i.name).join(', ')}</td>
      <td>?${t.total.toFixed(2)}</td>
      <td><span class="badge-${t.paidStatus === 'unpaid' ? 'unpaid' : 'paid'}">${t.paidStatus === 'unpaid' ? '? Unpaid' : '? Paid'}</span></td>
    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">No transactions yet</td></tr>';
}

// -- Customers ----------------------------------------------------
function getCustomerUnpaid(customerId) {
  return kataEntries.filter(k => k.customerId === customerId && k.paidStatus === 'unpaid')
    .reduce((s, k) => s + k.total, 0);
}

function renderCustomers() {
  const tbody = document.getElementById('customers-body');
  tbody.innerHTML = customers.map(c => {
    const unpaid = getCustomerUnpaid(c.id);
    const unpaidCount = kataEntries.filter(k => k.customerId === c.id && k.paidStatus === 'unpaid').length;
    return `<tr>
      <td>${c.name}</td>
      <td>${c.phone}</td>
      <td>${c.email || '-'}</td>
      <td>
        ${unpaid > 0
          ? `<span class="badge-unpaid">? ?${unpaid.toFixed(2)} (${unpaidCount} item${unpaidCount > 1 ? 's' : ''})</span>`
          : `<span class="badge-paid">? Clear</span>`}
      </td>
      <td>
        <button class="btn-kata" onclick="openKataBook('${c.id}')">?? Kata</button>
        ${unpaid > 0 ? `<button class="btn-remind" onclick="sendPaymentReminder('${c.id}')">?? Remind</button>` : ''}
        <button class="btn-edit" onclick="editCustomer('${c.id}')">?? Edit</button>
        <button class="btn-danger" onclick="deleteCustomer('${c.id}')">???</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">No customers added</td></tr>';
  refreshCustomerDropdowns();
}

function saveCustomer() {
  const id = document.getElementById('edit-customer-id').value;
  const name = document.getElementById('c-name').value.trim();
  const phone = document.getElementById('c-phone').value.trim();
  if (!name || !phone) return toast('Name and Phone are required', 'error');
  if (!/^\d{10}$/.test(phone)) return toast('Enter a valid 10-digit phone number', 'error');

  const customer = { id: id || Date.now().toString(), name, phone, email: document.getElementById('c-email').value.trim(), address: document.getElementById('c-address').value.trim() };
  if (id) {
    customers = customers.map(c => c.id === id ? customer : c);
  } else {
    customers.push(customer);
  }
  save('customers', customers);
  closeModal('customer-modal');
  renderCustomers();
  toast(id ? 'Customer updated!' : 'Customer added!');
}

function editCustomer(id) {
  const c = customers.find(x => x.id === id);
  document.getElementById('customer-modal-title').textContent = 'Edit Customer';
  document.getElementById('edit-customer-id').value = c.id;
  document.getElementById('c-name').value = c.name;
  document.getElementById('c-phone').value = c.phone;
  document.getElementById('c-email').value = c.email || '';
  document.getElementById('c-address').value = c.address || '';
  openModal('customer-modal');
}

function deleteCustomer(id) {
  showDialog('Delete this customer?', () => {
    customers = customers.filter(c => c.id !== id);
    save('customers', customers);
    renderCustomers();
    toast('Customer deleted');
  });
}

document.getElementById('customer-modal').addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal('customer-modal');
});
document.getElementById('kata-modal').addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal('kata-modal');
});
document.getElementById('reminder-modal').addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal('reminder-modal');
});

// Reset modal on open
window.openModal = function(id) {
  if (id === 'product-modal') {
    document.getElementById('product-modal-title').textContent = 'Add Product';
    document.getElementById('edit-product-id').value = '';
    ['p-name','p-price','p-unit'].forEach(f => document.getElementById(f).value = '');
    document.getElementById('p-category').value = 'Xerox';
  }
  if (id === 'customer-modal') {
    document.getElementById('customer-modal-title').textContent = 'Add Customer';
    document.getElementById('edit-customer-id').value = '';
    ['c-name','c-phone','c-email','c-address'].forEach(f => document.getElementById(f).value = '');
  }
  if (id === 'txn-modal') {
    document.getElementById('txn-items-list').innerHTML = '';
    document.getElementById('txn-total-val').textContent = '0.00';
    setTxnPaidStatus('paid');
    addTxnItem();
  }
  document.getElementById(id).classList.remove('hidden');
};

// -- Payment Reminder -------------------------------------------
let _reminderCustomerId = null;

function sendPaymentReminder(customerId) {
  const c = customers.find(x => x.id === customerId);
  const unpaidEntries = kataEntries.filter(k => k.customerId === customerId && k.paidStatus === 'unpaid');
  const total = unpaidEntries.reduce((s, k) => s + k.total, 0);

  const itemLines = unpaidEntries.map(k =>
    `  • ${k.items.map(i => `${i.name} x${i.qty}`).join(', ')} — ?${k.total.toFixed(2)} (${new Date(k.date).toLocaleDateString('en-IN')})`
  ).join('\n');

  const template = settings.reminderTemplate || '';
  const upiLine = settings.upi ? `Pay via UPI: ${settings.upi}` : '';

  const message = template
    .replace(/{name}/g, c.name)
    .replace(/{shop}/g, `${settings.nameTamil} - ${settings.nameEnglish}`)
    .replace(/{items}/g, itemLines)
    .replace(/{total}/g, `?${total.toFixed(2)}`)
    .replace(/{phone}/g, settings.phone || '')
    .replace(/{upi}/g, upiLine);

  _reminderCustomerId = customerId;
  document.getElementById('reminder-msg-text').value = message;
  openModal('reminder-modal');
}

async function confirmSendReminder() {
  if (!IS_DESKTOP) {
    toast('WhatsApp reminders only work in the desktop app', 'error');
    return;
  }
  const c = customers.find(x => x.id === _reminderCustomerId);
  const message = document.getElementById('reminder-msg-text').value.trim();
  if (!message) return toast('Message cannot be empty', 'error');

  try {
    const res = await fetch(`${WA_SERVER}/send-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: [c], message })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    const ok = data.results[0]?.status === 'sent';
    closeModal('reminder-modal');
    toast(ok ? `? Reminder sent to ${c.name}!` : `? Failed to send`, ok ? 'success' : 'error');
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

function insertTag(tag) {
  const ta = document.getElementById('s-reminder');
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos) + tag + ta.value.slice(ta.selectionEnd);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos + tag.length;
}

// -- Kata Book ----------------------------------------------------
function openKataBook(customerId) {
  const c = customers.find(x => x.id === customerId);
  document.getElementById('kata-modal-title').textContent = `?? ${c.name} — ????? ????????`;
  renderKataEntries(customerId);
  openModal('kata-modal');
}

function renderKataEntries(customerId) {
  const entries = kataEntries.filter(k => k.customerId === customerId);
  const container = document.getElementById('kata-entries');
  const totalUnpaid = entries.filter(k => k.paidStatus === 'unpaid').reduce((s, k) => s + k.total, 0);

  if (!entries.length) {
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:20px">No entries yet</p>';
    document.getElementById('kata-total').textContent = '?0.00';
    return;
  }

  container.innerHTML = [...entries].reverse().map(k => `
    <div class="kata-entry ${k.paidStatus === 'paid' ? 'paid-entry' : ''}">
      <div class="kata-entry-info">
        <div class="kata-date">${new Date(k.date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}
          ${k.paidStatus === 'paid' ? `<span style="color:#16a34a;margin-left:6px">? Paid on ${new Date(k.paidOn).toLocaleDateString('en-IN')}</span>` : ''}
        </div>
        <div class="kata-items">${k.items.map(i => `${i.name} x${i.qty}`).join(', ')}</div>
      </div>
      <div class="kata-entry-amt ${k.paidStatus === 'paid' ? 'paid-amt' : ''}">?${k.total.toFixed(2)}</div>
      ${k.paidStatus === 'unpaid'
        ? `<button class="btn-pay" onclick="markKataPaid('${k.id}','${customerId}')">? Mark Paid</button>`
        : `<span style="font-size:.78rem;color:#16a34a;font-weight:600">PAID</span>`}
    </div>`).join('');

  document.getElementById('kata-total').textContent = '?' + totalUnpaid.toFixed(2);
}

function markKataPaid(kataId, customerId) {
  const kata = kataEntries.find(k => k.id === kataId);
  kataEntries = kataEntries.map(k => k.id === kataId ? { ...k, paidStatus: 'paid', paidOn: new Date().toISOString() } : k);
  save('kataEntries', kataEntries);

  // sync matching transaction to paid — use txnId if available, else fallback
  if (kata) {
    transactions = transactions.map(t => {
      const matchById   = kata.txnId && t.id === kata.txnId;
      const matchByBill = kata.billNo && t.billNo === kata.billNo;
      const matchByTime = t.customerId === kata.customerId && t.paidStatus === 'unpaid' &&
        new Date(t.date).toISOString().slice(0,16) === new Date(kata.date).toISOString().slice(0,16);
      return (matchById || matchByBill || matchByTime) ? { ...t, paidStatus: 'paid' } : t;
    });
    save('transactions', transactions);
  }

  renderKataEntries(customerId);
  renderCustomers();
  renderTransactions();
  renderDashboard();
  toast('Marked as Paid! ?');
}

// -- Products --------------------------------------------
function renderProducts() {
  const tbody = document.getElementById('products-body');
  tbody.innerHTML = products.map(p => `
    <tr>
      <td>${p.name}</td>
      <td><span class="cat-badge">${p.category}</span></td>
      <td>?${parseFloat(p.price).toFixed(2)} <span style="color:#94a3b8;font-size:.78rem">${p.unit || ''}</span></td>
      <td>
        <button class="btn-edit" onclick="editProduct('${p.id}')">?? Edit</button>
        <button class="btn-danger" onclick="deleteProduct('${p.id}')">???</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">No products added yet</td></tr>';
}

function saveProduct() {
  const id = document.getElementById('edit-product-id').value;
  const name = document.getElementById('p-name').value.trim();
  const price = document.getElementById('p-price').value;
  if (!name) return toast('Product name is required', 'error');
  if (!price || isNaN(price)) return toast('Enter a valid price', 'error');

  const product = {
    id: id || Date.now().toString(),
    name,
    category: document.getElementById('p-category').value,
    price: parseFloat(price),
    unit: document.getElementById('p-unit').value.trim()
  };
  if (id) {
    products = products.map(p => p.id === id ? product : p);
  } else {
    products.push(product);
  }
  save('products', products);
  closeModal('product-modal');
  renderProducts();
  refreshItemDropdowns();
  toast(id ? 'Product updated!' : 'Product added!');
}

function editProduct(id) {
  const p = products.find(x => x.id === id);
  document.getElementById('product-modal-title').textContent = 'Edit Product';
  document.getElementById('edit-product-id').value = p.id;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-category').value = p.category;
  document.getElementById('p-price').value = p.price;
  document.getElementById('p-unit').value = p.unit || '';
  openModal('product-modal');
}

function deleteProduct(id) {
  showDialog('Delete this product?', () => {
    products = products.filter(p => p.id !== id);
    save('products', products);
    renderProducts();
    refreshItemDropdowns();
    toast('Product deleted');
  });
}

document.getElementById('product-modal').addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal('product-modal');
});

// -- Paid/Unpaid Toggle -------------------------------------------
function setBillPaidStatus(status) {
  document.getElementById('bill-paid-status').value = status;
  document.getElementById('bill-paid-btn').classList.toggle('active', status === 'paid');
  document.getElementById('bill-unpaid-btn').classList.toggle('active', status === 'unpaid');
}

function setTxnPaidStatus(status) {
  document.getElementById('txn-paid-status').value = status;
  document.getElementById('txn-paid-btn').classList.toggle('active', status === 'paid');
  document.getElementById('txn-unpaid-btn').classList.toggle('active', status === 'unpaid');
}

// -- Customer Dropdowns -------------------------------------------
function refreshCustomerDropdowns() {
  const opts = `<option value="">-- Walk-in / Select --</option>` + customers.map(c => `<option value="${c.id}">${c.name} (${c.phone})</option>`).join('');
  document.getElementById('txn-customer').innerHTML = opts;
  const billOpts = `<option value="">-- Select Customer --</option>` + customers.map(c => `<option value="${c.id}">${c.name} (${c.phone})</option>`).join('');
  document.getElementById('bill-customer').innerHTML = billOpts;
}

// -- Item Rows (shared) -------------------------------------------
function getProductOptions() {
  if (products.length === 0) {
    return `<option value="">-- No products, add in Products page --</option>`;
  }
  const grouped = {};
  products.forEach(p => {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  });
  return Object.entries(grouped).map(([cat, items]) =>
    `<optgroup label="${cat}">${items.map(p => `<option value="${p.id}" data-price="${p.price}">${p.name} (?${p.price})</option>`).join('')}</optgroup>`
  ).join('');
}

function itemRowHTML(prefix, idx) {
  return `<div class="bill-item-row" id="${prefix}-row-${idx}">
    <select onchange="onProductSelect(this,'${prefix}')">
      <option value="">-- Select Product --</option>
      ${getProductOptions()}
    </select>
    <input type="number" min="1" value="1" placeholder="Qty" onchange="calcTotal('${prefix}')" />
    <input type="number" min="0" step="0.5" value="0" placeholder="Rate ?" onchange="calcTotal('${prefix}')" />
    <button class="btn-danger" onclick="removeItemRow('${prefix}',${idx})">?</button>
  </div>`;
}

function onProductSelect(selectEl, prefix) {
  const selected = selectEl.options[selectEl.selectedIndex];
  const price = selected?.dataset?.price || 0;
  const row = selectEl.closest('.bill-item-row');
  row.querySelectorAll('input')[1].value = price;
  calcTotal(prefix);
}

function refreshItemDropdowns() {
  const newOpts = `<option value="">-- Select Product --</option>${getProductOptions()}`;
  document.querySelectorAll('.bill-item-row select').forEach(sel => {
    const currentVal = sel.value;
    sel.innerHTML = newOpts;
    sel.value = currentVal; // restore previously selected value
  });
}

let billIdx = 0, txnIdx = 0;

function addBillItem() {
  document.getElementById('bill-items-list').insertAdjacentHTML('beforeend', itemRowHTML('bill', billIdx++));
}
function addTxnItem() {
  document.getElementById('txn-items-list').insertAdjacentHTML('beforeend', itemRowHTML('txn', txnIdx++));
}
function removeItemRow(prefix, idx) {
  document.getElementById(`${prefix}-row-${idx}`)?.remove();
  calcTotal(prefix);
}

function calcTotal(prefix) {
  const container = document.getElementById(`${prefix}-items-list`);
  let total = 0;
  container.querySelectorAll('.bill-item-row').forEach(row => {
    const qty = parseFloat(row.querySelectorAll('input')[0].value) || 0;
    const rate = parseFloat(row.querySelectorAll('input')[1].value) || 0;
    total += qty * rate;
  });
  document.getElementById(`${prefix}-total-val`).textContent = total.toFixed(2);
}

function getItems(prefix) {
  const container = document.getElementById(`${prefix}-items-list`);
  const items = [];
  container.querySelectorAll('.bill-item-row').forEach(row => {
    const sel = row.querySelector('select');
    const name = sel.options[sel.selectedIndex]?.text?.replace(/\s*\(?.*\)$/, '').trim() || sel.value;
    const qty = parseFloat(row.querySelectorAll('input')[0].value) || 0;
    const rate = parseFloat(row.querySelectorAll('input')[1].value) || 0;
    if (qty > 0 && rate > 0 && sel.value) items.push({ name, qty, rate, amount: qty * rate });
  });
  return items;
}

// -- Transactions -------------------------------------------------
let txnFilter = 'all';
let txnFromDate = null, txnToDate = null;

function getFilteredTransactions() {
  const now = new Date();
  return transactions.filter(t => {
    const d = new Date(t.date);
    if (txnFilter === 'this_month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (txnFilter === 'last_month') {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    }
    if (txnFilter === 'custom' && txnFromDate && txnToDate) {
      const from = new Date(txnFromDate); from.setHours(0,0,0,0);
      const to   = new Date(txnToDate);   to.setHours(23,59,59,999);
      return d >= from && d <= to;
    }
    return true;
  });
}

function setTxnFilter(filter, btn) {
  txnFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('txn-date-range').classList.toggle('hidden', filter !== 'custom');
  if (filter !== 'custom') renderTransactions(1);
}

function applyCustomFilter() {
  txnFromDate = document.getElementById('txn-from-date').value;
  txnToDate   = document.getElementById('txn-to-date').value;
  if (!txnFromDate || !txnToDate) return toast('Select both From and To dates', 'error');
  renderTransactions(1);
}

const TXN_PAGE_SIZE = 15;
let txnCurrentPage = 1;

function renderTransactions(page) {
  if (page !== undefined) txnCurrentPage = page;
  const filtered = getFilteredTransactions();
  const tbody = document.getElementById('txns-body');

  // summary
  const total  = filtered.reduce((s, t) => s + t.total, 0);
  const paid   = filtered.filter(t => t.paidStatus !== 'unpaid').reduce((s, t) => s + t.total, 0);
  const unpaid = filtered.filter(t => t.paidStatus === 'unpaid').reduce((s, t) => s + t.total, 0);
  document.getElementById('txn-summary').innerHTML = filtered.length ? `
    <div class="txn-summary-item">&#128202; <strong>${filtered.length}</strong> Transactions</div>
    <div class="txn-summary-item">&#128176; Total: <strong>&#8377;${total.toFixed(2)}</strong></div>
    <div class="txn-summary-item">&#9989; Paid: <strong>&#8377;${paid.toFixed(2)}</strong></div>
    <div class="txn-summary-item">&#10060; Unpaid: <strong>&#8377;${unpaid.toFixed(2)}</strong></div>` : '';

  // paginate
  const sorted     = [...filtered].reverse();
  const totalPages = Math.max(1, Math.ceil(sorted.length / TXN_PAGE_SIZE));
  if (txnCurrentPage > totalPages) txnCurrentPage = totalPages;
  const pageData   = sorted.slice((txnCurrentPage - 1) * TXN_PAGE_SIZE, txnCurrentPage * TXN_PAGE_SIZE);

  tbody.innerHTML = pageData.map(t => `
    <tr>
      <td>${new Date(t.date).toLocaleDateString('en-IN')}</td>
      <td>${t.customerName || 'Walk-in'}</td>
      <td>${t.items.map(i => `${i.name} x${i.qty}`).join(', ')}</td>
      <td>&#8377;${t.total.toFixed(2)}</td>
      <td><span class="badge-${t.paidStatus === 'unpaid' ? 'unpaid' : 'paid'}">${t.paidStatus === 'unpaid' ? '&#10060; Unpaid' : '&#9989; Paid'}</span></td>
      <td><button class="btn-danger" onclick="deleteTxn('${t.id}')">&#128465;</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">No transactions found</td></tr>';

  // render pagination
  const pg = document.getElementById('txn-pagination');
  if (totalPages <= 1) { pg.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="renderTransactions(${txnCurrentPage - 1})" ${txnCurrentPage === 1 ? 'disabled' : ''}>&laquo; Prev</button>`;

  // show max 5 page buttons around current
  const range = 2;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= txnCurrentPage - range && i <= txnCurrentPage + range)) {
      html += `<button class="page-btn ${i === txnCurrentPage ? 'active' : ''}" onclick="renderTransactions(${i})">${i}</button>`;
    } else if (i === txnCurrentPage - range - 1 || i === txnCurrentPage + range + 1) {
      html += `<span class="page-info">...</span>`;
    }
  }

  html += `<button class="page-btn" onclick="renderTransactions(${txnCurrentPage + 1})" ${txnCurrentPage === totalPages ? 'disabled' : ''}>Next &raquo;</button>`;
  html += `<span class="page-info">Page ${txnCurrentPage} of ${totalPages} &nbsp;(${filtered.length} records)</span>`;
  pg.innerHTML = html;
}
function downloadTransactions() {
  const filtered = getFilteredTransactions();
  if (!filtered.length) return toast('No transactions to download', 'error');
  const label = txnFilter === 'this_month' ? 'This_Month'
    : txnFilter === 'last_month' ? 'Last_Month'
    : txnFilter === 'custom' ? `${txnFromDate}_to_${txnToDate}`
    : 'All';
  const rows = [
    ['Date','Customer','Items','Amount','Payment Mode','Status','Bill No'],
    ...filtered.map(t => [
      new Date(t.date).toLocaleDateString('en-IN'),
      t.customerName || 'Walk-in',
      t.items.map(i => `${i.name} x${i.qty}`).join(' | '),
      t.total.toFixed(2),
      t.payment || '',
      t.paidStatus === 'unpaid' ? 'Unpaid' : 'Paid',
      t.billNo || ''
    ])
  ];
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `Transactions_${label}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded ${filtered.length} transactions`);
}
function saveTransaction() {
  const items = getItems('txn');
  if (!items.length) return toast('Add at least one item', 'error');
  const custId = document.getElementById('txn-customer').value;
  const cust = customers.find(c => c.id === custId);
  const paidStatus = document.getElementById('txn-paid-status').value;
  const total = items.reduce((s, i) => s + i.amount, 0);

  const txn = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    customerId: custId,
    customerName: cust ? cust.name : 'Walk-in',
    items, total,
    payment: document.getElementById('txn-payment').value,
    paidStatus
  };
  transactions.push(txn);
  save('transactions', transactions);

  // if unpaid and customer selected ? add to kata book
  if (paidStatus === 'unpaid' && custId) {
    const kata = { id: 'K' + Date.now().toString(), customerId: custId, customerName: cust.name, date: txn.date, items, total, paidStatus: 'unpaid', txnId: txn.id };
    kataEntries.push(kata);
    save('kataEntries', kataEntries);
  }

  closeModal('txn-modal');
  renderTransactions();
  renderCustomers();
  renderDashboard();
  toast(paidStatus === 'unpaid' ? '\u26a0\ufe0f Transaction saved as Unpaid!' : 'Transaction saved!', paidStatus === 'unpaid' ? 'error' : 'success');
}

function deleteTxn(id) {
  showDialog('Delete this transaction?', () => {
    transactions = transactions.filter(t => t.id !== id);
    save('transactions', transactions);
    kataEntries = kataEntries.filter(k => k.txnId !== id);
    save('kataEntries', kataEntries);
    renderTransactions();
    renderCustomers();
    renderDashboard();
    toast('Transaction deleted');
  });
}

// -- Billing ------------------------------------------------------
let lastBill = null;

function generateBill() {
  const items = getItems('bill');
  if (!items.length) return toast('Add at least one item', 'error');
  const custId = document.getElementById('bill-customer').value;
  const cust = customers.find(c => c.id === custId);
  const total = items.reduce((s, i) => s + i.amount, 0);
  const payment = document.getElementById('bill-payment').value;
  const paidStatus = document.getElementById('bill-paid-status').value;
  const notes = document.getElementById('bill-notes').value;
  const billNo = 'BILL-' + Date.now().toString().slice(-6);
  const date = new Date().toLocaleDateString('en-IN');

  lastBill = { billNo, date, cust, items, total, payment, paidStatus, notes };

  const txn = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    customerId: custId,
    customerName: cust ? cust.name : 'Walk-in',
    items, total, payment, billNo, paidStatus
  };
  transactions.push(txn);
  save('transactions', transactions);

  // if unpaid and customer selected ? add to kata book
  if (paidStatus === 'unpaid' && custId) {
    const kata = { id: 'K' + Date.now().toString(), customerId: custId, customerName: cust.name, date: txn.date, items, total, paidStatus: 'unpaid', billNo, txnId: txn.id };
    kataEntries.push(kata);
    save('kataEntries', kataEntries);
  }

  renderBillPreview(lastBill);
  renderCustomers();
  renderTransactions();
  renderDashboard();
  toast(paidStatus === 'unpaid' ? '\u26a0\ufe0f Bill saved as Unpaid!' : 'Bill generated & saved! ?', paidStatus === 'unpaid' ? 'error' : 'success');
}

function renderBillPreview({ billNo, date, cust, items, total, payment, paidStatus, notes }) {
  const preview = document.getElementById('bill-preview');
  const logo = localStorage.getItem('shopLogo');
  const watermark = logo
    ? `<img src="${logo}" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:260px;height:260px;object-fit:contain;opacity:0.07;pointer-events:none;z-index:0;border-radius:16px" />`
    : '';
  preview.classList.remove('hidden');
  preview.style.position = 'relative';
  preview.style.overflow = 'hidden';
  preview.innerHTML = `
    ${watermark}
    <div style="position:relative;z-index:1">
    ${getShopHeader()}
    <hr style="border-color:#e2e8f0;margin:8px 0"/>
    <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:8px">
      <span><strong>Bill No:</strong> ${billNo}</span><span><strong>Date:</strong> ${date}</span>
    </div>
    ${cust ? `<div style="font-size:.85rem;margin-bottom:8px"><strong>Customer:</strong> ${cust.name} | ${cust.phone}</div>` : ''}
    <table>
      <thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>
        ${items.map((i, idx) => `<tr><td>${idx+1}</td><td>${i.name}</td><td>${i.qty}</td><td>&#8377;${i.rate}</td><td>&#8377;${i.amount.toFixed(2)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="bill-footer"><span>Payment: ${payment}</span><span class="badge-${paidStatus === 'unpaid' ? 'unpaid' : 'paid'}">${paidStatus === 'unpaid' ? '&#10060; Unpaid' : '&#9989; Paid'}</span><span>Total: &#8377;${total.toFixed(2)}</span></div>
    ${notes ? `<div style="font-size:.82rem;color:#64748b;margin-top:8px">Note: ${notes}</div>` : ''}
    <div style="text-align:center;margin-top:12px;font-size:.82rem;color:#64748b">${settings.footer}</div>
    </div>`;
}
function getBillPrintHTML() {
  const bill = lastBill;
  const preview = document.getElementById('bill-preview');
  return `<html><head><meta charset="utf-8"><title>${bill.billNo}</title><style>
    @page{size:A4;margin:16mm}
    body{font-family:sans-serif;padding:24px;max-width:640px;margin:auto;color:#1e293b}
    table{width:100%;border-collapse:collapse;margin:12px 0}
    th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:left}
    th{background:#f5f5f5}
    .bill-footer{display:flex;justify-content:space-between;font-weight:bold;margin-top:12px}
    .badge-paid{color:#166534}.badge-unpaid{color:#991b1b}
    img{max-width:100%}
  </style></head><body>${preview.innerHTML}</body></html>`;
}

async function saveBillAsPDF() {
  if (!lastBill) return toast('Generate a bill first', 'error');
  const html = getBillPrintHTML();
  if (IS_DESKTOP) {
    try {
      const result = await window.electronAPI.saveBillPDF(html, lastBill.billNo);
      if (!result.canceled) toast('Bill saved as PDF! ?', 'success');
    } catch (err) {
      toast(`Could not save PDF: ${err.message}`, 'error');
    }
    return;
  }
  // browser fallback — open print dialog
  const win = window.open('', '_blank');
  if (!win) return toast('Allow pop-ups to save the bill as PDF', 'error');
  win.document.write(html);
  win.document.close();
  win.print();
}

function printBill() {
  if (!lastBill) return toast('Generate a bill first', 'error');
  const win = window.open('', '_blank');
  if (!win) return toast('Allow pop-ups to print the bill', 'error');
  win.document.write(getBillPrintHTML());
  win.document.close();
  win.print();
}

// -- WhatsApp Messages --------------------------------------------
const WA_SERVER = 'http://127.0.0.1:3001';

function toggleCustomerSelect() {
  const val = document.getElementById('msg-recipients').value;
  document.getElementById('msg-customer-select').classList.toggle('hidden', val !== 'select');
}

function renderMsgCheckboxes() {
  const box = document.getElementById('msg-customer-checkboxes');
  box.innerHTML = customers.map(c => `
    <label>
      <input type="checkbox" value="${c.id}" /> ${c.name} (${c.phone})
    </label>`).join('') || '<span style="color:#94a3b8;font-size:.85rem">No customers added yet</span>';

  // show/hide the browser-mode notice and WA controls
  const notice = document.getElementById('wa-browser-notice');
  const controls = document.getElementById('wa-controls-wrap');
  if (notice)  notice.classList.toggle('hidden', IS_DESKTOP);
  if (controls) controls.classList.toggle('hidden', !IS_DESKTOP);

  if (IS_DESKTOP) checkWAStatus();
}

async function checkWAStatus() {
  if (!IS_DESKTOP) return;
  try {
    const res = await fetch(`${WA_SERVER}/status`);
    const data = await res.json();
    updateWABadge(data.connected, data.qrReady, data.connectionState);
  } catch {
    updateWABadge(false, false, 'offline');
  }
}

function openWhatsAppSync() {
  if (!IS_DESKTOP) {
    toast('WhatsApp connection is only available in the desktop app', 'error');
    return;
  }
  window.electronAPI.openQR();
}

function updateWABadge(connected, qrReady, connectionState) {
  const isDisconnected = connectionState === 'disconnected';

  // update all badges on page
  [['wa-status-badge', 'msg-btn-connect', 'msg-btn-reconnect', 'msg-btn-disconnect'],
   ['settings-wa-badge', 'settings-btn-connect', 'settings-btn-reconnect', 'settings-btn-disconnect']
  ].forEach(([badgeId, connectId, reconnectId, disconnectId]) => {
    const badge = document.getElementById(badgeId);
    const btnConnect    = document.getElementById(connectId);
    const btnReconnect  = document.getElementById(reconnectId);
    const btnDisconnect = document.getElementById(disconnectId);
    if (!badge) return;

    if (connected) {
      badge.textContent = '?? WhatsApp Connected';
      badge.className = 'wa-badge connected';
      if (btnConnect)    btnConnect.style.display    = 'none';
      if (btnReconnect)  btnReconnect.style.display  = 'inline-flex';
      if (btnDisconnect) btnDisconnect.style.display = 'inline-flex';
    } else if (isDisconnected) {
      badge.textContent = '? Disconnected';
      badge.className = 'wa-badge offline';
      if (btnConnect)    btnConnect.style.display    = 'inline-flex';
      if (btnReconnect)  btnReconnect.style.display  = 'none';
      if (btnDisconnect) btnDisconnect.style.display = 'none';
    } else if (qrReady) {
      badge.textContent = '?? Scan QR to Connect';
      badge.className = 'wa-badge qr';
      if (btnConnect)    btnConnect.style.display    = 'inline-flex';
      if (btnReconnect)  btnReconnect.style.display  = 'none';
      if (btnDisconnect) btnDisconnect.style.display = 'none';
    } else {
      badge.textContent = '?? Connecting...';
      badge.className = 'wa-badge offline';
      if (btnConnect)    btnConnect.style.display    = 'none';
      if (btnReconnect)  btnReconnect.style.display  = 'none';
      if (btnDisconnect) btnDisconnect.style.display = 'none';
    }
  });
}

async function waDisconnect() {
  if (!IS_DESKTOP) { toast('Only available in the desktop app', 'error'); return; }
  try {
    await window.electronAPI.disconnectWA();
    updateWABadge(false, false, 'disconnected');
    toast('WhatsApp disconnected ?');
  } catch (err) {
    toast('Disconnect failed: ' + err.message, 'error');
  }
}

async function waReconnect() {
  if (!IS_DESKTOP) { toast('Only available in the desktop app', 'error'); return; }
  try {
    updateWABadge(false, false, 'initializing');
    toast('Starting new WhatsApp session...', 'success');
    await window.electronAPI.reconnectWA();
    setTimeout(openWhatsAppSync, 1200);
  } catch (err) {
    toast('Reconnect failed: ' + err.message, 'error');
  }
}

if (IS_DESKTOP) {
  window.electronAPI.onWAStatus(({ connected, qrReady, connectionState }) => {
    updateWABadge(connected, qrReady, connectionState);
  });
  window.electronAPI.onUpdateResult(({ status, version }) => {
    const btn = document.getElementById('check-update-btn');
    const statusEl = document.getElementById('update-status');
    if (btn) { btn.disabled = false; btn.textContent = '?? Check for Update'; }
    if (!statusEl) return;
    if (status === 'available') {
      statusEl.style.color = '#2563eb';
      statusEl.innerHTML = `?? <strong>${version}</strong> is available. Preparing download...`;
    } else if (status === 'downloading') {
      statusEl.style.color = '#d97706';
      statusEl.innerHTML = `? Downloading update... Please wait.`;
      if (btn) btn.disabled = true;
    } else if (status === 'done') {
      statusEl.style.color = '#16a34a';
      statusEl.innerHTML = `? Download complete! The installer has opened — follow the steps to update.`;
      if (btn) btn.disabled = false;
    } else if (status === 'up-to-date') {
      statusEl.style.color = '#16a34a';
      statusEl.innerHTML = `? You're already on the latest version.`;
    } else if (status === 'cancelled') {
      statusEl.style.color = '#64748b';
      statusEl.innerHTML = `Update skipped.`;
    } else {
      statusEl.style.color = '#dc2626';
      statusEl.innerHTML = `? Could not check for updates. Check your internet connection.`;
    }
  });
}

async function sendWhatsApp() {
  if (!IS_DESKTOP) {
    toast('WhatsApp messaging only works in the desktop app', 'error');
    return;
  }
  const msg = document.getElementById('msg-text').value.trim();
  if (!msg) return toast('Please type a message', 'error');

  const mode = document.getElementById('msg-recipients').value;
  let targets = [];
  if (mode === 'all') {
    targets = customers;
  } else {
    const checked = document.querySelectorAll('#msg-customer-checkboxes input:checked');
    if (!checked.length) return toast('Select at least one customer', 'error');
    checked.forEach(cb => { const c = customers.find(x => x.id === cb.value); if (c) targets.push(c); });
  }
  if (!targets.length) return toast('No customers to send to', 'error');

  const btn = document.getElementById('send-whatsapp-btn');
  btn.disabled = true;
  btn.textContent = '? Sending...';

  const log = document.getElementById('msg-log');
  log.innerHTML = `<h3 style="margin-bottom:10px">?? Sending to ${targets.length} customer(s)...</h3>`;

  try {
    const attachmentFile = document.getElementById('msg-attachment').files[0];
    let endpoint, body;

    if (attachmentFile) {
      // send with attachment via FormData
      const formData = new FormData();
      formData.append('message', msg);
      formData.append('contacts', JSON.stringify(targets));
      formData.append('attachment', attachmentFile);
      const res = await fetch(`${WA_SERVER}/send-bulk-media`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showSendResults(log, data.results, targets.length);
    } else {
      // text only
      const res = await fetch(`${WA_SERVER}/send-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: targets, message: msg })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showSendResults(log, data.results, targets.length);
    }
  } catch (err) {
    log.innerHTML = `<div class="msg-log-item failed">? Error: ${err.message}</div>`;
    toast('Failed to send. Is the server running?', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '?? Send via WhatsApp';
  }
}

function showSendResults(log, results, total) {
  log.innerHTML = `<h3 style="margin-bottom:10px">?? Results</h3>`;
  results.forEach(r => {
    const ok = r.status === 'sent';
    log.insertAdjacentHTML('beforeend', `
      <div class="msg-log-item ${ok ? '' : 'failed'}">
        ${ok ? '?' : '?'} <strong>${r.name}</strong> (${r.phone}) — ${ok ? 'Message sent!' : 'Failed: ' + r.error}
      </div>`);
  });
  const sentCount = results.filter(r => r.status === 'sent').length;
  toast(`? Sent to ${sentCount}/${total} customers!`);
}

function checkForAppUpdate() {
  if (!IS_DESKTOP) {
    const statusEl = document.getElementById('update-status');
    if (statusEl) {
      statusEl.style.color = '#92400e';
      statusEl.innerHTML = '?? App updates are only available in the desktop app. Download the latest installer from GitHub.';
    }
    return;
  }
  const btn = document.getElementById('check-update-btn');
  const statusEl = document.getElementById('update-status');
  if (btn) { btn.disabled = true; btn.textContent = '? Checking...'; }
  if (statusEl) { statusEl.innerHTML = ''; statusEl.style.color = ''; }
  window.electronAPI.checkUpdate();
  setTimeout(() => {
    if (btn && btn.disabled) { btn.disabled = false; btn.textContent = '?? Check for Update'; }
  }, 12000);
}

// -- Init ---------------------------------------------------------
// -- Settings --------------------------------------------
function loadSettingsForm() {
  document.getElementById('s-name-tamil').value  = settings.nameTamil;
  document.getElementById('s-name-english').value = settings.nameEnglish;
  document.getElementById('s-phone').value        = settings.phone;
  document.getElementById('s-addr1').value        = settings.addr1;
  document.getElementById('s-addr2').value        = settings.addr2;
  document.getElementById('s-city').value         = settings.city;
  document.getElementById('s-state').value        = settings.state;
  document.getElementById('s-upi').value          = settings.upi;
  document.getElementById('s-gst').value          = settings.gst;
  document.getElementById('s-footer').value       = settings.footer;
  document.getElementById('s-reminder').value     = settings.reminderTemplate || '';
  const savedLogo = localStorage.getItem('shopLogo');
  if (savedLogo) applyLogo(savedLogo);

  // show correct WA section based on environment
  const notice   = document.getElementById('settings-wa-browser-notice');
  const controls = document.getElementById('settings-wa-controls-wrap');
  if (notice)   notice.classList.toggle('hidden', IS_DESKTOP);
  if (controls) controls.classList.toggle('hidden', !IS_DESKTOP);
  if (IS_DESKTOP) checkWAStatus();

  renderSettingsPreview();
}

function saveSettings() {
  settings = {
    nameTamil:   document.getElementById('s-name-tamil').value.trim(),
    nameEnglish: document.getElementById('s-name-english').value.trim(),
    phone:       document.getElementById('s-phone').value.trim(),
    addr1:       document.getElementById('s-addr1').value.trim(),
    addr2:       document.getElementById('s-addr2').value.trim(),
    city:        document.getElementById('s-city').value.trim(),
    state:       document.getElementById('s-state').value.trim(),
    upi:         document.getElementById('s-upi').value.trim(),
    gst:         document.getElementById('s-gst').value.trim(),
    footer:      document.getElementById('s-footer').value.trim(),
    reminderTemplate: document.getElementById('s-reminder').value
  };
  localStorage.setItem('settings', JSON.stringify(settings));

  // update sidebar logo live
  document.querySelector('.shop-name-tamil').textContent = settings.nameTamil || '??? Shop';
  document.querySelector('.shop-name-sub').textContent   = settings.nameEnglish;

  renderSettingsPreview();
  const msg = document.getElementById('settings-saved');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 3000);
}

function renderSettingsPreview() {
  const s = settings;
  const addr = [s.addr1, s.addr2, s.city, s.state].filter(Boolean).join(', ');
  const logo = localStorage.getItem('shopLogo');
  const logoHtml = logo ? `<img src="${logo}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;margin-bottom:6px" /><br/>` : '';
  document.getElementById('settings-bill-preview').innerHTML = `
    ${logoHtml}
    <div class="preview-shop-tamil">${s.nameTamil}</div>
    <div class="preview-shop-en">${s.nameEnglish}</div>
    <div>${addr}</div>
    <div>Ph: ${s.phone || 'Not set'}</div>
    ${s.upi  ? `<div>UPI: ${s.upi}</div>` : ''}
    ${s.gst  ? `<div>GSTIN: ${s.gst}</div>` : ''}
    <hr style="border-color:#e2e8f0;margin:8px 0"/>
    <div style="color:#64748b;font-size:.8rem">${s.footer}</div>`;
}

function getShopHeader() {
  const s = settings;
  const addr = [s.addr1, s.addr2, s.city, s.state].filter(Boolean).join(', ');
  const logo = localStorage.getItem('shopLogo');
  const logoHtml = logo ? `<img src="${logo}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;margin-bottom:6px" />` : '';
  return `
    <div style="text-align:center">
      ${logoHtml}
      <h3 style="font-family:'Catamaran',sans-serif;font-weight:900;font-size:1.5rem">${s.nameTamil}</h3>
    </div>
    <div class="shop-info">
      <strong>${s.nameEnglish}</strong><br/>
      ${addr}<br/>
      Phone: ${s.phone || 'N/A'}
      ${s.upi ? `<br/>UPI: ${s.upi}` : ''}
      ${s.gst ? `<br/>GSTIN: ${s.gst}` : ''}
    </div>`;
}

function previewLogo(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result;
    localStorage.setItem('shopLogo', base64);
    applyLogo(base64);
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  localStorage.removeItem('shopLogo');
  applyLogo(null);
  document.getElementById('s-logo-input').value = '';
}

function applyLogo(base64) {
  const preview = document.getElementById('s-logo-preview');
  const sidebarWrap = document.getElementById('sidebar-logo-wrap');
  if (base64) {
    preview.src = base64;
    preview.classList.add('has-logo');
    sidebarWrap.innerHTML = `<img src="${base64}" alt="Logo" />`;
  } else {
    preview.src = '';
    preview.classList.remove('has-logo');
    sidebarWrap.innerHTML = '';
  }
}

function applySettingsToUI() {
  document.querySelector('.shop-name-tamil').textContent = settings.nameTamil || '??? Shop';
  document.querySelector('.shop-name-sub').textContent   = settings.nameEnglish;
  const savedLogo = localStorage.getItem('shopLogo');
  applyLogo(savedLogo || null);
}

addBillItem();
setBillPaidStatus('paid');
renderProducts();
renderCustomers();
renderTransactions();
renderDashboard();
applySettingsToUI();
