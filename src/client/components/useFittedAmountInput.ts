import { useLayoutEffect, useRef, useState } from 'react';

const MIN_FONT_SIZE = 12;

/** Fits presentation only: the native number input and its exact value remain untouched. */
export function useFittedAmountInput(value: string | number) {
  const ref = useRef<HTMLInputElement>(null);
  const [showFullValue, setShowFullValue] = useState(false);

  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    let disposed = false;
    const fit = () => {
      if (disposed || !input.isConnected) return;
      // Read the normal/focused size, including the user's readability setting.
      input.style.removeProperty('font-size');
      const style = getComputedStyle(input);
      const preferred = parseFloat(style.fontSize);
      const available =
        input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 4;
      if (!Number.isFinite(preferred) || available <= 0) return;
      const text = input.value;
      const spacing = parseFloat(style.letterSpacing) || 0;
      const widthAt = (size: number) => {
        context.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
        return context.measureText(text).width + Math.max(0, text.length - 1) * spacing;
      };
      let size = preferred;
      if (text && widthAt(size) > available) {
        let low = Math.min(MIN_FONT_SIZE, preferred);
        let high = preferred;
        for (let step = 0; step < 12; step += 1) {
          const middle = (low + high) / 2;
          if (widthAt(middle) <= available) low = middle;
          else high = middle;
        }
        size = Math.floor(low * 10) / 10;
      }
      input.style.setProperty('font-size', `${size}px`, 'important');
      setShowFullValue(document.activeElement === input && widthAt(size) > available);
    };
    let previousWidth = -1;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width !== previousWidth) {
        previousWidth = width;
        fit();
      }
    });
    observer.observe(input);
    const settings = new MutationObserver(fit);
    settings.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-readability', 'data-theme'],
    });
    input.addEventListener('focus', fit);
    input.addEventListener('blur', fit);
    document.fonts.addEventListener('loadingdone', fit);
    void document.fonts.ready.then(() => {
      if (!disposed) fit();
    });
    fit();
    return () => {
      disposed = true;
      observer.disconnect();
      settings.disconnect();
      input.removeEventListener('focus', fit);
      input.removeEventListener('blur', fit);
      document.fonts.removeEventListener('loadingdone', fit);
      input.style.removeProperty('font-size');
    };
  }, [value]);

  return { ref, showFullValue };
}
