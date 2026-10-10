import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api, type OrganizationSettings } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : 'تعذر تحميل الإعدادات الآن.';

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
      setNotice('تم حفظ الإعدادات وتسجيل التغيير في سجل التدقيق.');
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="الإعدادات العامة للمنظومة" onClose={onClose}>
      {!settings ? (
        <div className="settings-loading">{notice || 'جارٍ تحميل الإعدادات…'}</div>
      ) : (
        <form className="stack system-settings-form" onSubmit={submit}>
          <div className="settings-policy-note">
            هذه القيم تخص المؤسسة الحالية، وتُحفظ بإصدار يمنع الكتابة المتعارضة بين إداريين.
          </div>
          <label>
            اسم المنظومة
            <input name="systemName" defaultValue={settings.systemName} minLength={2} maxLength={80} required />
          </label>
          <label>
            المنطقة الزمنية المعتمدة للحركات
            <select name="timezone" defaultValue={settings.timezone}>
              <option value="Africa/Tripoli">ليبيا — Africa/Tripoli</option>
              <option value="Africa/Cairo">مصر — Africa/Cairo</option>
            </select>
          </label>
          <div className="settings-readonly-grid">
            <div><span>لغة المنظومة</span><strong>العربية</strong></div>
            <div><span>العملة الأساسية للخزينة</span><strong>الدينار الليبي</strong></div>
            <div><span>العملة المساندة</span><strong>الجنيه المصري</strong></div>
            <div><span>التحديث المتزامن</span><strong>مفعّل</strong></div>
            <div><span>الأقسام غير المصرح بها</span><strong>ظاهرة ومقفلة</strong></div>
          </div>
          {notice && <div className="alert success">{notice}</div>}
          <div className="form-actions">
            <button type="button" className="secondary" onClick={onClose}>إغلاق</button>
            <button className="primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
