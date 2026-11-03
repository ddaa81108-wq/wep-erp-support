import { useState, type FormEvent } from 'react';
import { request } from '../../apiTransport.ts';
import type { Customer } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';
import { uiText, displayLocale } from '../../i18n/language.ts';
import { useUnsavedForm } from '../../dashboard/useUnsavedForm.ts';
import { currencyLabel } from './debtSectionUtils.ts';
import type { DebtSection } from './sectionConfig.ts';
import '../../styles/account-deletion.css';

export function DeleteAccountDialog({
  section,
  customer: currentCustomer,
  onClose,
  onDeleted,
}: {
  section: DebtSection;
  customer: Pick<Customer, 'id' | 'name' | 'version' | 'balanceUnits'>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  // Freeze the reviewed name, version and amount; a remote change requires a fresh confirmation.
  const [customer] = useState(currentCustomer);
  const [name, setName] = useState(''),
    [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const { bindForm, trackChanges, markSaved, confirmLeave } = useUnsavedForm(busy);
  const close = () => {
    if (confirmLeave()) onClose();
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/${section}/${encodeURIComponent(customer.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({
          requestId,
          expectedVersion: customer.version,
          confirmedName: name.trim(),
          confirmedBalanceUnits: customer.balanceUnits,
          reason: reason.trim(),
          confirmed,
        }),
      });
      markSaved();
      onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : uiText('تعذر حذف الكارت.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={uiText('حذف الكارت')} onClose={close} className="delete-account-dialog">
      <form ref={bindForm} className="stack" onInput={trackChanges} onChange={trackChanges} onSubmit={submit}>
        <strong>{customer.name}</strong>
        <p>
          {uiText('الرصيد الحالي: {0} {1}', [
            new Intl.NumberFormat(displayLocale).format(customer.balanceUnits),
            currencyLabel(section),
          ])}
        </p>
        <p className="alert error">
          {uiText(
            'سيختفي الكارت من القسم والبحث، ويُستبعد رصيده من الإجماليات الحالية. يبقى سجل معاملاته محفوظًا للمراجعة. إنشاء حساب جديد لا ينقل إليه الرصيد تلقائيًا.',
          )}
        </p>
        <label>
          {uiText('اكتب اسم الكارت لتأكيد الحذف')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <label>
          {uiText('سبب الحذف')}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={5}
            maxLength={500}
            required
            disabled={busy}
          />
        </label>
        <label className="account-delete-consent">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
          />
          {uiText('راجعت الرصيد وأوافق على حذف الكارت وأثره على الإجماليات.')}
        </label>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={close} disabled={busy}>
            {uiText('إلغاء')}
          </button>
          <button
            className="primary delete-account-confirm"
            disabled={busy || name.trim() !== customer.name || reason.trim().length < 5 || !confirmed}
          >
            {busy ? uiText('جارٍ الحذف…') : uiText('تأكيد حذف الكارت')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
