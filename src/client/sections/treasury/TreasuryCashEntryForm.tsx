import type { FormEvent } from 'react';

export type TreasuryEntryMode = 'in' | 'out';

type TreasuryCashEntryFormProps = {
  mode: TreasuryEntryMode;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function TreasuryCashEntryForm({ mode, busy, onCancel, onSubmit }: TreasuryCashEntryFormProps) {
  return (
    <form className={`treasury-entry-form ${mode}`} onSubmit={onSubmit}>
      <strong>{mode === 'in' ? 'دخول فلوس نشطة' : 'خروج فلوس نشطة'}</strong>
      <label>
        القيمة
        <input name="amountUnits" type="number" min="1" step="1" inputMode="numeric" required autoFocus />
      </label>
      <label>
        البيان
        <input name="description" maxLength={500} placeholder="سبب الحركة" />
      </label>
      <button type="button" onClick={onCancel}>
        إلغاء
      </button>
      <button className="primary" disabled={busy}>
        اعتماد
      </button>
    </form>
  );
}
