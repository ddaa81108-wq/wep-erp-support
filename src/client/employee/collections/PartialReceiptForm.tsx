import { useRef, useState } from 'react';
import { uiText } from '../../i18n/language.ts';
import { useUnsavedForm } from '../../dashboard/useUnsavedForm.ts';

/** One opened form represents one receipt. A confirmed receipt closes and clears
 * immediately; reopening with a new amount is an explicit, independent receipt. */
export function PartialReceiptForm({ busy, submit }: {
  busy: boolean;
  submit: (amount: number, confirmed: () => void) => Promise<boolean>;
}) {
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const locked = busy || sending;
  const { bindForm, trackChanges, markSaved } = useUnsavedForm(locked);
  return (
    <form ref={bindForm} onInput={trackChanges} onChange={trackChanges}
      className="partial-collection-form" aria-busy={locked}
      onSubmit={async event => {
        event.preventDefault();
        if (inFlight.current || busy) return;
        const form = event.currentTarget;
        const amount = Number(new FormData(form).get('amount'));
        inFlight.current = true;
        setSending(true);
        let confirmed = false;
        const finish = () => {
          if (confirmed) return;
          confirmed = true;
          if (!form.isConnected) return;
          form.reset();
          markSaved();
          const details = form.closest('details');
          if (details) details.open = false;
        };
        try {
          if (await submit(amount, finish)) finish();
        } finally {
          inFlight.current = false;
          if (form.isConnected) setSending(false);
        }
      }}>
      <label>{uiText('القيمة')}
        <input name="amount" inputMode="numeric" type="number" min="1" step="1"
          required placeholder={uiText('المبلغ')} disabled={locked} />
      </label>
      <button aria-label={uiText('حفظ')} disabled={locked}>
        {locked ? uiText('جارٍ الحفظ…') : uiText('حفظ')}
      </button>
    </form>
  );
}
