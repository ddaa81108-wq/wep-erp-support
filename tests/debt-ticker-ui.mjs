/* global process, window, console */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {DebtTicker} from './src/client/sections/debts/DebtTicker.tsx';const root=createRoot(document.getElementById('root'));window.renderTicker=(count)=>{const customers=Array.from({length:count},(_,i)=>({id:String(i),name:'عميل اختبار '+i,balanceUnits:1500,debtAgeDays:5}));root.render(<DebtTicker customers={customers} onOpenLedger={id=>window.opened=id}/>)};window.renderTicker(1);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
});
const css = ['foundation-auth.css', 'workspace.css', 'night-theme.css', 'customer-header-gold.css']
  .map((f) => readFileSync('src/client/styles/' + f, 'utf8'))
  .join('\n');
mkdirSync('artifacts/ticker', { recursive: true });
for (const channel of [undefined, 'msedge']) {
  const b = await chromium.launch({ channel });
  try {
    for (const width of [390, 1440])
      for (const theme of ['light', 'dark']) {
        const p = await b.newPage({ viewport: { width, height: 500 } });
        await p.setContent(
          `<html dir="rtl" data-theme="${theme}"><head><style>${css}</style></head><body><div id="root" class="workspace active-section-customers"></div></body></html>`,
        );
        await p.addScriptTag({ content: bundle.outputFiles[0].text });
        await p.waitForSelector('.debt-ticker button');
        await p.mouse.move(0, 490);
        assert.equal(await p.locator('.debt-ticker button').count(), 1);
        assert.equal(await p.locator('.debt-ticker-track').evaluate((e) => e.getAnimations().length), 0);
        await p.evaluate(() => window.renderTicker(40));
        await p.waitForTimeout(200);
        assert.equal(await p.locator('.debt-ticker button').count(), 40);
        const data = await p.locator('.debt-ticker-track').evaluate((e) => {
          const a = e.getAnimations()[0];
          return {
            duration: a.effect.getTiming().duration,
            distance: e.scrollWidth - e.parentElement.clientWidth,
            time: a.currentTime,
          };
        });
        assert.ok(Math.abs(data.duration - (data.distance / 24) * 1000) < 1);
        await p.evaluate(() => window.renderTicker(40));
        await p.waitForTimeout(150);
        assert.ok(
          await p
            .locator('.debt-ticker-track')
            .evaluate((e, t) => e.getAnimations()[0].currentTime > t, data.time),
        );
        await p.locator('.debt-ticker').hover();
        assert.equal(
          await p.locator('.debt-ticker-track').evaluate((e) => e.getAnimations()[0].playState),
          'paused',
        );
        await p.screenshot({ path: `artifacts/ticker/${channel ?? 'chromium'}-${theme}-${width}.png` });
        await p.evaluate(() => window.renderTicker(1));
        await p.waitForTimeout(100);
        await p.locator('.debt-ticker button').click();
        assert.equal(await p.evaluate(() => window.opened), '0');
        await p.emulateMedia({ reducedMotion: 'reduce' });
        await p.evaluate(() => window.renderTicker(40));
        await p.waitForTimeout(100);
        assert.equal(await p.locator('.debt-ticker-track').evaluate((e) => e.getAnimations().length), 0);
        await p.close();
        console.log('PASS', channel ?? 'chromium', width, theme);
      }
  } finally {
    await b.close();
  }
}

