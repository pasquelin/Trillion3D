import assert from 'node:assert/strict';
import test from 'node:test';
import type { Browser } from 'playwright';
import { launchChrome } from '../bench/runner/chrome.ts';
import { startDocsServer } from './docs-serve.ts';
import { readyEntries } from '../site/app/examples/list.ts';
import { layoutFaults, ROUTES } from './docs/layout-faults.ts';
import { LANGUAGES } from '../site/content/i18n/dictionary.ts';

const [example] = readyEntries;
const { server, port } = await startDocsServer();
const browser: Browser = await launchChrome({ headless: true });
test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

/** A page of the portal, with every error it raises or logs collected. */
async function open(hash: string, width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/${hash}`);
  return { page, errors };
}

test('the site search finds a page as the reader types and opens it', async () => {
  const { page, errors } = await open('#/fr/learn/home');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.keyboard.press('/');
  const input = page.getByRole('combobox', { name: 'Rechercher' });
  await input.fill(example.title.fr);
  await page.getByRole('option').first().waitFor();
  await page.keyboard.press('Enter');
  await page.waitForURL(`**/#/fr/examples/${example.id}`);
  assert.equal(await input.isVisible(), false, 'the search closes on the page it opened');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await input.fill('createWorld');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page
    .getByRole('option', { name: /createWorld/ })
    .first()
    .click();
  await page.waitForURL('**/#/fr/api/createWorld');
  await page.getByRole('heading', { level: 1, name: /createWorld/ }).waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('the demo page runs the example; its actions show its code, share it and drive it', async () => {
  const { page, errors } = await open(`#/en/examples/${example.id}`);
  const frame = page.locator('[data-demo] iframe');
  await page.locator('[data-demo] .render-frame [role="status"]').waitFor({ state: 'detached' });
  const action = async (name: string) => {
    await page.getByRole('button', { name: 'Demo actions' }).focus();
    await page.getByRole('button', { name, exact: true }).click();
  };
  // Controls: the example's window receives the one message of the contract.
  const inside = await (await frame.elementHandle())!.contentFrame();
  await inside!.evaluate(() => {
    addEventListener('message', (event) => ((window as { got?: unknown }).got = event.data));
  });
  await action('Controls');
  await inside!.waitForFunction(() => (window as { got?: unknown }).got);
  assert.deepEqual(await inside!.evaluate(() => (window as { got?: unknown }).got), {
    type: 'wg:controls',
    visible: false,
  });
  await action('Share');
  await page.getByRole('status').getByText('Link copied').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), page.url());
  // Code: the file's source, highlighted, in a modal; Copy gives the file as it is.
  await action('Code');
  const modal = page.getByRole('dialog', { name: example.file });
  await modal.getByText('<canvas id="view"></canvas>').waitFor();
  await modal.getByRole('button', { name: 'Copy code' }).click();
  const source = await page.evaluate((file) => fetch(file).then((r) => r.text()), example.file);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
  await modal.getByRole('button', { name: 'Close' }).first().click();
  await modal.waitFor({ state: 'hidden' });
  // Restart: the frame loads the file again.
  await action('Restart');
  await page.locator('[data-demo] .render-frame [role="status"]').waitFor({ state: 'detached' });
  assert.equal(await frame.getAttribute('src'), example.file);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('moving from one example to the next keeps the sidebar where it was, with no spinner', async () => {
  const [from, to] = readyEntries.slice(-2);
  const { page, errors } = await open(`#/en/examples/${from.id}`, 1440);
  const sidebar = page.locator('#sidebar');
  await sidebar.locator('li a[aria-current="page"]').waitFor();
  await page.waitForTimeout(800);
  const before = await sidebar.evaluate((element) => element.scrollTop);
  assert.ok(before > 0, 'the current example is scrolled into the sidebar');
  // The route's content suspends in `main`: a spinner there, even for a frame, is a flash.
  await page.evaluate(() => {
    const main = document.getElementById('main-content')!;
    new MutationObserver(() => {
      if (main.querySelector(':scope > .loading')) document.body.dataset.spun = 'yes';
    }).observe(main, { childList: true, subtree: true });
  });
  await sidebar.locator(`a[href="#/en/examples/${to.id}"]`).click();
  await page.waitForURL(`**/#/en/examples/${to.id}`);
  await sidebar.locator(`a[href="#/en/examples/${to.id}"][aria-current="page"]`).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await sidebar.evaluate((element) => element.scrollTop), before);
  assert.equal(await page.evaluate(() => document.body.dataset.spun), undefined);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('the layout holds on every page type, at every width, in every language', async () => {
  const faults: string[] = [];
  for (const { code: locale } of LANGUAGES)
    for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      // One page for every route: each goes to the next by its hash, as a reader does, so a fault
      // of one page's unmounting shows too.
      page.on('pageerror', (error) => faults.push(`${page.url()} at ${width}: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') faults.push(`${page.url()} at ${width}: ${message.text()}`);
      });
      for (const route of ROUTES) {
        const hash = `#/${locale}/${route}`;
        await page.goto(`http://127.0.0.1:${port}/${hash}`);
        await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'attached' });
        await page.waitForTimeout(500);
        for (const fault of await layoutFaults(page)) faults.push(`${hash} at ${width}: ${fault}`);
      }
      await context.close();
    }
  assert.deepEqual(faults, []);
});

test('the header marks the current area, and a long sidebar label ends on an ellipsis', async () => {
  const { page } = await open('#/fr/learn/create-a-world', 1440);
  const current = page.locator('header nav a[aria-current="page"]');
  assert.equal(await current.count(), 1);
  assert.equal(await current.getAttribute('data-nav'), 'learn');
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('#sidebar a[title] > span')]
      .filter((span) => span.scrollWidth > span.clientWidth)
      .map((span) => ({
        overflow: getComputedStyle(span).textOverflow,
        whole: span.parentElement!.title === span.textContent,
      })),
  );
  assert.ok(cut.length > 0, 'a French guide title is longer than the sidebar');
  assert.ok(cut.every(({ overflow, whole }) => overflow === 'ellipsis' && whole));
  await page.context().close();
});
