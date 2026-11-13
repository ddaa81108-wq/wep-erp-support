/** Keep native number-input stepping from changing a financial value on arrow navigation. */
export function startNumberInputGuard() {
  const preventStepping = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.target instanceof HTMLInputElement && event.target.type === 'number') {
      // Do not stop propagation: ledger/purchase handlers still navigate or commit.
      event.preventDefault();
    }
  };
  document.addEventListener('keydown', preventStepping, true);
  return () => document.removeEventListener('keydown', preventStepping, true);
}
