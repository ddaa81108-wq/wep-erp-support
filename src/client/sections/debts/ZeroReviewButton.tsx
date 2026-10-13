import { useState } from 'react';
import { Check } from 'lucide-react';
import type { Customer } from '../../api.ts';

export function ZeroReviewButton({ customer, onReview }: {
  customer: Customer; onReview: (customer: Customer) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const review = customer.zeroReview;
  if (!review || customer.balanceUnits !== 0) return null;
  if (!review.pending) return review.reviewedAt ? <span className="zero-review-status reviewed"
    aria-label="تمت مراجعة التصفير" title={`راجعها ${review.reviewedByName ?? 'الإدارة'} — ${new Date(review.reviewedAt).toLocaleString('ar-LY')}`}>
    <Check size={14} aria-hidden="true" />
  </span> : null;
  return <button type="button" className="zero-review-status pending" disabled={busy}
    aria-label={`مراجعة تصفير ${customer.name}`} title="تأكيد الاطلاع على التصفير ونقل الكارت إلى المسدد"
    onClick={async () => { setBusy(true); try { await onReview(customer); } finally { setBusy(false); } }}>
    <Check size={14} aria-hidden="true" />
  </button>;
}
