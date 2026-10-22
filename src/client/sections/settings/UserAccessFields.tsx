import { uiText } from '../../i18n/language.ts';
import { useState } from 'react';
import type { ManagedUser } from '../../api.ts';
import { currentAccess, USER_ACCESS_CONFIG, type AccessLevel } from './userAccessModel.ts';

export function UserAccessFields({ editing }: { editing: ManagedUser | null }) {
  const [levels, setLevels] = useState<Record<string, AccessLevel>>(() => Object.fromEntries(
    USER_ACCESS_CONFIG.map((config) => [config.field, currentAccess(editing, config)]),
  ));
  const applyTemplate = (fields: readonly string[]) => setLevels(Object.fromEntries(
    USER_ACCESS_CONFIG.map((config) => [config.field, fields.includes(config.field) ? 'manage' : 'none']),
  ));
  return (
    <>
      <div className="permission-templates">
        <span>{uiText("قوالب سريعة:")}</span>
        <button type="button" onClick={() => applyTemplate(USER_ACCESS_CONFIG.map((item) => item.field))}>{uiText("كل الأقسام")}</button>
        <button type="button" onClick={() => applyTemplate([])}>{uiText("قفل الكل")}</button>
        <button type="button" onClick={() => applyTemplate(['customerDebtsAccess', 'companyDebtsAccess', 'collectionsAccess'])}>{uiText("الديون والاستلامات")}</button>
        <button type="button" onClick={() => applyTemplate(['masraweyaAccess', 'purchasesAccess', 'egyptianDepositsAccess'])}>{uiText("الحسابات المصرية")}</button>
        <button type="button" onClick={() => applyTemplate(['treasuryAccess', 'reportsAccess'])}>{uiText("الخزينة والتقارير")}</button>
      </div>
      <div className="user-access-grid">
      {USER_ACCESS_CONFIG.map((config) => (
        <fieldset key={config.field}>
          <legend>{config.title}</legend>
          <label>
            {uiText("صلاحية القسم")}<select
              name={config.field}
              value={levels[config.field] === 'manage' ? 'manage' : 'none'}
              onChange={(event) => setLevels((current) => ({
                ...current,
                [config.field]: event.target.value as AccessLevel,
              }))}
            >
              <option value="none">{uiText("ظاهر ومقفول")}</option>
              <option value="manage">{config.availableLabel}</option>
            </select>
          </label>
          {config.hint && <small className="muted">{config.hint}</small>}
        </fieldset>
      ))}
      </div>
    </>
  );
}
