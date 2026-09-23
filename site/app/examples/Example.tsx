import type { Locale } from '../../content/locale.ts';
import { DemoPage } from '../layout/DemoPage.tsx';
import { routeHref } from '../portal/routes.ts';
import { exampleTitle, readyEntries } from './list.ts';

/** One example: its file, live, on the demo page; its source opens in the sandbox. */
export function Example({ id, locale }: { id: string; locale: Locale }) {
  const entry = readyEntries.find((candidate) => candidate.id === id)!;
  return (
    <DemoPage
      key={id}
      file={entry.file}
      title={exampleTitle(entry.id, locale)}
      sandboxHref={routeHref({ locale, area: 'sandbox', id })}
    />
  );
}
