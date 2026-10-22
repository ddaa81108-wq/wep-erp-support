import { uiText } from '../../i18n/language.ts';
import { Plus } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import {
  masraweyaGridNavigation,
  masraweyaNumberFormat,
  numberValue,
  type MasraweyaEntryDraft,
} from './masraweyaModel.ts';

type Props = {
  rows: MasraweyaEntryDraft[];
  workTotal: number;
  locked: boolean;
  onAppend: () => void;
  onEdit: (index: number, field: keyof MasraweyaEntryDraft, value: string) => void;
};

export function MasraweyaWorkTable({ rows, workTotal, locked, onAppend, onEdit }: Props) {
  function move(event: KeyboardEvent<HTMLInputElement>, rowIndex: number, column: number) {
    const target = masraweyaGridNavigation(event.key, rowIndex, column, rows.length);
    if (!target) return;
    event.preventDefault();
    const table = event.currentTarget.closest('table');
    if (target.append) {
      onAppend();
      if (window.matchMedia('(min-width: 901px)').matches) {
        window.requestAnimationFrame(() => focusCell(table, target.row, target.column));
      } else {
        window.setTimeout(() => focusCell(table, target.row, target.column), 0);
      }
      return;
    }
    focusCell(table, target.row, target.column);
  }

  return (
    <section className="masraweya-panel work-panel">
      <div className="panel-title">
        <div>
          <h2>{uiText("شغل اليوم")}</h2>
          <small>{uiText("القيمة + العمولة = الناتج")}</small>
          <small className="masraweya-desktop-keyboard-hint">{uiText("الأسهم ↑ ↓ ← → للتنقل بين القيمة والعمولة والصفوف")}</small>
        </div>
        {!locked && (
          <button onClick={onAppend}>
            <Plus size={16} />
            {uiText("صف")}</button>
        )}
      </div>
      <div className="masraweya-table-scroll">
        <table className="masraweya-work-table">
          <thead>
            <tr>
              <th>{uiText("التسلسل")}</th>
              <th>{uiText("القيمة")}</th>
              <th>{uiText("العمولة")}</th>
              <th>{uiText("الناتج")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>
                  <input
                    aria-label={uiText("القيمة في الصف {0}", [index + 1])}
                    inputMode="numeric"
                    dir="ltr"
                    disabled={locked}
                    value={row.value}
                    data-mas-row={index}
                    data-mas-col="0"
                    onKeyDown={(event) => move(event, index, 0)}
                    onChange={(event) => onEdit(index, 'value', event.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={uiText("العمولة في الصف {0}", [index + 1])}
                    inputMode="numeric"
                    dir="ltr"
                    disabled={locked}
                    value={row.commission}
                    data-mas-row={index}
                    data-mas-col="1"
                    onKeyDown={(event) => move(event, index, 1)}
                    onChange={(event) => onEdit(index, 'commission', event.target.value)}
                  />
                </td>
                <td dir="ltr">
                  {masraweyaNumberFormat.format(numberValue(row.value) + numberValue(row.commission))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3}>{uiText("إجمالي شغل اليوم")}</th>
              <th dir="ltr">{masraweyaNumberFormat.format(workTotal)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function focusCell(table: HTMLTableElement | null, row: number, column: number) {
  const input = table?.querySelector<HTMLInputElement>(`[data-mas-row="${row}"][data-mas-col="${column}"]`);
  input?.focus();
  if (window.matchMedia('(min-width: 901px)').matches) input?.select();
}
