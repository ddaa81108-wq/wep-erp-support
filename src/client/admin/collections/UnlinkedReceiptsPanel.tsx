import { CollectionRejectedBadge } from '../../sections/collections/CollectionRejectedBadge.tsx';
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
  customer_debts: 'ديون العملاء',
  company_debts: 'ديون الشركات',
  libyan_deposits: 'أمانات ليبية',
  egyptian_deposits: 'أمانات مصرية',
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
      setError('اكتب حرفين على الأقل من اسم العميل.');
      return;
    }
    setBusy('candidate-search');
    setError('');
    try {
      const result = await api.collectionLinkCandidates(query.trim());
      setCandidates(result.items);
    } catch (caught) {
      setError(collectionError(caught));
    } finally {
      setBusy('');
    }
  };

  const approve = async () => {
    if (!linkingReceipt || (linkMode === 'existing' && !selectedCustomerId)) {
      setError('اختر الكارت الأصلي أولًا أو أنشئ حسابًا جديدًا.');
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
        <h2>استلامات بلا كارت موجه</h2>
        <p className="muted">لا تؤثر على أي حساب حتى تربطها الإدارة بكارت أصلي وتعتمدها.</p>
        <div className="admin-collection-grid">
          {receipts.map((receipt) => (
            <article
              className={`admin-customer-collection-card unlinked-admin-card status-${receipt.status}`}
              key={receipt.id}
            >
              {receipt.status === 'rejected' && <CollectionRejectedBadge />}
              <header>
                <div>
                  <strong>{receipt.customerName}</strong>
                  <span>{receipt.collectorName}</span>
                </div>
                <b>{collectionMoney.format(receipt.amountUnits)} د.ل</b>
              </header>
              <div className="admin-card-history">
                <article>
                  <div>
                    <strong>
                      {receipt.status === 'pending'
                        ? 'غير مربوط'
                        : receipt.status === 'approved'
                          ? 'تم الربط والاعتماد'
                          : 'مرفوض'}
                    </strong>
                    <span>{receipt.businessDate}</span>
                  </div>
                  {receipt.status === 'pending' ? (
                    <div className="admin-inline-actions">
                      <button className="approve" disabled={busy !== ''} onClick={() => openLink(receipt, 'existing')}>
                        <Search size={14} />
                        عميل قديم
                      </button>
                      <button className="approve create-account" disabled={busy !== ''} onClick={() => openLink(receipt, 'new')}>
                        <WalletCards size={14} />
                        عميل جديد
                      </button>
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
                        رفض
                      </button>
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
                      تم استلام النقدية
                    </button>
                  ) : receipt.cashReceivedAt ? (
                    <em>تم استلام النقدية</em>
                  ) : (
                    <em>تم الرفض دون تأثير مالي</em>
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
                <h3>ربط استلام بكارت أصلي</h3>
                <p>
                  {linkingReceipt.customerName} — {collectionMoney.format(linkingReceipt.amountUnits)} د.ل
                </p>
              </div>
              <button className="icon-button" aria-label="إغلاق" onClick={() => setLinkingReceipt(null)}>
                <X size={17} />
              </button>
            </header>
            <div className="collection-link-mode" role="group" aria-label="طريقة ربط الاستلام">
              <button className={linkMode === 'existing' ? 'selected' : ''} onClick={() => setLinkMode('existing')}>
                عميل قديم — ربط بحساب موجود
              </button>
              <button className={linkMode === 'new' ? 'selected' : ''} onClick={() => setLinkMode('new')}>
                عميل جديد — إنشاء حساب جديد
              </button>
            </div>
            {linkMode === 'existing' ? <>
            <div className="collection-candidate-search">
              <label>
                ابحث عن العميل في كل الأقسام
                <input
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
                بحث
              </button>
            </div>
            <div className="collection-link-candidates">
              {candidates.length === 0 ? (
                <p className="muted">
                  ابحث ثم اختر الكارت الأصلي. إذا لم يوجد، أنشئه في قسمه أولًا ثم أعد البحث.
                </p>
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
                <strong>مكان إنشاء الكارت الجديد</strong>
                <label className={newAccountKind === 'customer' ? 'selected' : ''}>
                  <input type="radio" name="newAccountKind" checked={newAccountKind === 'customer'} onChange={() => setNewAccountKind('customer')} />
                  قسم ديون العملاء
                </label>
                <label className={newAccountKind === 'company' ? 'selected' : ''}>
                  <input type="radio" name="newAccountKind" checked={newAccountKind === 'company'} onChange={() => setNewAccountKind('company')} />
                  قسم ديون الشركات
                </label>
                <p className="muted">سينشأ الكارت باسم «{linkingReceipt.customerName}» ثم تُسجل عليه الحركة بعد اعتمادك فقط.</p>
              </div>
            )}
            <label>
              نوع الحركة عند الاعتماد
              <select
                value={entryType}
                onChange={(event) => setEntryType(event.target.value as 'payment' | 'debt')}
              >
                <option value="payment">خصم القيمة من رصيد الكارت (تسديد / خروج)</option>
                <option value="debt">إضافة القيمة إلى رصيد الكارت (دين / دخول)</option>
              </select>
            </label>
            <p className="muted">لن يحدث أي تأثير مالي إلا بعد الضغط على «ربط واعتماد».</p>
            <div className="dialog-actions">
              <button onClick={() => setLinkingReceipt(null)}>إلغاء</button>
              <button
                className="primary"
                disabled={(linkMode === 'existing' && !selectedCustomerId) || busy !== ''}
                onClick={() => void approve()}
              >
                <Check size={15} />
                {linkMode === 'new' ? 'إنشاء الكارت وربطه واعتماده' : 'ربط واعتماد'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
