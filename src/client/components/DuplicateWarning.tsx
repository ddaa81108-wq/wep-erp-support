import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { direction, uiText } from '../i18n/language.ts';
import { answerDuplicate, cancelDuplicatePrompts, duplicateSnapshot, subscribeDuplicate } from './duplicatePrompt.ts';

export function DuplicateWarning() {
  const prompt = useSyncExternalStore(subscribeDuplicate, duplicateSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (prompt && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [prompt]);
  useEffect(() => () => cancelDuplicatePrompts(), []);
  if (!prompt) return null;
  return createPortal(
    <dialog ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="duplicate-warning-title"
      aria-describedby="duplicate-warning-description" className="duplicate-warning-dialog" dir={direction}
      onCancel={event => { event.preventDefault(); answerDuplicate(false); }}
      onKeyDown={event => event.stopPropagation()}>
      <h2 id="duplicate-warning-title">{uiText('تنبيه معاملة مكررة')}</h2>
      <p id="duplicate-warning-description">{uiText('توجد معاملة مماثلة في نفس المكان خلال يوم العمل الحالي. هل تريد إضافتها مرة أخرى؟')}</p>
      <div className="duplicate-warning-actions">
        <button type="button" className="secondary" autoFocus onClick={() => answerDuplicate(false)}>{uiText('رجوع للمراجعة')}</button>
        <button type="button" onClick={() => answerDuplicate(true)}>{uiText('إضافة مرة أخرى')}</button>
      </div>
    </dialog>, document.body,
  );
}
