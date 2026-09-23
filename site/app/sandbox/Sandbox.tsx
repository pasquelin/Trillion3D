import type { Locale } from '../../content/locale.ts';
import { useWords } from '../i18n.ts';
import { DemoPage } from '../layout/DemoPage.tsx';
import { exampleTitle, readyEntries } from '../examples/list.ts';
import { routeHref } from '../portal/routes.ts';
import { Select } from '../ui/Input.tsx';

/** The example the sandbox starts from when its route names none: the simplest one. */
const FIRST_EXAMPLE = 'a-first-world';

/** The sandbox: an example's source to change and run, the example picked among the ready ones. */
export function Sandbox({ id, locale }: { id: string; locale: Locale }) {
  const t = useWords(locale);
  const entry = readyEntries.find((candidate) => candidate.id === (id || FIRST_EXAMPLE))!;
  return (
    <DemoPage
      file={entry.file}
      title={t('sandbox.title')}
      sandbox={
        <Select
          size="sm"
          aria-label={t('sandbox.start')}
          value={entry.id}
          onChange={(event) => {
            location.hash = routeHref({ locale, area: 'sandbox', id: event.target.value });
          }}
        >
          {readyEntries.map((example) => (
            <option key={example.id} value={example.id}>
              {exampleTitle(example.id, locale)}
            </option>
          ))}
        </Select>
      }
    />
  );
}
