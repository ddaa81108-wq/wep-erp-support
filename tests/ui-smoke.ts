import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, type Browser } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import type { ServerConfig } from '../src/server/config.ts';
import { openDatabase } from '../src/server/db/database.ts';

const temporary = mkdtempSync(join(tmpdir(), 'abdo-ui-smoke-'));
const database = openDatabase(join(temporary, 'ui.sqlite'));
const config: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  sessionHours: 12,
  secureCookie: false,
  internetRequired: true,
  internetProbeUrls: [],
  internetProbeTimeoutMs: 100,
  internetProbeCacheMs: 100,
};
let internetAvailable = true;
const server = createApp(database, config, { internetCheck: async () => internetAvailable });
let browser: Browser | undefined;

try {
  await listen(server, config.host, 0);
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'ar-LY' });
  const page = await context.newPage();
  const verifySidebar = async (role: string) => {
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
        if (width === 390) {
          await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).click();
          await page.locator('.sidebar.open').waitFor();
          await page.waitForFunction(() => {
            const bounds = document.querySelector('.sidebar.open')?.getBoundingClientRect();
            return bounds && bounds.left >= 0 && bounds.right <= innerWidth + 0.5;
          });
        }
        await page.screenshot({
          path: resolve('artifacts', 'ui', `fixed-sidebar-${role}-${theme}-${width}.png`),
          animations: 'disabled',
        });
        if (width === 390) {
          // Use a real click: this catches the search bar intercepting the close button.
          await page.getByRole('button', { name: 'إغلاق القائمة الرئيسية', exact: true }).click();
          await page.waitForFunction(() => !document.querySelector('.sidebar.open'));
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
      }
    }
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.waitForFunction(() => {
      const shell = document.querySelector('.app-shell');
      return shell && getComputedStyle(shell).paddingRight === '220px';
    });
  };

  const verifyCollectionsPhone = async (role: string) => {
    for (const width of [320, 390, 560]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => {
        const sidebar = document.querySelector('.sidebar');
        return !sidebar || sidebar.getBoundingClientRect().left >= innerWidth;
      });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        const layout = await page.locator('.collections-page').evaluate(root => {
          const header = root.querySelector('.collection-overview-header')!.getBoundingClientRect();
          const metrics = [...root.querySelectorAll('.collection-metrics article')]
            .filter(el => getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect());
          const toolbar = root.querySelector('.collection-toolbar-actions')!.getBoundingClientRect();
          const buttons = [...root.querySelectorAll('.collection-toolbar-actions button')]
            .filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
            .map(el => el.getBoundingClientRect());
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            compactHeader: header.height < 80,
            metricsCount: metrics.length,
            metricsOneRow: metrics.every(r => Math.abs(r.top - metrics[0].top) < 1),
            bottom: Math.abs(toolbar.bottom - innerHeight) < 1,
            buttons: buttons.length > 0 && buttons.every(r => r.height >= 40 && r.left >= 0 && r.right <= innerWidth),
          };
        });
        assert.deepEqual(layout, { overflow: false, compactHeader: true, metricsCount: 4, metricsOneRow: true, bottom: true, buttons: true });
        await page.screenshot({ path: resolve('artifacts', 'ui', 'collections-' + role + '-' + theme + '-' + width + '.png'), animations: 'disabled' });
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.setViewportSize({ width: 390, height: 844 });
  };

  await page.goto(base);
  await page.getByRole('heading', { name: 'تهيئة المدير الأول' }).waitFor();
  await page.getByLabel('الاسم الظاهر').fill('مدير النظام');
  await page.getByLabel('اسم المستخدم').fill('admin');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Local Admin 123!');
  await page.getByLabel('تأكيد كلمة المرور').fill('Local Admin 123!');
  await page.getByRole('button', { name: 'إنشاء حساب المدير' }).click();

  await page.getByRole('heading', { name: 'تسجيل الدخول' }).waitFor();
  await page.getByRole('button', { name: 'المتابعة باستخدام Google' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'المتابعة باستخدام Google' }).isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  await page.screenshot({ path: resolve('artifacts', 'ui', 'login-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'إنشاء حساب موظف' }).click();
  await page.getByRole('heading', { name: 'إنشاء حساب موظف' }).waitFor();
  await page.getByText('موافقة الإدارة', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'العودة لتسجيل الدخول' }).click();
  await page.getByLabel('كلمة المرور').fill('Local Admin 123!');
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('heading', { name: 'قسم ديون العملاء' }).waitFor();
  await verifySidebar('admin');
  const utilityGeometry = async () =>
    page.evaluate(() => {
      const search = document.querySelector('.global-account-search')?.getBoundingClientRect();
      const status = document.querySelector('.sync-status')?.getBoundingClientRect();
      return search && status
        ? { searchX: search.x, searchWidth: search.width, statusX: status.x, statusWidth: status.width }
        : null;
    });
  const utilityBeforeSaving = await utilityGeometry();
  await page.evaluate(() => window.dispatchEvent(new Event('abdo:request-start')));
  await page.locator('.sync-status.saving').waitFor();
  assert.deepEqual(await utilityGeometry(), utilityBeforeSaving, 'utility bar must not shift while saving');
  await page.evaluate(() => window.dispatchEvent(new Event('abdo:request-finish')));
  await page.evaluate(() => window.dispatchEvent(new Event('abdo:request-error')));
  await page.locator('.sync-status.error').waitFor();
  assert.match(await page.locator('.sync-status').innerText(), /غير محفوظ/);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('abdo:request-start'));
    window.dispatchEvent(new Event('abdo:request-finish'));
  });
  await page.locator('.sync-status.ready').waitFor();
  assert.match(await page.locator('.sync-status').innerText(), /جميع التغييرات محفوظة/);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.getByRole('button', { name: 'المظهر الليلي' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.evaluate(() => localStorage.getItem('abdo-erp-theme')), 'dark');
  await page.reload();
  await page.getByRole('heading', { name: 'قسم ديون العملاء' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('button', { name: 'المظهر النهاري' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'إخفاء الشريط الجانبي' }).click();
  assert.equal(await page.locator('.app-shell').getAttribute('class'), 'app-shell sidebar-hidden');
  assert.equal(await page.evaluate(() => localStorage.getItem('abdo-erp-sidebar-hidden')), 'true');
  assert.equal(
    await page.getByRole('button', { name: 'الإشعارات' }).evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.right <= window.innerWidth;
    }),
    true,
    'notification button must stay visible when the sidebar is hidden',
  );
  await page.getByRole('button', { name: 'إظهار الشريط الجانبي' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('abdo-erp-sidebar-hidden')), 'false');
  await page
    .locator('.sidebar-identity .identity-user strong')
    .getByText('مدير النظام', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'الإشعارات' }).click();
  const notificationPanel = page.locator('.notification-panel');
  await notificationPanel.waitFor();
  assert.equal(
    await notificationPanel.evaluate(
      (element) => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)',
    ),
    false,
    'notification center must use an opaque readable background',
  );
  await notificationPanel.getByRole('button', { name: 'إغلاق' }).click();
  assert.equal(await page.getByRole('button', { name: 'أمر صوتي' }).count(), 0);
  assert.equal(await page.getByLabel('الأمر الذكي').count(), 0);
  await page.getByRole('button', { name: 'قسم المشتريات' }).click();
  await page.getByRole('heading', { name: 'قسم المشتريات' }).waitFor();
  await page.getByRole('button', { name: 'قسم ديون العملاء' }).click();
  await page.getByRole('heading', { name: 'قسم ديون العملاء' }).waitFor();

  await page.getByRole('button', { name: /إضافة عميل/ }).click();
  const customerDialog = page.getByRole('dialog');
  await customerDialog.waitFor();
  assert.equal(await customerDialog.locator('input').count(), 3);
  assert.equal(await customerDialog.locator('select').count(), 0);
  await page.getByLabel('اسم العميل', { exact: true }).fill('متجر النور');
  await page.getByLabel('رقم الهاتف').fill('0912345678');
  await page.getByRole('button', { name: 'حفظ الحساب' }).click();
  await page.getByRole('heading', { name: 'متجر النور' }).waitFor();
  if (await page.getByRole('button', { name: 'إغلاق السجل' }).count()) {
    await page.getByRole('button', { name: 'إغلاق السجل' }).click();
    await page.locator('.ledger-panel').waitFor({ state: 'detached' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileSidebarClose = page.locator('.sidebar-mobile-close');
  if (await mobileSidebarClose.isVisible()) {
    await page.evaluate(() =>
      (document.querySelector('.sidebar-mobile-close') as HTMLElement | null)?.click(),
    );
    await page.waitForTimeout(150);
  }

  for (const width of [320, 360, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const mobileLayout = await page.evaluate(() => {
      const toolbar = document.querySelector('.debts-toolbar');
      const total = document.querySelector('.debt-total-card');
      const add = document.querySelector('.add-customer-card');
      const route = document.querySelector('.routing-card');
      const grid = document.querySelector('.customer-card-grid');
      const search = document.querySelector('.dashboard-search');
      if (!toolbar || !total || !add || !grid || !search) return null;
      const columns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
      const toolbarStyle = getComputedStyle(toolbar);
      const totalRect = total.getBoundingClientRect();
      const addRect = add.getBoundingClientRect();
      const routeRect = route?.getBoundingClientRect();
      const searchStyle = getComputedStyle(search);
      return {
        columns,
        noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 2,
        totalIsRight: totalRect.left > addRect.left && (!routeRect || totalRect.left > routeRect.left),
        actionsAligned:
          !routeRect ||
          (Math.abs(addRect.top - routeRect.top) < 2 && Math.abs(addRect.height - routeRect.height) < 2),
        toolbarDisplay: toolbarStyle.display,
        glassSearch: searchStyle.backdropFilter.includes('blur'),
      };
    });
    assert.deepEqual(
      mobileLayout,
      {
        columns: 2,
        noOverflow: true,
        totalIsRight: true,
        actionsAligned: true,
        toolbarDisplay: 'grid',
        glassSearch: true,
      },
      `customer debts mobile layout must fit at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve('artifacts', 'ui', 'customer-debts-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.screenshot({ path: resolve('artifacts', 'ui', 'customer-debts-desktop.png'), fullPage: true });
  await page.locator('.customer-card-main').filter({ hasText: 'متجر النور' }).click();
  await page.getByLabel('تاريخ المعاملة').waitFor();

  const oldDebtDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.getByLabel('تاريخ المعاملة').fill(oldDebtDate);
  await page.getByLabel('قيمة المعاملة').fill('1250');
  await page.getByLabel('ملاحظة المعاملة').fill('فاتورة اختبار محلي');
  await page.getByRole('button', { name: 'اعتماد المعاملة' }).click();
  await page.locator('.ledger-record').filter({ hasText: 'فاتورة اختبار محلي' }).waitFor();

  await page.getByRole('group', { name: 'نوع المعاملة', exact: true }).getByRole('button', { name: 'دفع جزئي', exact: true }).click();
  await page.getByLabel('قيمة المعاملة').fill('250');
  await page.getByRole('button', { name: 'اعتماد المعاملة' }).click();
  await page.locator('.ledger-record').nth(1).waitFor();

  await page.reload();
  await page.getByRole('heading', { name: 'قسم ديون العملاء' }).waitFor();
  await page.getByTitle('حالة الاتصال والحفظ').waitFor();
  const globalSearch = page.getByLabel('البحث الموحد');
  await globalSearch.fill('متجر النور');
  await page.locator('.global-search-results').getByText('متجر النور', { exact: true }).waitFor();
  await globalSearch.fill('');
  await page.getByText('صافي إجمالي الديون', { exact: true }).waitFor();
  await page.locator('.customer-card.overdue-debt').filter({ hasText: 'متجر النور' }).waitFor();
  const tickerCustomer = page
    .locator('.debt-ticker button:not([aria-hidden="true"])')
    .filter({ hasText: 'متجر النور' });
  await tickerCustomer.waitFor();
  await tickerCustomer.evaluate((element: HTMLButtonElement) => element.click());
  await page.getByRole('heading', { name: 'متجر النور' }).waitFor();
  await page.locator('.ledger-panel.section-customers').waitFor({ state: 'visible' });
  await page.locator('.ledger-draft-row').getByLabel('ملاحظة المعاملة').fill('مسودة تستعاد تلقائيًا');
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'إغلاق السجل' }).click();
  await page.locator('.ledger-panel').waitFor({ state: 'detached' });
  await tickerCustomer.evaluate((element: HTMLButtonElement) => element.click());
  await page.waitForFunction(() => {
    const field = document.querySelector('.ledger-draft-row [aria-label="ملاحظة المعاملة"]') as HTMLInputElement | null;
    return field?.value === 'مسودة تستعاد تلقائيًا';
  });
  assert.equal(
    await page.locator('.ledger-draft-row').getByLabel('ملاحظة المعاملة').inputValue(),
    'مسودة تستعاد تلقائيًا',
  );
  page.once('dialog', dialog => void dialog.accept());
  await page.locator('.ledger-draft-row').getByRole('button', { name: 'إلغاء المسودة' }).click();
  await page.locator('.ledger-record').getByText('ديون', { exact: true }).first().waitFor();
  await page.locator('.ledger-record').getByText('دفع جزئي', { exact: true }).first().waitFor();
  assert.equal(await page.locator('.ledger-record.debt.posted').count(), 1);
  assert.equal(await page.locator('.ledger-record.payment.posted').count(), 1);
  assert.equal(await page.locator('.ledger-draft-row').count(), 1);
  assert.deepEqual(await page.locator('.ledger-record > [data-label="التسلسل"]').allTextContents(), [
    '#1',
    '#2',
  ]);
  assert.equal(
    await page
      .locator('.ledger-record')
      .last()
      .evaluate((element) => element.nextElementSibling?.classList.contains('ledger-draft-row')),
    true,
  );
  const footerBox = await page.locator('.ledger-panel').boundingBox();
  const totalCardBox = await page.locator('.ledger-total').boundingBox();
  assert.ok(footerBox && totalCardBox && totalCardBox.width > 0 &&
    totalCardBox.x >= footerBox.x - 1 && totalCardBox.x + totalCardBox.width <= footerBox.x + footerBox.width + 1,
    'approved total pill remains inside the ledger panel');
  const originalRowCount = await page.locator('.ledger-record').count();
  await page
    .locator('.ledger-record.debt.posted')
    .getByRole('button', { name: /تعديل المعاملة/ })
    .click();
  const editRow = page.locator('.ledger-draft-row').filter({ hasText: '#1' });
  await editRow.getByLabel('ملاحظة المعاملة').fill('فاتورة معدلة في مكانها');
  await editRow.getByRole('button', { name: 'اعتماد المعاملة' }).click();
  await page.locator('.ledger-record').filter({ hasText: 'فاتورة معدلة في مكانها' }).waitFor();
  assert.equal(await page.locator('.ledger-record').count(), originalRowCount);
  const rows = page.locator('[data-ledger-row]');
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await rows.nth(1).evaluate((element) => element === document.activeElement), true);
  await page.getByRole('button', { name: 'تعديل البيانات' }).click();
  await page.getByRole('dialog').getByLabel('رقم الهاتف').fill('0922222222');
  await page.getByRole('button', { name: 'حفظ البيانات' }).click();
  await page
    .locator('.ledger-total')
    .getByText(/1[.,]000/)
    .waitFor();
  const customerData = await page.evaluate(async () => await (await fetch('/api/customers')).json());
  assert.equal(customerData.data.items[0].balanceUnits, 1000);

  const output = resolve('artifacts', 'ui');
  mkdirSync(output, { recursive: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'customer-ledger-dark-desktop.png'), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'customer-ledger-desktop.png'), fullPage: true });
  await page.locator('.ledger-panel > header .icon-button').click();
  await page.locator('.ledger-panel').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /إضافة عميل/ }).click();
  const duplicateDialog = page.getByRole('dialog');
  await duplicateDialog.getByLabel('اسم العميل', { exact: true }).fill('متجر النور فرع جديد');
  await duplicateDialog.getByRole('region', { name: 'أسماء مشابهة' }).waitFor();
  assert.equal(await duplicateDialog.getByRole('button', { name: 'حفظ الحساب' }).isDisabled(), true);
  await duplicateDialog.getByRole('button', { name: /ليس الحساب المطلوب/ }).click();
  assert.equal(await duplicateDialog.getByRole('button', { name: 'حفظ الحساب' }).isEnabled(), true);
  page.once('dialog', dialog => void dialog.accept());
  await duplicateDialog.getByRole('button', { name: 'إلغاء' }).click();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'customers-dark-desktop.png'), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.screenshot({ path: join(output, 'customers-desktop.png'), fullPage: true });
  await page.locator('.customer-card-main').filter({ hasText: 'متجر النور' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'customer-ledger-dark-mobile.png'), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'customer-ledger-mobile.png'), fullPage: true });

  await page.locator('.ledger-panel > header .icon-button').click();
  await page.locator('.ledger-panel').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'صفحة المصراوية' }).click();
  await page.getByRole('heading', { name: 'صفحة المصراوية' }).waitFor();
  await page.locator('.masraweya-summary-sheet').waitFor();
  const legacyDayRoute = '**/api/masraweya/day*';
  await page.route(legacyDayRoute, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.data.editable;
    delete body.data.today;
    await route.fulfill({ response, json: body });
  });
  await page.getByRole('button', { name: 'اليوم الحالي', exact: true }).click();
  await page.getByText('نسخة الخادم تحتاج تحديثًا', { exact: true }).waitFor();
  assert.equal(await page.getByText('للقراءة فقط', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('مشتريات اليوم').isDisabled(), true);
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: 'اليوم الحالي', exact: true }).click();
  await page.getByText('يوم العمل الحالي', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /اعتماد اليوم|حفظ اليوم|ترحيل|إعادة فتح/ }).count(), 0);
  const masraweyaRows = page.locator('.masraweya-work-table tbody tr');
  const firstValue = masraweyaRows.nth(0).locator('input').nth(0);
  const firstCommission = masraweyaRows.nth(0).locator('input').nth(1);
  assert.deepEqual(await page.locator('.masraweya-work-table thead th').allTextContents(), [
    'التسلسل',
    'القيمة',
    'العمولة',
    'الناتج',
  ]);
  const masraweyaLayout = await page.evaluate(() => {
    const work = document.querySelector('.masraweya-layout .work-panel')?.getBoundingClientRect();
    const summary = document.querySelector('.masraweya-layout .summary-panel')?.getBoundingClientRect();
    const row = document.querySelector('.masraweya-work-table tbody td:first-child');
    if (!work || !summary || !row) return null;
    return {
      widthDifference: Math.abs(work.width - summary.width),
      topDifference: Math.abs(work.top - summary.top),
      workMinHeight: work.height,
      summaryMinHeight: summary.height,
      rowRadius: parseFloat(getComputedStyle(row).borderStartStartRadius),
    };
  });
  assert.ok(masraweyaLayout);
  assert.ok(masraweyaLayout.widthDifference < 2, 'both Masraweya tables must have equal desktop width');
  assert.ok(masraweyaLayout.topDifference < 2, 'both Masraweya tables must start on the same line');
  assert.ok(masraweyaLayout.workMinHeight >= 365 && masraweyaLayout.summaryMinHeight >= 365);
  assert.ok(
    Math.abs(masraweyaLayout.workMinHeight - masraweyaLayout.summaryMinHeight) < 2,
    'both Masraweya tables must start at the same desktop height',
  );
  assert.ok(masraweyaLayout.rowRadius >= 18, 'desktop work rows must have rounded edges');
  await firstValue.fill('1000');
  await firstValue.press('ArrowLeft');
  assert.equal(await firstCommission.evaluate((element) => element === document.activeElement), true);
  await firstCommission.press('ArrowRight');
  assert.equal(await firstValue.evaluate((element) => element === document.activeElement), true);
  await firstValue.press('ArrowLeft');
  await firstCommission.fill('100');
  await firstCommission.press('ArrowDown');
  assert.equal(
    await masraweyaRows
      .nth(1)
      .locator('input')
      .nth(1)
      .evaluate((element) => element === document.activeElement),
    true,
  );
  const originalMasraweyaRows = await masraweyaRows.count();
  await masraweyaRows.last().locator('input').nth(1).press('Enter');
  assert.equal(await masraweyaRows.count(), originalMasraweyaRows + 1);
  await page.waitForFunction(() => {
    const inputs = document.querySelectorAll('.masraweya-work-table tbody tr:last-child input');
    return inputs.item(1) === document.activeElement;
  });
  assert.equal(
    await masraweyaRows
      .last()
      .locator('input')
      .nth(1)
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.getByLabel('القيمة السابقة').fill('500');
  await page.getByLabel('مشتريات اليوم').fill('1000');
  await page.locator('.masraweya-summary-sheet .final-row td').getByText('400', { exact: true }).waitFor();
  await page.getByText('محفوظ تلقائيًا', { exact: true }).waitFor();
  await page.bringToFront();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'نسخ الصورة', exact: true }).click();
  await page.getByText('تم نسخ صورة الجدول بأعلى جودة.', { exact: true }).waitFor().catch(async error => {
    console.error('Capture state:', await page.locator('.masraweya-page').innerText());
    throw error;
  });
  await page.screenshot({ path: join(output, 'masraweya-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'المظهر الليلي' }).click();
  await page.locator('html[data-theme="dark"]').waitFor();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.masraweya-work-table tbody input')!).backgroundColor ===
      'rgb(17, 16, 13)',
  );
  assert.equal(
    await firstValue.evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgb(17, 16, 13)',
    'Masraweya entry fields must stay readable in dark mode',
  );
  await page.screenshot({ path: join(output, 'masraweya-desktop-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'المظهر النهاري' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('.sidebar.open').count()) {
    await page.getByRole('button', { name: 'إغلاق القائمة الرئيسية', exact: true }).click();
  }
  await page.waitForFunction(() => {
    const shell = document.querySelector('.app-shell');
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
    return shell && getComputedStyle(shell).paddingRight === '0px' && sidebar && sidebar.left >= innerWidth;
  });
  assert.equal(
    await page.evaluate(() => {
      const work = document.querySelector('.masraweya-layout .work-panel')?.getBoundingClientRect();
      const summary = document.querySelector('.masraweya-layout .summary-panel')?.getBoundingClientRect();
      const hint = document.querySelector('.masraweya-desktop-keyboard-hint');
      return Boolean(
        work && summary && summary.top < work.top && hint && getComputedStyle(hint).display === 'none',
      );
    }),
    true,
    'mobile Masraweya order and controls must remain unchanged',
  );
  await page.screenshot({ path: join(output, 'masraweya-mobile.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(output, 'masraweya-mobile-dark.png'), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.setViewportSize({ width: 1440, height: 950 });

  // Leaving immediately after typing must flush the draft before unmounting.
  await page.getByLabel('مشتريات اليوم').fill('1001');
  await page.getByRole('button', { name: 'قسم المشتريات' }).click();
  await page.getByRole('heading', { name: 'قسم المشتريات' }).waitFor();
  assert.equal(
    Number(
      database
        .prepare('SELECT purchases_units FROM masraweya_days ORDER BY business_date DESC LIMIT 1')
        .get()!.purchases_units,
    ),
    1001,
  );
  await page.getByRole('button', { name: 'صفحة المصراوية' }).click();
  await page.waitForFunction(
    () =>
      (document.querySelector('input[aria-label="مشتريات اليوم"]') as HTMLInputElement | null)?.value ===
      '1001',
  );
  const currentMasraweyaDate = await page.getByLabel('تاريخ العمل').inputValue();
  const oldMasraweyaDate = new Date(`${currentMasraweyaDate}T12:00:00Z`);
  oldMasraweyaDate.setUTCDate(oldMasraweyaDate.getUTCDate() - 8);
  await page.getByLabel('تاريخ العمل').fill(oldMasraweyaDate.toISOString().slice(0, 10));
  await page.getByText('للقراءة فقط', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('مشتريات اليوم').isDisabled(), true);
  await page.getByRole('button', { name: 'اليوم الحالي', exact: true }).click();
  await page.waitForFunction(
    () => !(document.querySelector('input[aria-label="مشتريات اليوم"]') as HTMLInputElement | null)?.disabled,
  );
  await page.getByLabel('مشتريات اليوم').fill('1000');
  await page.getByRole('button', { name: 'قسم المشتريات' }).click();
  await page.getByRole('heading', { name: 'قسم المشتريات' }).waitFor();
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    'rgb(229, 237, 246)',
    'the light workspace must use the approved blue-gray background',
  );
  assert.equal(
    await page.locator('.purchase-grid-head').evaluate((element) => getComputedStyle(element).position),
    'sticky',
    'the purchase register head must follow viewport scrolling',
  );
  for (const column of [3, 9]) {
    assert.equal(
      await page
        .locator(`.purchase-grid-head > span:nth-child(${column})`)
        .evaluate((element) => getComputedStyle(element).borderLeftWidth),
      '2px',
      `purchase header column ${column} must have a visible physical separator`,
    );
    assert.equal(
      await page
        .locator(`.purchase-inline-editor > span:nth-child(${column})`)
        .evaluate((element) => getComputedStyle(element).borderLeftWidth),
      '2px',
      `purchase editor column ${column} must have a visible physical separator`,
    );
  }
  await page.getByLabel('القيمة ج.م').fill('1000');
  await page.getByRole('button', { name: '×', exact: true }).click();
  await page.getByRole('button', { name: '÷', exact: true }).click();
  await page.getByLabel('سعر الصرف').fill('5.5');
  await page.getByLabel('المسدد').fill('50');
  await page.getByLabel('مستهلك فودافون').fill('200');
  await page.getByLabel('مستهلك فودافون').press('ArrowDown');
  await page.getByText('132 د.ل', { exact: true }).waitFor();
  await page.evaluate(() => {
    const register = document.querySelector('.purchase-register');
    const row = document.querySelector('.purchase-row');
    if (!register || !row) throw new Error('purchase register row is unavailable');
    for (let index = 0; index < 35; index += 1) {
      const clone = row.cloneNode(true) as HTMLElement;
      clone.classList.add('purchase-sticky-test-row');
      register.append(clone);
    }
    register.scrollTop = 750;
  });
  await page.waitForTimeout(100);
  const purchaseHeadTop = await page.locator('.purchase-grid-head').evaluate(element => element.getBoundingClientRect().top);
  const purchaseToolbarBottom = await page.locator('.dashboard-utility-bar').evaluate(element => element.getBoundingClientRect().bottom);
  assert.ok(purchaseHeadTop >= purchaseToolbarBottom, 'the purchase header must not cover the section toolbar');
  await page.evaluate(() => {
    document.querySelectorAll('.purchase-sticky-test-row').forEach((element) => element.remove());
    document.querySelector('.purchase-register')!.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: join(output, 'purchases-desktop.png'), fullPage: true });
  await page.getByLabel('القيمة ج.م').fill('999');
  internetAvailable = false;
  await page.waitForFunction(() => Boolean(document.querySelector('.connection-notice')), undefined, {
    timeout: 80_000,
  });
  assert.equal(
    await page.locator('#root h1').filter({ hasText: 'قسم المشتريات' }).count(),
    1,
    'the mounted page must remain visible during an outage',
  );
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).visibility), 'hidden');
  internetAvailable = true;
  await page.waitForFunction(() => !document.querySelector('.connection-notice'), undefined, {
    timeout: 30_000,
  });
  assert.equal(
    await page.getByLabel('القيمة ج.م').inputValue(),
    '999',
    'an unsaved draft must survive a transient outage',
  );
  await page.getByRole('button', { name: 'إضافة معاملة' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'purchases-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 950 });
  // The outage-survival draft is deliberately left without submitting it.
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'أمانات مصرية' }).click();
  await page.getByRole('heading', { name: 'أمانات مصرية' }).waitFor();
  await page.getByText('قسم المصراوية', { exact: true }).waitFor();
  await page.getByText('فودافون قسم المشتريات', { exact: true }).waitFor();
  const linkedVodafoneCard = page.locator('.customer-card').filter({ hasText: 'فودافون قسم المشتريات' });
  await linkedVodafoneCard.getByText('مرتبط تلقائيًا', { exact: true }).waitFor();
  assert.equal(await linkedVodafoneCard.locator('.pin-customer').count(), 0);
  await linkedVodafoneCard.locator('.customer-card-main').click();
  await page.getByText('رصيد مرتبط تلقائيًا بالقسم المصدر', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /اعتماد المعاملة/ }).count(), 0);
  await page.screenshot({ path: join(output, 'egyptian-linked-account-desktop.png'), fullPage: true });
  await page.locator('.ledger-panel > header .icon-button').click();
  await page.locator('.ledger-panel').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'قسم ديون الشركات' }).click();
  await page.getByRole('heading', { name: 'قسم ديون الشركات' }).waitFor();
  await page.getByRole('button', { name: 'أمانات ليبية' }).click();
  await page.getByRole('heading', { name: 'أمانات ليبية' }).waitFor();
  await page.getByRole('button', { name: 'قسم استلامات الديون' }).click();
  await page.getByRole('heading', { name: 'قسم استلامات الديون' }).waitFor();
  await page.getByRole('button', { name: 'الخزينة' }).click();
  await page.getByRole('heading', { name: 'سجل الفلوس النشطة', exact: true }).waitFor();
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await page.locator('.treasury-entry-form').getByLabel('القيمة').fill('250');
  await page.locator('.treasury-entry-form').getByLabel('البيان').fill('اختبار واجهة الهاتف');
  await page.locator('.treasury-entry-form').getByRole('button', { name: 'اعتماد', exact: true }).click();
  await page.locator('.treasury-ledger-row.in').filter({ hasText: 'اختبار واجهة الهاتف' }).waitFor();
  await page.getByRole('button', { name: 'الإعدادات' }).click();
  await page.getByRole('heading', { name: 'الإعدادات' }).waitFor();
  await page.getByRole('button', { name: /إعدادات المنظومة/ }).click();
  await page.getByLabel('اسم المنظومة').fill('منظومة اختبار الإصلاحات');
  await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
  await page.locator('.identity-app strong').getByText('منظومة اختبار الإصلاحات', { exact: true }).waitFor();
  await page.locator('.system-settings-form').getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.getByRole('button', { name: /الموظفون والإداريون/ }).click();
  await page.getByRole('heading', { name: 'الموظفون والإداريون' }).waitFor();
  assert.equal(
    await page.getByRole('dialog').count(),
    0,
    'account management must use the full settings page',
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'users-dark-desktop.png'), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.getByRole('button', { name: /موظف جديد/ }).click();
  await page.getByLabel('الاسم الظاهر').fill('موظف القراءة');
  await page.getByLabel('اسم المستخدم').fill('reader');
  await page.getByLabel('كلمة المرور').fill('Reader Pass 123!');
  await page.locator('select[name="customerDebtsAccess"]').selectOption('manage');
  await page.locator('select[name="companyDebtsAccess"]').selectOption('manage');
  await page.locator('select[name="collectionsAccess"]').selectOption('manage');
  await page.locator('select[name="masraweyaAccess"]').selectOption('manage');
  await page.getByRole('button', { name: 'حفظ الموظف' }).click();
  await page.getByText('موظف القراءة', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const accountsOverflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => ({
        name: `${element.tagName.toLowerCase()}.${element.className}`,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      }))
      .filter((item) => item.left < -2 || item.right > window.innerWidth + 2)
      .slice(0, 12),
  }));
  assert.equal(
    accountsOverflow.documentWidth <= accountsOverflow.viewport + 2,
    true,
    JSON.stringify(accountsOverflow),
  );
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'العودة إلى الإعدادات' }).click();

  await page.getByRole('button', { name: /مركز التشغيل والأمان/ }).click();
  await page.getByRole('heading', { name: 'مركز التشغيل والأمان' }).waitFor();
  await page.getByText('حالة قاعدة البيانات', { exact: true }).waitFor();
  await page.getByText('إصدار قاعدة البيانات', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'operations must use the full settings page');
  await page.getByRole('button', { name: /الجلسات/ }).click();
  await page.getByText('الجلسات والأجهزة', { exact: true }).waitFor();
  await page.getByText('عنوان الاتصال', { exact: true }).first().waitFor();
  await page.getByText('آخر نشاط', { exact: true }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'العودة إلى الإعدادات' }).click();

  await page.getByRole('button', { name: /النسخ الاحتياطي والاستعادة/ }).click();
  await page.getByRole('heading', { name: 'النسخ الاحتياطي والاستعادة' }).waitFor();
  await page.locator('summary').filter({ hasText: 'محتويات النسخة وخطوات الاستعادة' }).click();
  await page.getByText('محتويات النسخة الكاملة', { exact: true }).waitFor();
  await page.getByText('مسار الاستعادة الآمن', { exact: true }).waitFor();
  await page.getByText('غير متحقق', { exact: true }).waitFor();
  await page.getByText('لا توجد نتيجة موثقة هنا', { exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      if (width === 390) {
        await page.waitForFunction(() => {
          const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
          const shell = document.querySelector('.app-shell');
          return (
            sidebar && sidebar.left >= innerWidth && shell && getComputedStyle(shell).paddingRight === '0px'
          );
        });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
      await page.screenshot({
        path: join(output, `fixed-backup-${theme}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.setViewportSize({ width: 1440, height: 950 });
  assert.equal(
    await page.getByRole('dialog').count(),
    0,
    'backup management must use the full settings page',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'العودة إلى الإعدادات' }).click();

  await page.getByRole('button', { name: /سجل التدقيق/ }).click();
  await page.getByRole('heading', { name: 'سجل التدقيق' }).waitFor();
  await page.getByText('سجل محمي للقراءة فقط', { exact: true }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(output, 'audit-log-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'audit-log-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.getByRole('button', { name: /سجل الأستاذ المالي/ }).click();
  await page.getByRole('heading', { name: 'سجل الأستاذ المالي' }).waitFor();
  await page.getByText('لا يغيّر الأرصدة ولا يكرر تأثير المعاملات', { exact: true }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(output, 'financial-ledger-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'financial-ledger-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'إغلاق' }).click();
  await page.getByRole('button', { name: 'التقارير الذكية' }).click();
  await page.getByRole('button', { name: 'مقارنة بالتقرير السابق', exact: true }).click();
  await page.getByRole('heading', { name: 'التقارير الذكية' }).waitFor();
  await page.getByText('سجل يومي تلقائي من إجماليات الخزينة', { exact: true }).waitFor();
  await page
    .getByText('التغير المعروض هو تغير المركز المالي وليس ربحًا محاسبيًا معتمدًا.', { exact: true })
    .waitFor();
  await page.getByRole('columnheader', { name: 'التسلسل' }).waitFor();
  await page.getByRole('columnheader', { name: 'الفرق عن اليوم السابق' }).waitFor();
  assert.equal(await page.locator('.reports-table tbody tr').count(), 1);
  assert.equal(
    await page.locator('.reports-page input,.reports-page textarea,.reports-page select').count(),
    0,
  );
  await page.screenshot({ path: join(output, 'reports-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= window.innerWidth && box.width >= 34 && box.height >= 32;
    }),
    true,
    'mobile menu must be visible and fully inside the viewport',
  );
  assert.equal(
    await page
      .locator('.sidebar')
      .evaluate((element) => element.getBoundingClientRect().left >= window.innerWidth),
    true,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  assert.equal(
    await page
      .locator('.reports-table-wrap')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 2),
    true,
    'mobile reports must not require horizontal scrolling',
  );
  assert.equal(
    await page.locator('.reports-table thead').evaluate((element) => getComputedStyle(element).display),
    'none',
  );
  await page.screenshot({ path: join(output, 'reports-mobile.png') });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= window.innerWidth;
    }),
    true,
    'landscape phone menu must remain reachable',
  );
  assert.equal(
    await page.locator('.reports-table thead').evaluate((element) => getComputedStyle(element).display),
    'none',
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  await page.screenshot({ path: join(output, 'reports-mobile-landscape.png') });
  await page.setViewportSize({ width: 390, height: 844 });

  const mobileSections = [
    ['الخزينة', 'الخزينة', 'treasury'],
    ['قسم المشتريات', 'قسم المشتريات', 'purchases'],
    ['صفحة المصراوية', 'صفحة المصراوية', 'masraweya'],
    ['الإعدادات', 'الإعدادات', 'settings'],
    ['قسم استلامات الديون', 'قسم استلامات الديون', 'collections'],
    ['أمانات مصرية', 'أمانات مصرية', 'egyptian-deposits'],
    ['أمانات ليبية', 'أمانات ليبية', 'libyan-deposits'],
    ['قسم ديون الشركات', 'قسم ديون الشركات', 'companies'],
    ['قسم ديون العملاء', 'قسم ديون العملاء', 'customers'],
    ['التقارير الذكية', 'موقفك المالي، بوضوح', 'reports-after-navigation'],
  ] as const;
  for (const [navigationLabel, headingLabel, screenshotName] of mobileSections) {
    await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).click();
    await page.locator('.sidebar.open').waitFor();
    await page.locator('.sidebar').getByRole('button', { name: navigationLabel, exact: true }).click();
    await page.getByRole('heading', { name: headingLabel, exact: true }).first().waitFor();
    await page.waitForFunction(() => {
      const sidebar = document.querySelector<HTMLElement>('.sidebar');
      return (
        sidebar !== null &&
        !sidebar.classList.contains('open') &&
        sidebar.getBoundingClientRect().left >= window.innerWidth
      );
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
      true,
      `${navigationLabel} must fit the mobile viewport`,
    );
    const escapedElements = await page.locator('.workspace').evaluate((workspace) =>
      [...workspace.querySelectorAll<HTMLElement>('*')]
        .filter((element) => {
          const style = getComputedStyle(element);
          if (element.closest('.debt-ticker')) return false;
          // Purchase register intentionally keeps the desktop table on phones;
          // its inner viewport scrolls horizontally instead of clipping columns.
          if (element.closest('.purchase-register')) return false;
          if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed')
            return false;
          const box = element.getBoundingClientRect();
          return box.width > 1 && (box.left < -2 || box.right > window.innerWidth + 2);
        })
        .slice(0, 8)
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
    );
    assert.deepEqual(escapedElements, [], `${navigationLabel} has clipped mobile content`);
    if (screenshotName === 'purchases') {
      assert.equal(
        await page
          .locator('.purchase-register')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        true,
      );
      assert.equal(
        await page
          .locator('.purchase-register .purchase-grid-head')
          .evaluate((element) => getComputedStyle(element).display),
        'grid',
      );
    }
    if (screenshotName === 'treasury') {
      assert.equal(
        await page
          .locator('.treasury-ledger-row.in')
          .evaluate((element) => getComputedStyle(element).display),
        'grid',
      );
    }
    await page.screenshot({ path: join(output, `${screenshotName}-mobile.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await page.getByLabel('البريد الإلكتروني').fill('reader');
  await page.getByLabel('كلمة المرور').fill('Reader Pass 123!');
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('heading', { name: 'غيّر كلمة المرور المؤقتة' }).waitFor();
  await page.getByLabel('كلمة المرور المؤقتة').fill('Reader Pass 123!');
  await page.getByLabel('كلمة المرور الجديدة', { exact: true }).fill('Reader Personal 456!');
  await page.getByLabel('تأكيد كلمة المرور الجديدة').fill('Reader Personal 456!');
  await page.getByRole('button', { name: 'حفظ ودخول المنظومة' }).click();
  await page.getByRole('heading', { name: 'قسم استلامات الديون', exact: true }).waitFor();
  await page.locator('.identity-app strong').getByText('منظومة اختبار الإصلاحات', { exact: true }).waitFor();
  const branding = await context.request.get(`${base}/api/organization-branding`);
  assert.equal(branding.status(), 200);
  assert.deepEqual((await branding.json()).data, { systemName: 'منظومة اختبار الإصلاحات' });
  assert.equal((await context.request.get(`${base}/api/organization-settings`)).status(), 403);
  await verifySidebar('employee');
  await page.getByRole('button', { name: 'صفحة المصراوية' }).click();
  await page.locator('.masraweya-summary-sheet').waitFor();
  assert.equal(await page.getByLabel('مشتريات اليوم').isEnabled(), true);
  assert.equal(await page.getByLabel('القيمة السابقة').getAttribute('readonly'), null);
  const employeeToday = await page.getByLabel('تاريخ العمل').inputValue();
  const employeeYesterday = new Date(`${employeeToday}T12:00:00Z`);
  employeeYesterday.setUTCDate(employeeYesterday.getUTCDate() - 1);
  await page.getByLabel('تاريخ العمل').fill(employeeYesterday.toISOString().slice(0, 10));
  await page.getByText('تعديل يوم سابق', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('مشتريات اليوم').isEnabled(), true);
  await page.getByLabel('مشتريات اليوم').fill('10');
  await page.getByRole('button', { name: 'اليوم الحالي', exact: true }).click();
  assert.equal(
    database
      .prepare('SELECT purchases_units FROM masraweya_days WHERE business_date=?')
      .get(employeeYesterday.toISOString().slice(0, 10))!.purchases_units,
    10,
  );
  await page.waitForFunction(
    () =>
      (document.querySelector('input[aria-label="مشتريات اليوم"]') as HTMLInputElement | null)?.disabled ===
      false,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
    await page.waitForTimeout(300);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
      await page.screenshot({
        path: join(output, `masraweya-employee-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  await page.getByRole('heading', { name: 'قسم استلامات الديون', exact: true }).waitFor();
  await verifyCollectionsPhone('employee');
  await page.getByRole('button', { name: 'إنشاء عميل مستقل', exact: true }).click();
  await page.getByLabel('اسم العميل', { exact: true }).fill('عميل مستقل تجريبي');
  await page.getByLabel('القيمة المستلمة').fill('250');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  await page.screenshot({ path: join(output, 'employee-independent-customer-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'تسجيل كارت معلّق' }).click();
  await page.getByText('عميل مستقل تجريبي', { exact: true }).waitFor();
  for (const [sectionName, screenshotName] of [
    ['قسم ديون الشركات', 'employee-companies-toolbar-mobile.png'],
    ['قسم ديون العملاء', 'employee-customers-toolbar-mobile.png'],
  ] as const) {
    await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).click();
    await page.locator('.sidebar').getByRole('button', { name: sectionName, exact: true }).click();
    await page.getByRole('heading', { name: sectionName, exact: true }).waitFor();
    await page.waitForFunction(() => {
      const sidebar = document.querySelector<HTMLElement>('.sidebar');
      return (
        sidebar !== null &&
        !sidebar.classList.contains('open') &&
        sidebar.getBoundingClientRect().left >= window.innerWidth
      );
    });
    const activeCard = page.locator('.active-cards-card');
    assert.equal(
      await activeCard.evaluate((card) => {
        const bounds = card.getBoundingClientRect();
        return [...card.querySelectorAll('button')].every((button) => {
          const buttonBounds = button.getBoundingClientRect();
          return buttonBounds.left >= bounds.left - 1 && buttonBounds.right <= bounds.right + 1;
        });
      }),
      true,
      `${sectionName} filters must stay inside the activity card`,
    );
    assert.equal(
      await activeCard.evaluate(card => {
        const bounds = card.getBoundingClientRect();
        // The compact phone toolbar intentionally replaced the old 84px card.
        return bounds.height >= 58 && [...card.querySelectorAll('button')].every(button => {
          const rect = button.getBoundingClientRect();
          return rect.height >= 27 && button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1;
        });
      }),
      true,
      `${sectionName} activity card must remain readable`,
    );
    await page.screenshot({ path: join(output, screenshotName), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'قسم ديون العملاء', exact: true }).click();
  await page.getByRole('heading', { name: 'قسم ديون العملاء' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /إضافة عميل/ }).count(), 1);
  await page.locator('.customer-card-main').filter({ hasText: 'متجر النور' }).click();
  await page.getByRole('heading', { name: 'متجر النور' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /اعتماد المعاملة/ }).count(), 1);
  await page.locator('.ledger-panel > header .icon-button').click();
  await page.locator('.ledger-panel').waitFor({ state: 'detached' });
  internetAvailable = false;
  await page.waitForFunction(() => Boolean(document.querySelector('.connection-notice')), undefined, {
    timeout: 80_000,
  });
  assert.equal(await page.locator('#root h1').filter({ hasText: 'قسم ديون العملاء' }).count(), 1);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).visibility), 'hidden');
  internetAvailable = true;
  await page.waitForFunction(() => !document.querySelector('.connection-notice'), undefined, {
    timeout: 30_000,
  });
  await page.getByRole('heading', { name: 'قسم ديون العملاء' }).waitFor({ timeout: 7_000 });
  await page.locator('.customer-card-main').filter({ hasText: 'متجر النور' }).click();
  await page.getByRole('group', { name: 'نوع المعاملة', exact: true }).getByRole('button', { name: 'دفع جزئي', exact: true }).click();
  await page.getByLabel('قيمة المعاملة').fill('1');
  await page.getByLabel('ملاحظة المعاملة').fill('حركة إشعار موظف');
  await page.getByRole('button', { name: 'اعتماد المعاملة' }).click();
  await page.locator('.ledger-record').filter({ hasText: 'حركة إشعار موظف' }).waitFor();
  await page.getByText('بواسطة موظف القراءة', { exact: true }).first().waitFor();
  await page.locator('.ledger-panel > header .icon-button').click();
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await page.getByLabel('البريد الإلكتروني').fill('admin');
  await page.getByLabel('كلمة المرور').fill('Local Admin 123!');
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.locator('.app-shell').waitFor();
  await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  await page.getByRole('heading', { name: 'قسم استلامات الديون', exact: true }).waitFor();
  const independentAdminCard = page.locator('.unlinked-admin-card').filter({ hasText: 'عميل مستقل تجريبي' });
  await independentAdminCard.waitFor();
  assert.equal(await independentAdminCard.getByRole('button', { name: 'عميل قديم', exact: true }).count(), 1);
  assert.equal(await independentAdminCard.getByRole('button', { name: 'عميل جديد', exact: true }).count(), 1);
  await verifyCollectionsPhone('admin');
  await independentAdminCard.getByRole('button', { name: 'عميل جديد', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByRole('dialog').getByText('قسم ديون العملاء', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('dialog').getByText('قسم ديون الشركات', { exact: true }).count(), 1);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    true,
  );
  await page.screenshot({ path: join(output, 'admin-independent-customer-mobile.png'), fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'الإشعارات' }).click();
  const detailedNotice = page.getByText(
    'الموظف موظف القراءة سجّل تسديدًا جزئيًا بقيمة 1 د.ل للعميل متجر النور.',
    { exact: true },
  );
  await detailedNotice.waitFor();
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/notifications/') && response.url().endsWith('/read'),
    ),
    detailedNotice.click(),
  ]);
  await page.getByRole('button', { name: 'الإشعارات' }).click();
  assert.equal(await page.getByText(/الموظف موظف القراءة سجّل تسديدًا جزئيًا/).count(), 0);

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ar-LY',
    hasTouch: true,
    isMobile: true,
  });
  try {
    const touchPage = await touchContext.newPage();
    await touchPage.goto(base);
    await touchPage.getByLabel('البريد الإلكتروني').fill('admin');
    await touchPage.getByLabel('كلمة المرور').fill('Local Admin 123!');
    await touchPage.getByRole('button', { name: 'تسجيل الدخول' }).click();
    await touchPage.getByRole('heading', { name: 'قسم ديون العملاء' }).waitFor();
    await touchPage.getByRole('button', { name: 'فتح القائمة الرئيسية' }).click();
    await touchPage.locator('.sidebar').getByRole('button', { name: 'قسم المشتريات', exact: true }).click();
    await touchPage.getByRole('heading', { name: 'قسم المشتريات', exact: true }).waitFor();
    await touchPage.evaluate(() => window.scrollTo(0, 0));
    const touchScrollMode = await touchPage.evaluate(() => {
      const register = document.querySelector('.purchase-register');
      return {
        page: (document.scrollingElement?.scrollHeight ?? 0) > window.innerHeight + 100,
        register: Boolean(register && register.scrollWidth > register.clientWidth + 20),
      };
    });
    assert.equal(
      touchScrollMode.page || touchScrollMode.register,
      true,
      'touch test must expose a scrollable page or register',
    );
    const touchSession = await touchContext.newCDPSession(touchPage);
    await touchSession.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        {
          x: touchScrollMode.page ? 190 : 340,
          y: touchScrollMode.page ? 650 : 300,
          radiusX: 6,
          radiusY: 6,
          force: 1,
        },
      ],
    });
    for (const step of touchScrollMode.page
      ? [590, 520, 450, 380, 310, 240, 170]
      : [320, 280, 240, 200, 160, 120, 80]) {
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: touchScrollMode.page ? 190 : step,
            y: touchScrollMode.page ? step : 300,
            radiusX: 6,
            radiusY: 6,
            force: 1,
          },
        ],
      });
    }
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touchPage.waitForTimeout(350);
    if (touchScrollMode.page) {
      assert.equal(
        await touchPage.evaluate(() => (document.scrollingElement?.scrollTop ?? window.scrollY) > 40),
        true,
        'one-finger touch gesture must scroll the mobile interface',
      );
    } else {
      assert.equal(
        await touchPage.evaluate(() => {
          const register = document.querySelector('.purchase-register');
          return Boolean(register && register.scrollWidth > register.clientWidth + 20);
        }),
        true,
        'purchase register must expose horizontal touch scrolling',
      );
    }
  } finally {
    await touchContext.close();
  }
  console.log(`UI smoke passed: ERP customer accounts and permissions. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  database.close();
  rmSync(temporary, { recursive: true, force: true });
}
