import { uiText } from '../../i18n/language.ts';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, type AccountSuggestion, type Customer, type Ledger } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';
import { debtSectionText, type DebtSection } from './sectionConfig.ts';
import { currencyLabel } from './debtSectionUtils.ts';
import { createSectionAccount, listSectionSuggestions, updateSectionAccount } from './debtSectionApi.ts';

const errorText = (error: unknown) => error instanceof ApiError
  ? error.message
  : uiText("حدث خطأ غير متوقع. لم تُعتمد العملية.");

export function CustomerForm({ section, initial, onClose, onCreated, onExisting }: {
  section: DebtSection;
  initial?: { name: string; phone: string; openingBalance: number } | null;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
  onExisting: (customerId: string) => void;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState(initial?.name ?? '');
  const [suggestions, setSuggestions] = useState<AccountSuggestion[]>([]);
  const [confirmedDistinct, setConfirmedDistinct] = useState(false);
  useEffect(() => {
    setConfirmedDistinct(false);
    if (name.trim().length < 2) { setSuggestions([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      void listSectionSuggestions(section, name).then((result) => {
        if (active) setSuggestions(result.items);
      }).catch(() => { if (active) setSuggestions([]); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [name, section]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      const body = {
        requestId: crypto.randomUUID(), name: String(form.get('name') ?? ''), phone: String(form.get('phone') ?? ''),
        openingBalance: Number(form.get('openingBalance') ?? 0),
      };
      const result = await createSectionAccount(section, body);
      onCreated(result.customer);
    } catch (caught) {
      if (caught instanceof ApiError && caught.details?.customerId) {
        setExisting({ id: String(caught.details.customerId), name: String(caught.details.customerName ?? debtSectionText[section].singular) });
      }
      setError(errorText(caught));
    } finally { setBusy(false); }
  }
  return <Modal title={uiText("حساب {0} جديد", [debtSectionText[section].singular])} onClose={onClose}><form className="stack" onSubmit={submit}>
    <label>{uiText("اسم ")}{debtSectionText[section].singular}<input name="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={160} autoFocus placeholder={section === 'companies' ? uiText("اسم الشركة") : uiText("الاسم الكامل أو اسم المحل")} /></label>
    {suggestions.length > 0 && <section className="duplicate-suggestions" aria-label={uiText("أسماء مشابهة")}>
      <strong>{uiText("راجع الحسابات المشابهة قبل الإنشاء")}</strong>
      {suggestions.map((item) => <button key={item.id} type="button" onClick={() => onExisting(item.id)}>
        <span>{item.name}</span><small>{item.phone ?? uiText("بدون هاتف")} {uiText(" · رصيد ")}{Math.abs(item.balanceUnits)}</small>
      </button>)}
      {!confirmedDistinct && <button type="button" className="confirm-distinct" onClick={() => setConfirmedDistinct(true)}>{uiText("ليس الحساب المطلوب — إنشاء حساب جديد")}</button>}
    </section>}
    <label>{uiText("رقم الهاتف")}<input name="phone" defaultValue={initial?.phone ?? ''} inputMode="tel" dir="ltr" /></label>
    <label>{uiText("المبلغ (")}{currencyLabel(section)})<input name="openingBalance" type="number" step="1" defaultValue={initial?.openingBalance ?? 0} dir="ltr" /></label>
    {error && <div className="alert error">{error}</div>}
    {existing && <button type="button" className="secondary wide" onClick={() => onExisting(existing.id)}>{uiText("فتح السجل الدائم لـ")}{existing.name}</button>}
    <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>{uiText("إلغاء")}</button><button className="primary" disabled={busy || (suggestions.length > 0 && !confirmedDistinct)}>{busy ? uiText("جارٍ الحفظ…") : uiText("حفظ الحساب")}</button></div>
  </form></Modal>;
}

export function CustomerDetailsForm({ section, ledger, onClose, onSaved }: {
  section: DebtSection;
  ledger: Ledger;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const body = {
        expectedVersion: ledger.customer.version,
        name: String(form.get('name') ?? ''), phone: String(form.get('phone') ?? ''),
      };
      await updateSectionAccount(section, ledger.customer.id, body);
      await onSaved();
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  return <Modal title={uiText("تعديل بيانات {0}", [debtSectionText[section].singular])} onClose={onClose}><form className="stack" onSubmit={submit}>
    <label>{uiText("اسم ")}{debtSectionText[section].singular}<input name="name" defaultValue={ledger.customer.name} required minLength={2} maxLength={160} autoFocus /></label>
    <label>{uiText("رقم الهاتف")}<input name="phone" defaultValue={ledger.customer.phone ?? ''} inputMode="tel" dir="ltr" /></label>
    {error && <div className="alert error">{error}</div>}
    <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>{uiText("إلغاء")}</button><button className="primary" disabled={busy}>{busy ? uiText("جارٍ الحفظ…") : uiText("حفظ البيانات")}</button></div>
  </form></Modal>;
}
