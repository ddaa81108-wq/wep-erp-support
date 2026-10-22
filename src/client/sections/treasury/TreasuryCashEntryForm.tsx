import { uiText } from '../../i18n/language.ts';
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
      <strong>{mode === 'in' ? uiText("دخول فلوس نشطة") : uiText("خروج فلوس نشطة")}</strong>
      <label>
        {uiText("القيمة")}<input name="amountUnits" type="number" min="1" step="1" inputMode="numeric" required autoFocus />
      </label>
      <label>
        {uiText("البيان")}<input name="description" maxLength={500} placeholder={uiText("سبب الحركة")} />
      </label>
      <button type="button" onClick={onCancel}>
        {uiText("إلغاء")}</button>
      <button className="primary" disabled={busy}>
        {uiText("اعتماد")}</button>
    </form>
  );
}
