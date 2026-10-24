import { expect, test } from '@playwright/test';

test('demo → edit settings → compare → export', async ({ page }) => {
  const pageErrors:string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Energy dispatch studio' })).toBeVisible();
  await expect(page.getByText('SYNTHETIC', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Scenario settings' }).first().click();
  const capacity = page.getByLabel('Energy capacity');
  await capacity.fill('10');
  await page.getByRole('button', { name: 'Overview', exact: true }).first().click();
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/run') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  const result = await (await responsePromise).json();
  await expect(page.getByText('Independent physics check passed')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.optimal-card')).toContainText('VERIFIED OPTIMUM');
  await page.getByRole('slider', { name: 'Inspect dispatch interval' }).fill('12');
  await expect(page.locator('.dispatch-workbench')).toContainText('Interval 13 of 24');
  const format = (value:number) => new Intl.NumberFormat('en-US', { maximumFractionDigits:1 }).format(value);
  const battery = (strategy:'optimized'|'ruleBased') => {
    const interval = result.strategies[strategy].intervals[12];
    const value = interval.dischargeKW - interval.chargeKW;
    return `${value >= 0 ? '+' : ''}${format(value)}`;
  };
  await expect(page.locator('.dispatch-node.battery strong')).toHaveText(battery('optimized'));
  await expect(page.locator('.chart-panel').first()).toContainText('Verified optimal schedule');
  await page.getByRole('button', { name: 'Rule-based', exact: true }).click();
  await expect(page.locator('.dispatch-node.battery strong')).toHaveText(battery('ruleBased'));
  await expect(page.locator('.chart-panel').first()).toContainText('Rule-based schedule');
  await expect(page.locator('.strategy-switch [aria-pressed="true"]')).toHaveText('Rule-based');
  const profile = page.locator('.chart-panel').first().locator('svg');
  const marker = profile.locator('.selected-interval-line');
  const oldX = await marker.getAttribute('x1');
  const bounds = (await profile.boundingBox())!;
  await profile.click({ position: { x: bounds.width * 0.7, y: bounds.height / 2 } });
  expect(Number(await page.getByRole('slider', { name: 'Inspect dispatch interval' }).inputValue())).toBeGreaterThan(12);
  await expect(marker).not.toHaveAttribute('x1', oldX!);
  await expect(page.locator('.selected-interval-line')).toHaveCount(2);
  await page.getByRole('button', { name: 'Compare capacities' }).click();
  await expect(page.locator('.sensitivity [role="status"]')).toHaveText(/MILP costs appear only/);
  await expect(page.getByText('$', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshot.png', fullPage: true });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export results' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('gridopt-scenario.json');
  expect(pageErrors).toEqual([]);
});

test('mobile layout and keyboard can run the comparison', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const run = page.getByRole('button', { name: 'Run comparison' });
  await run.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Independent physics check passed')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.optimal-card')).toBeVisible();
  await expect(page.locator('.accounting tbody tr').first().locator('td[data-label="Ending SOC"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 720, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 720)).toBe(true);
});

test('CSV rejects blank numbers without replacing the active scenario', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scenario settings' }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'blank.csv', mimeType: 'text/csv', buffer: Buffer.from('timestamp,load_kw,solar_kw,wind_kw,price_per_kwh\n2025-06-21T00:00:00Z,,1,0,0.2') });
  await expect(page.getByRole('alert')).toContainText('invalid numeric value');
  await expect(page.getByText('Illustrative summer microgrid · synthetic')).toBeVisible();
});

test('zero-load data shows an honest renewable-share value', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scenario settings' }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'zero.csv', mimeType: 'text/csv', buffer: Buffer.from('timestamp,load_kw,solar_kw,wind_kw,price_per_kwh\n2025-06-21T00:00:00Z,0,0,0,0.2') });
  await page.getByRole('button', { name: 'Overview', exact: true }).first().click();
  await expect(page.locator('.metric').filter({ hasText: 'Renewable share' })).toContainText('N/A');
  await expect(page.locator('.metric').filter({ hasText: 'Renewable share' })).not.toContainText('NaN');
});
