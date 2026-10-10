import { strict as assert } from 'node:assert';
import { chromium } from '@playwright/test';
import { SCHEMA_VERSION, UI_VERSION } from '../src/server/config.ts';

const urls = ['https://localhost', process.env.ABDO_LAN_URL].filter((url): url is string => Boolean(url));
const browser = await chromium.launch({ headless: true });
try {
  for (const url of urls) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ar-LY' });
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, `${url} did not return 200`);
    assert.equal(await page.title(), 'عبده ERP المحلي');
    const health = await page.evaluate(async () => await (await fetch('/api/health')).json());
    assert.equal(health.ok, true);
    assert.equal(health.data.status, 'ready');
    assert.equal(health.data.uiVersion, UI_VERSION);
    assert.equal(health.data.schemaVersion, SCHEMA_VERSION);
    await page.close();
  }
  console.log(`Installed HTTPS smoke passed without certificate-error bypass on ${urls.join(' and ')}.`);
} finally {
  await browser.close();
}
