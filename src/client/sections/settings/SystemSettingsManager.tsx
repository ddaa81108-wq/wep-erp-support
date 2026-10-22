import { uiText } from '../../i18n/language.ts';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api, type OrganizationSettings } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';
import { language } from '../../i18n/language.ts';
import { LanguageToggle } from '../../i18n/LanguageToggle.tsx';

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : uiText("تعذر تحميل الإعدادات الآن.");

export function SystemSettingsManager({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.organizationSettings()
      .then((result) => setSettings(result.settings))
      .catch((error) => setNotice(message(error)));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice('');
    try {
      const result = await api.updateOrganizationSettings({
        expectedVersion: settings.version,
        systemName: String(form.get('systemName') ?? ''),
        timezone: String(form.get('timezone')) as OrganizationSettings['timezone'],
        employeeSectionsVisible: true,
      });
      setSettings(result.settings);
      window.dispatchEvent(new Event('abdo:organization-settings-changed'));
      setNotice(uiText("تم حفظ الإعدادات وتسجيل التغيير في سجل التدقيق."));
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={uiText("الإعدادات العامة للمنظومة")} onClose={onClose}>
      {!settings ? (
        <div className="settings-loading">{notice || uiText("جارٍ تحميل الإعدادات…")}</div>
      ) : (
        <form className="stack system-settings-form" onSubmit={submit}>
          <div className="settings-policy-note">
            {uiText("هذه القيم تخص المؤسسة الحالية، وتُحفظ بإصدار يمنع الكتابة المتعارضة بين إداريين.")}</div>
          <label>
            {uiText("اسم المنظومة")}<input name="systemName" defaultValue={settings.systemName} minLength={2} maxLength={80} required />
          </label>
          <label>
            {uiText("المنطقة الزمنية المعتمدة للحركات")}<select name="timezone" defaultValue={settings.timezone}>
              <option value="Africa/Tripoli">{uiText("ليبيا — Africa/Tripoli")}</option>
              <option value="Africa/Cairo">{uiText("مصر — Africa/Cairo")}</option>
            </select>
          </label>
          <div className="settings-readonly-grid">
            <div><span>{uiText("لغة المنظومة")}</span><strong>{language === 'ar' ? 'العربية' : 'English'}</strong><LanguageToggle /></div>
            <div><span>{uiText("العملة الأساسية للخزينة")}</span><strong>{uiText("الدينار الليبي")}</strong></div>
            <div><span>{uiText("العملة المساندة")}</span><strong>{uiText("الجنيه المصري")}</strong></div>
            <div><span>{uiText("التحديث المتزامن")}</span><strong>{uiText("مفعّل")}</strong></div>
            <div><span>{uiText("الأقسام غير المصرح بها")}</span><strong>{uiText("ظاهرة ومقفلة")}</strong></div>
          </div>
          {notice && <div className="alert success">{notice}</div>}
          <div className="form-actions">
            <button type="button" className="secondary" onClick={onClose}>{uiText("إغلاق")}</button>
            <button className="primary" disabled={busy}>{busy ? uiText("جارٍ الحفظ…") : uiText("حفظ الإعدادات")}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
