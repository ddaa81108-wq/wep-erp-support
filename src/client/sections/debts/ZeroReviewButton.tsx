import { uiText, displayLocale } from '../../i18n/language.ts';
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
    aria-label={uiText("تمت مراجعة التصفير")} title={uiText("راجعها {0} — {1}", [review.reviewedByName ?? uiText("الإدارة"), new Date(review.reviewedAt).toLocaleString(displayLocale)])}>
    <Check size={14} aria-hidden="true" />
  </span> : null;
  return <button type="button" className="zero-review-status pending" disabled={busy}
    aria-label={uiText("مراجعة تصفير {0}", [customer.name])} title={uiText("تأكيد الاطلاع على التصفير ونقل الكارت إلى المسدد")}
    onClick={async () => { setBusy(true); try { await onReview(customer); } finally { setBusy(false); } }}>
    <Check size={14} aria-hidden="true" />
  </button>;
}
