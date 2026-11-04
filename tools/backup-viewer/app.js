/* Standalone viewer: only local GET requests, plus explicit close. */
const element = id => document.getElementById(id);
let page = 1;
let total = 0;
let requestNumber = 0;
let table = '';
const labels = { customers: 'الحسابات والعملاء', debt_transactions: 'قيود الديون', purchase_entries: 'معاملات المشتريات', purchase_days: 'أيام المشتريات', treasury_cash_entries: 'حركات نقد الخزينة', collection_submissions: 'التحصيلات', audit_log: 'سجل التدقيق', report_five_am_closings: 'لقطات الخامسة', users: 'المستخدمون' };
async function api(path, options) {
  const response = await fetch('./api/' + path, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'تعذر قراءة النسخة.');
  return data;
}
function status(message, error = false) { element('status').textContent = message; element('status').className = error ? 'error' : ''; }
async function load() {
  const request = ++requestNumber;
  status('جارٍ القراءة…');
  element('previous').disabled = true; element('next').disabled = true;
  try {
    const data = await api('rows?' + new URLSearchParams({ table, page: String(page), search: element('search').value }));
    if (request !== requestNumber) return;
    total = data.total;
    const head = document.createElement('tr');
    for (const column of data.columns) { const th = document.createElement('th'); th.textContent = column; head.append(th); }
    const body = document.createDocumentFragment();
    for (const row of data.rows) {
      const tr = document.createElement('tr');
      for (const column of data.columns) {
        const td = document.createElement('td'); const value = row[column] === null ? 'NULL' : String(row[column]);
        td.textContent = value.length > 350 ? value.slice(0, 350) + '…' : value;
        td.addEventListener('click', () => { element('cell-details').open = true; element('cell-value').textContent = value; element('cell-details').scrollIntoView({ block: 'nearest' }); });
        tr.append(td);
      }
      body.append(tr);
    }
    element('data').tHead.replaceChildren(head); element('data').tBodies[0].replaceChildren(body);
    status(total ? `${table} · ${total} سجل مطابق · ${data.rows.length} معروض` : 'لا توجد سجلات مطابقة.');
    element('page').textContent = `صفحة ${page} من ${Math.max(1, Math.ceil(total / 50))}`;
    element('previous').disabled = page <= 1; element('next').disabled = page * 50 >= total;
  } catch (error) { if (request === requestNumber) { element('data').tHead.replaceChildren(); element('data').tBodies[0].replaceChildren(); status(error.message, true); } }
}
element('tables').addEventListener('change', () => { table = element('tables').value; page = 1; element('search').value = ''; element('cell-value').textContent = ''; void load(); });
element('search-form').addEventListener('submit', event => { event.preventDefault(); page = 1; void load(); });
element('previous').addEventListener('click', () => { page--; void load(); });
element('next').addEventListener('click', () => { page++; void load(); });
element('close').addEventListener('click', async () => {
  try { await api('close', { method: 'POST' }); document.body.replaceChildren(); const p = document.createElement('p'); p.textContent = 'أُغلقت المعاينة وحُذفت نسختها المؤقتة. الملف الأصلي لم يتغير.'; document.body.append(p); }
  catch { status('تعذر تأكيد الإغلاق؛ أغلق نافذة PowerShell بـ Ctrl+C.', true); }
});
void api('tables').then(data => {
  for (const text of [data.metadata.file, data.metadata.encrypted ? 'نسخة مشفّرة' : 'نسخة غير مشفّرة', 'فحص القاعدة: سليم', 'ملف التحقق: ' + data.metadata.manifest]) { const span = document.createElement('span'); span.textContent = text; element('metadata').append(span); }
  for (const item of data.tables) { const option = document.createElement('option'); option.value = item.name; option.textContent = `${labels[item.name] || item.name} (${item.count}) — ${item.name}`; element('tables').append(option); }
  table = data.tables.some(item => item.name === 'customers') ? 'customers' : data.tables[0]?.name;
  if (!table) { status('لا توجد جداول متاحة للعرض.'); return; }
  element('tables').value = table;
  void load();
}).catch(error => status(error.message, true));
