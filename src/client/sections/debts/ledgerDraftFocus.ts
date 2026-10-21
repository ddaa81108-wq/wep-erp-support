/** Autofocus yields to any focus choice made before the next animation frame. */
export function scheduleLedgerDraftFocus(container: HTMLElement) {
  const document = container.ownerDocument;
  const view = document.defaultView;
  if (!view) return () => {};
  const initialFocus = document.activeElement;
  let focusChanged = false;
  const onFocus = () => {
    focusChanged = true;
  };
  document.addEventListener('focusin', onFocus);
  const frame = view.requestAnimationFrame(() => {
    document.removeEventListener('focusin', onFocus);
    if (!container.isConnected || focusChanged || document.activeElement !== initialFocus) return;
    // A row or field already chosen inside the ledger takes priority as well.
    if (initialFocus instanceof view.HTMLElement && container.contains(initialFocus)) return;
    container
      .querySelector<HTMLInputElement>(
        '[data-new-ledger-draft] input[aria-label="قيمة المعاملة"]:not(:disabled)',
      )
      ?.focus();
  });
  return () => {
    view.cancelAnimationFrame(frame);
    document.removeEventListener('focusin', onFocus);
  };
}
