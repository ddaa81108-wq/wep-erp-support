import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

declare global {
  interface Window {
    ledgerFocus: typeof import('../src/client/sections/debts/ledgerDraftFocus.ts');
  }
}

const bundle = await build({
  entryPoints: ['src/client/sections/debts/ledgerDraftFocus.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'ledgerFocus',
  platform: 'browser',
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`
    <button id="outside">Outside</button>
    <div id="ledger">
      <div id="first" tabindex="0">First record</div>
      <div id="second" tabindex="0">Second record</div>
      <div data-new-ledger-draft><input id="amount" aria-label="قيمة المعاملة"></div>
    </div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate(() => {
    const container = document.getElementById('ledger')!;
    const first = document.getElementById('first')!;
    const second = document.getElementById('second')!;
    const outside = document.getElementById('outside')!;
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    window.requestAnimationFrame = (callback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    };
    window.cancelAnimationFrame = (id) => {
      callbacks.delete(id);
    };
    const flush = () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(performance.now());
    };
    const schedule = () => window.ledgerFocus.scheduleLedgerDraftFocus(container);
    outside.focus();
    schedule();
    flush();
    const automatic = document.activeElement?.id;
    outside.focus();
    schedule();
    first.focus();
    second.focus();
    flush();
    const manual = document.activeElement?.id;
    schedule();
    flush();
    const alreadySelected = document.activeElement?.id;
    outside.focus();
    const cancel = schedule();
    cancel();
    flush();
    const cancelled = document.activeElement?.id;
    schedule();
    container.remove();
    flush();
    const detached = document.activeElement?.id;
    return { automatic, manual, alreadySelected, cancelled, detached };
  });
  assert.deepEqual(results, {
    automatic: 'amount',
    manual: 'second',
    alreadySelected: 'second',
    cancelled: 'outside',
    detached: 'outside',
  });
  console.log(
    'PASS ledger focus: automatic amount focus, manual row choice, existing focus, cancellation and detached ledger.',
  );
} finally {
  await browser.close();
}
