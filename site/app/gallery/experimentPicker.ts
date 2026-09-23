import type { Locale } from '../../content/locale.ts';
import { local } from '../../content/locale.ts';
import { examples } from '../../content/catalog.ts';
import type { LessonControl } from '../ui/LessonControls.tsx';

/** The experiment picker every lesson shows first: the catalogue, in the reader's language. */
export const experimentPicker = (
  current: string,
  locale: Locale,
  onSelect?: (id: string) => void,
): LessonControl => ({
  kind: 'select',
  id: 'experiment',
  value: current,
  options: examples.map((example) => ({ value: example.id, label: local(example.title, locale) })),
  onChange: (id) => onSelect?.(id),
  props: {
    'aria-label': locale === 'fr' ? 'Choisir une expérience' : 'Choose an experiment',
  },
});
