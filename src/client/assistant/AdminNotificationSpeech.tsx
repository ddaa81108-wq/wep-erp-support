import { uiText } from '../i18n/language.ts';
import { selectEgyptianVoice } from './notificationSpeech.ts';
import type { useAdminNotificationSpeech } from './useAdminNotificationSpeech.ts';

export function AdminNotificationSpeech({
  speech,
}: {
  speech: ReturnType<typeof useAdminNotificationSpeech>;
}) {
  const { settings, voices, ready, busy } = speech;
  const selected = selectEgyptianVoice(voices, settings.voiceURI);
  return (
    <details className="admin-notification-speech">
      <summary>{uiText('صوت الإشعارات لحسابي')}</summary>
      <p>{uiText('يُحفظ لحسابك فقط ويُستخدم أينما تسجّل الدخول؛ لا يغيّر إعدادات الموظفين.')}</p>
      <label>
        {uiText('طريقة النطق')}
        <select
          aria-label={uiText('طريقة النطق')}
          disabled={!ready || busy}
          value={settings.profile}
          onChange={(event) =>
            void speech.save({ ...settings, profile: event.target.value as 'default' | 'clear' | 'egyptian' })
          }
        >
          <option value="default">{uiText('صوت الجهاز المعتاد')}</option>
          <option value="clear">{uiText('الصوت الحالي مع تحسين الوضوح')}</option>
          <option value="egyptian">{uiText('صوت مصري')}</option>
        </select>
      </label>
      {settings.profile === 'egyptian' && (
        <>
          <p role="status">
            {selected
              ? uiText('الصوت المتاح الآن: {0}', [selected.name])
              : uiText(
                  'لا يتوفر صوت مصري على هذا الجهاز حاليًا. سيستمر صوت الجهاز المعتاد للإشعارات؛ اختيار المصري وحده لا يثبّت صوتًا جديدًا.',
                )}
          </p>
          <label>
            {uiText('الصوت المصري')}
            <select
              aria-label={uiText('الصوت المصري')}
              disabled={!ready || busy || voices.length === 0}
              value={voices.some((voice) => voice.voiceURI === settings.voiceURI) ? settings.voiceURI : ''}
              onChange={(event) => void speech.save({ ...settings, voiceURI: event.target.value })}
            >
              <option value="">{uiText('تلقائي حسب الجهاز')}</option>
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {settings.profile === 'clear' && (
        <p>
          {uiText(
            'نفس صوت جهازك الحالي، مع قراءة العملات كاملة وتجهيز النص الطويل على أجزاء متتابعة دون حذف كلمات.',
          )}
        </p>
      )}
      <label>
        {uiText('سرعة القراءة')}
        <select
          aria-label={uiText('سرعة القراءة')}
          disabled={!ready || busy || settings.profile === 'default'}
          value={settings.rate}
          onChange={(event) => void speech.save({ ...settings, rate: Number(event.target.value) })}
        >
          {[0.7, 0.8, 0.9, 0.95, 1, 1.1, 1.2].map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!ready || busy || settings.profile === 'default' || !speech.supported || (settings.profile === 'egyptian' && !selected)}
        onClick={speech.preview}
      >
        {settings.profile === 'egyptian' ? uiText('تجربة الصوت المصري') : uiText('تجربة وضوح النطق الحالي')}
      </button>
      <small>
        {uiText('التجربة لا تسجّل معاملة ولا تفعّل النطق تلقائيًا. فعّل «النطق» لتسمع الإشعارات الجديدة.')}
      </small>
      {busy && <p role="status">{uiText('جارٍ حفظ إعدادات الصوت…')}</p>}
      {speech.error && (
        <p className="notification-error" role="alert">
          {speech.error}
        </p>
      )}
    </details>
  );
}
