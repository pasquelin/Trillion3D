import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { DemoPage } from '../layout/DemoPage.tsx';
import { readyEntries } from './list.ts';

/** One example: its file, live, on the demo page. */
export function Example({ id, locale }: { id: string; locale: Locale }) {
  const entry = readyEntries.find((candidate) => candidate.id === id)!;
  return <DemoPage key={id} file={entry.file} title={local(entry.title, locale)} />;
}
