import { uiText } from '../i18n/language.ts';
import { useEffect, useState } from 'react';

const key = 'abdo-readability';
type Level = 'medium' | 'large' | 'off';
const labels: Record<Level, string> = { medium: uiText("متوسط"), large: uiText("كبير"), off: uiText("متوقف") };
const excluded = '[data-readability-controls], [data-no-magnify], input, textarea, select, [contenteditable]:not([contenteditable="false"]), [aria-hidden="true"], script, style, svg';

export function Readability({ toolbar = false }: { toolbar?: boolean }) {
  const [feedback, setFeedback] = useState(false);
  const [level, setLevel] = useState<Level>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === 'large' || stored === 'off' ? stored : 'medium';
    } catch { return 'medium'; }
  });

  useEffect(() => {
    document.documentElement.dataset.readability = level;
    try { localStorage.setItem(key, level); } catch { /* Storage may be disabled. */ }
    if (level === 'off') return () => { delete document.documentElement.dataset.readability; };

    const lens = document.createElement('div');
    lens.className = 'readability-lens';
    lens.setAttribute('aria-hidden', 'true');
    lens.hidden = true;
    document.body.append(lens);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Node | null = null;
    let keyboardFocus = false;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      lens.hidden = true;
    };
    const show = (text: string, element: Element, x: number, y: number) => {
      if (!element.isConnected) return;
      lens.textContent = text;
      lens.style.fontSize = `${Math.min(40, Math.max(level === 'large' ? 26 : 22, parseFloat(getComputedStyle(element).fontSize) * (level === 'large' ? 2 : 1.5)))}px`;
      lens.style.direction = getComputedStyle(element).direction;
      lens.hidden = false;
      const bounds = lens.getBoundingClientRect();
      lens.style.left = `${Math.max(8, Math.min(x - bounds.width / 2, innerWidth - bounds.width - 8))}px`;
      lens.style.top = `${Math.max(8, y + 20 + bounds.height <= innerHeight - 8 ? y + 20 : y - bounds.height - 16)}px`;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons || !(event.target instanceof Element) || event.target.closest(excluded)) { hide(); return; }
      // Resolve only the text under the pointer, never a whole table or panel.
      const caretDocument = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null };
      const node = caretDocument.caretPositionFromPoint?.(event.clientX, event.clientY)?.offsetNode
        ?? document.caretRangeFromPoint?.(event.clientX, event.clientY)?.startContainer;
      const element = node?.parentElement;
      if (!node || node.nodeType !== Node.TEXT_NODE || !element || element.closest(excluded)) { hide(); return; }
      const textRange = document.createRange();
      textRange.selectNodeContents(node);
      if (![...textRange.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)) { hide(); return; }
      if (current === node) return;
      hide();
      const text = (element.closest('[data-preview]')?.getAttribute('data-preview') ?? node.textContent ?? '').trim();
      if (!text || text.length > 2000) return;
      current = node;
      timer = setTimeout(() => show(text, element, event.clientX, event.clientY), 450);
    };
    const focus = (event: FocusEvent) => {
      hide();
      if (!keyboardFocus || !(event.target instanceof HTMLElement) || event.target.closest(excluded)) return;
      const text = event.target.getAttribute('data-preview');
      if (!text) return;
      const rect = event.target.getBoundingClientRect();
      show(text, event.target, rect.left + rect.width / 2, rect.bottom);
    };
    const keydown = (event: KeyboardEvent) => { keyboardFocus = event.key === 'Tab'; hide(); };
    const pointerdown = () => { keyboardFocus = false; hide(); };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerdown', pointerdown, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', keydown);
    document.documentElement.addEventListener('pointerleave', hide);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      lens.remove();
      delete document.documentElement.dataset.readability;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', pointerdown, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', keydown);
      document.documentElement.removeEventListener('pointerleave', hide);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
    };
  }, [level]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(false), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback, level]);

  return <button type="button" className={`readability-control${toolbar ? ' utility-icon-button' : ''}`} data-level={level} data-readability-controls="" aria-label={uiText("تكبير القراءة: {0}", [labels[level]])} title={uiText("تكبير القراءة: {0} — اضغط لتغيير المستوى", [labels[level]])} onClick={() => {
    setLevel(level === 'medium' ? 'large' : level === 'large' ? 'off' : 'medium');
    setFeedback(true);
  }}>{level === 'off' ? uiText("ع×") : level === 'large' ? uiText("ع++") : uiText("ع+")} <span>{labels[level]}</span>{feedback && <span className="readability-feedback" role="status">{level === 'off' ? uiText("تكبير القراءة متوقف") : uiText("التكبير {0} — مرّر على النص أو ابدأ الكتابة", [labels[level]])}</span>}</button>;
}
