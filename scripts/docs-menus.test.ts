import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import { rawEntries } from '../site/app/portal/data.ts';
import { localizeEntries } from '../site/content/i18n/index.ts';
import { apiIndex, apiMenu } from '../site/app/layout/menus.ts';
import type { SidebarMenu as SidebarMenuComponent } from '../site/app/layout/SidebarMenu.tsx';

test('the API index documents each symbol with its own sentence, and lists no guide', () => {
  for (const locale of ['en', 'fr'] as const) {
    const items = apiIndex(localizeEntries(rawEntries, locale), {
      locale,
      area: 'api',
      id: '',
    }).flatMap((group) => group.items);
    const summaries = items.map(({ summary }) => summary);
    assert.equal(new Set(summaries).size, summaries.length, `${locale}: a summary is shared`);
    for (const { label } of items) assert.doesNotMatch(label, /\w \w/, `${locale}: ${label}`);
  }
});

test('a sidebar is an accordion that opens on the group holding the current page', async () => {
  const { SidebarMenu } = (await loadReactComponents('site/app/layout/SidebarMenu.tsx')) as {
    SidebarMenu: typeof SidebarMenuComponent;
  };
  const entries = localizeEntries(rawEntries, 'en');
  const groups = apiMenu(entries, { locale: 'en', area: 'api', id: 'multiplyMatrix4' });
  const holding = groups.findIndex((group) => group.items.some((item) => item.active));
  assert.ok(holding > 0);
  const html = renderToStaticMarkup(createElement(SidebarMenu, { groups }));
  const open = html
    .split('<details')
    .slice(1)
    .map((group) => /^[^>]* open=""/.test(group));
  assert.deepEqual(
    open.flatMap((isOpen, index) => (isOpen ? [index] : [])),
    [holding],
  );
  assert.equal(new Set(html.match(/<details name="[^"]+"/g)).size, 1, 'one accordion');
  const home = renderToStaticMarkup(
    createElement(SidebarMenu, { groups: apiMenu(entries, { locale: 'en', area: 'api', id: '' }) }),
  );
  assert.equal((home.match(/<details[^>]* open=""/g) ?? []).length, 1);
  assert.match(home, /^<ul[^>]*><li[^>]*><details[^>]* open=""/);
  assert.match(html, /class="flex min-w-0 menu-active" href="#\/en\/api\/multiplyMatrix4"/);
});
