import { uiText } from '../../i18n/language.ts';
import { useState } from 'react';
import { Check, Search, WalletCards, X } from 'lucide-react';
import { api, type CollectionLinkCandidate, type UnlinkedCollectionReceipt } from '../../api.ts';
import { collectionError, collectionMoney } from '../../sections/collections/useCollectionsDashboard.ts';

type Props = {
  receipts: UnlinkedCollectionReceipt[];
  busy: string;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  load: () => Promise<void>;
};

const sectionLabels: Record<CollectionLinkCandidate['sectionKey'], string> = {
  customer_debts: uiText("ديون العملاء"),
  company_debts: uiText("ديون الشركات"),
  libyan_deposits: uiText("أمانات ليبية"),
  egyptian_deposits: uiText("أمانات مصرية"),
};

export function UnlinkedReceiptsPanel({ receipts, busy, setBusy, setError, load }: Props) {
  const [linkingReceipt, setLinkingReceipt] = useState<UnlinkedCollectionReceipt | null>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<CollectionLinkCandidate[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [entryType, setEntryType] = useState<'payment' | 'debt'>('payment');
  const [linkMode, setLinkMode] = useState<'existing' | 'new'>('existing');
  const [newAccountKind, setNewAccountKind] = useState<'customer' | 'company'>('customer');

  if (receipts.length === 0) return null;

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await operation();
      await load();
      return true;
    } catch (caught) {
      setError(collectionError(caught));
      return false;
    } finally {
      setBusy('');
    }
  };

  const openLink = (receipt: UnlinkedCollectionReceipt, mode: 'existing' | 'new') => {
    setLinkingReceipt(receipt);
    setLinkMode(mode);
    setQuery(receipt.customerName);
    setCandidates([]);
    setSelectedCustomerId('');
    setEntryType('payment');
  };

  const search = async () => {
    if (query.trim().length < 2) {
      setError(uiText("اكتب حرفين على الأقل من اسم العميل."));
      return;
    }
    setBusy('candidate-search');
    setError('');
    try {
      const result = await api.collectionLinkCandidates(query.trim());
      setCandidates(result.items.filter(candidate=>candidate.currency==='LYD'&&candidate.sectionKey!=='egyptian_deposits'));
    } catch (caught) {
      setError(collectionError(caught));
    } finally {
      setBusy('');
    }
  };

  const approve = async () => {
    if (!linkingReceipt || (linkMode === 'existing' && !selectedCustomerId)) {
      setError(uiText("اختر الكارت الأصلي أولًا أو أنشئ حسابًا جديدًا."));
      return;
    }
    if(linkingReceipt.currency!=='LYD'||(linkMode==='existing'&&!candidates.some(candidate=>candidate.id===selectedCustomerId&&candidate.currency==='LYD'&&candidate.sectionKey!=='egyptian_deposits'))){
      setError(uiText('لا يمكن ربط الاستلام إلا بحساب بالدينار الليبي، دون تحويل.'));
      return;
    }
    const completed = await run(`unlinked-${linkingReceipt.id}`, () =>
      api.decideUnlinkedCollectionReceipt(
        linkingReceipt.id,
        'approve',
        linkMode === 'existing' ? selectedCustomerId : undefined,
        entryType,
        '',
        linkMode === 'new' ? newAccountKind : undefined,
      ),
    );
    if (completed) setLinkingReceipt(null);
  };

  return (
    <>
      <section className="collection-panel admin-collection-panel">
        <h2>{uiText("استلامات بلا كارت موجه")}</h2>
        <p className="muted">{uiText("لا تؤثر على أي حساب حتى تربطها الإدارة بكارت أصلي وتعتمدها.")}</p>
        <p className="muted">{uiText('عملة الاستلام: دينار ليبي فقط — الربط بحسابات الدينار دون تحويل.')}</p>
        <div className="admin-collection-grid">
          {receipts.map((receipt) => (
            <article
              className={`admin-customer-collection-card unlinked-admin-card status-${receipt.status}`}
              key={receipt.id}
            >
              <header>
                <div>
                  <strong>{receipt.customerName}</strong>
                  <span>{receipt.collectorName}</span>
                </div>
                <b>{collectionMoney.format(receipt.amountUnits)} {uiText(" د.ل")}</b>
              </header>
              <div className="admin-card-history">
                {Boolean(receipt.currencyMismatch)&&<p className="alert error">{uiText('استلام قديم مرتبط بعملة مختلفة؛ يلزم مراجعة الإدارة، ولم يتم تعديل الرصيد تلقائيًا.')}</p>}
                <article>
                  <div>
                    <strong>
                      {receipt.status === 'pending'
                        ? uiText("غير مربوط")
                        : receipt.status === 'approved'
                          ? uiText("تم الربط والاعتماد")
                          : uiText("مرفوض")}
                    </strong>
                    <span>{receipt.businessDate}</span>
                  </div>
                  {receipt.status === 'pending' ? (
                    <div className="admin-inline-actions">
                      <button className="approve" disabled={busy !== ''} onClick={() => openLink(receipt, 'existing')}>
                        <Search size={14} />
                        {uiText("عميل قديم")}</button>
                      <button className="approve create-account" disabled={busy !== ''} onClick={() => openLink(receipt, 'new')}>
                        <WalletCards size={14} />
                        {uiText("عميل جديد")}</button>
                      <button
                        className="reject"
                        disabled={busy !== ''}
                        onClick={() =>
                          void run(`unlinked-${receipt.id}`, () =>
                            api.decideUnlinkedCollectionReceipt(receipt.id, 'reject'),
                          )
                        }
                      >
                        <X size={14} />
                        {uiText("رفض")}</button>
                    </div>
                  ) : receipt.status === 'approved' && !receipt.cashReceivedAt ? (
                    <button
                      className="cash-button"
                      disabled={busy !== ''}
                      onClick={() =>
                        void run(`unlinked-${receipt.id}`, () =>
                          api.receiveUnlinkedCollectionCash(receipt.id),
                        )
                      }
                    >
                      <WalletCards size={14} />
                      {uiText("تم استلام النقدية")}</button>
                  ) : receipt.cashReceivedAt ? (
                    <em>{uiText("تم استلام النقدية")}</em>
                  ) : (
                    <em>{uiText("تم الرفض دون تأثير مالي")}</em>
                  )}
                </article>
              </div>
            </article>
          ))}
        </div>
      </section>
      {linkingReceipt && (
        <div className="collection-confirm-shade">
          <section className="collection-link-dialog" role="dialog" aria-modal="true">
            <header>
              <div>
                <h3>{uiText("ربط استلام بكارت أصلي")}</h3>
                <p>{uiText('عملة الاستلام: دينار ليبي فقط — الربط بحسابات الدينار دون تحويل.')}</p>
                <p>
                  {linkingReceipt.customerName} — {collectionMoney.format(linkingReceipt.amountUnits)} {uiText(" د.ل")}</p>
              </div>
              <button className="icon-button" aria-label={uiText("إغلاق")} onClick={() => setLinkingReceipt(null)}>
                <X size={17} />
              </button>
            </header>
            <div className="collection-link-mode" role="group" aria-label={uiText("طريقة ربط الاستلام")}>
              <button className={linkMode === 'existing' ? 'selected' : ''} onClick={() => setLinkMode('existing')}>
                {uiText("عميل قديم — ربط بحساب موجود")}</button>
              <button className={linkMode === 'new' ? 'selected' : ''} onClick={() => setLinkMode('new')}>
                {uiText("عميل جديد — إنشاء حساب جديد")}</button>
            </div>
            {linkMode === 'existing' ? <>
            <div className="collection-candidate-search">
              <label>
                {uiText('ابحث عن العميل في حسابات الدينار الليبي')}<input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void search();
                    }
                  }}
                />
              </label>
              <button disabled={busy === 'candidate-search'} onClick={() => void search()}>
                <Search size={15} />
                {uiText("بحث")}</button>
            </div>
            <div className="collection-link-candidates">
              {candidates.length === 0 ? (
                <p className="muted">
                  {uiText("ابحث ثم اختر الكارت الأصلي. إذا لم يوجد، أنشئه في قسمه أولًا ثم أعد البحث.")}</p>
              ) : (
                candidates.map((candidate) => (
                  <label className={selectedCustomerId === candidate.id ? 'selected' : ''} key={candidate.id}>
                    <input
                      type="radio"
                      name="linkedCustomer"
                      checked={selectedCustomerId === candidate.id}
                      onChange={() => setSelectedCustomerId(candidate.id)}
                    />
                    <span>
                      <strong>{candidate.name}</strong>
                      <small>{sectionLabels[candidate.sectionKey]}</small>
                    </span>
                    <b>{collectionMoney.format(candidate.balanceUnits)}</b>
                  </label>
                ))
              )}
            </div>
            </> : (
              <div className="collection-new-account-choice">
                <strong>{uiText("مكان إنشاء الكارت الجديد")}</strong>
                <label className={newAccountKind === 'customer' ? 'selected' : ''}>
                  <input type="radio" name="newAccountKind" checked={newAccountKind === 'customer'} onChange={() => setNewAccountKind('customer')} />
                  {uiText("قسم ديون العملاء")}</label>
                <label className={newAccountKind === 'company' ? 'selected' : ''}>
                  <input type="radio" name="newAccountKind" checked={newAccountKind === 'company'} onChange={() => setNewAccountKind('company')} />
                  {uiText("قسم ديون الشركات")}</label>
                <p className="muted">{uiText("سينشأ الكارت باسم «")}{linkingReceipt.customerName}{uiText("» ثم تُسجل عليه الحركة بعد اعتمادك فقط.")}</p>
              </div>
            )}
            <label>
              {uiText("نوع الحركة عند الاعتماد")}<select
                value={entryType}
                onChange={(event) => setEntryType(event.target.value as 'payment' | 'debt')}
              >
                <option value="payment">{uiText("خصم القيمة من رصيد الكارت (تسديد / خروج)")}</option>
                <option value="debt">{uiText("إضافة القيمة إلى رصيد الكارت (دين / دخول)")}</option>
              </select>
            </label>
            <p className="muted">{uiText("لن يحدث أي تأثير مالي إلا بعد الضغط على «ربط واعتماد».")}</p>
            <div className="dialog-actions">
              <button onClick={() => setLinkingReceipt(null)}>{uiText("إلغاء")}</button>
              <button
                className="primary"
                disabled={(linkMode === 'existing' && !selectedCustomerId) || busy !== ''}
                onClick={() => void approve()}
              >
                <Check size={15} />
                {linkMode === 'new' ? uiText("إنشاء الكارت وربطه واعتماده") : uiText("ربط واعتماد")}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
