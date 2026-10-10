import type { AccountRequest } from '../../api.ts';

type AccountRequestsListProps = {
  requests: readonly AccountRequest[];
  busy: boolean;
  onDecide: (request: AccountRequest, decision: 'approve' | 'reject') => void;
};

export function AccountRequestsList({ requests, busy, onDecide }: AccountRequestsListProps) {
  return (
    <section className="account-requests">
      <h4>
        طلبات الانضمام <span>{requests.length}</span>
      </h4>
      {requests.length === 0 ? (
        <p className="muted">لا توجد طلبات Google بانتظار الموافقة.</p>
      ) : (
        requests.map((request) => (
          <article key={request.id}>
            <div>
              <strong>{request.displayName}</strong>
              <span dir="ltr">{request.email}</span>
              <small>حساب Google موثّق — ينتظر قرار الإدارة</small>
            </div>
            <button className="secondary" disabled={busy} onClick={() => onDecide(request, 'reject')}>
              رفض
            </button>
            <button className="primary" disabled={busy} onClick={() => onDecide(request, 'approve')}>
              موافقة بدون أقسام
            </button>
          </article>
        ))
      )}
    </section>
  );
}
