import { expect, test } from '@playwright/test';

test('demo → edit settings → compare → export', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Microgrid overview' })).toBeVisible();
  await expect(page.getByText('SYNTHETIC', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Scenario settings' }).first().click();
  const capacity = page.getByLabel('Energy capacity');
  await capacity.fill('10');
  await page.getByRole('button', { name: 'Overview', exact: true }).first().click();
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByText('Independent physics check passed')).toBeVisible();
  await expect(page.getByText('$', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshot.png', fullPage: true });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export results' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('gridopt-scenario.json');
});

test('mobile layout and keyboard can run the comparison', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const run = page.getByRole('button', { name: 'Run comparison' });
  await run.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Independent physics check passed')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
