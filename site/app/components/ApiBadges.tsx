import type { Locale } from '../../content/locale.ts';
import { rawEntries } from '../portal/data.ts';

const documented = new Set(rawEntries.map(({ id }) => id));

/** The API names a lesson calls, linked when the catalogue documents them. */
export function ApiBadges({ names, locale }: { names: readonly string[]; locale: Locale }) {
  return names.map((name) =>
    documented.has(name) ? (
      <a
        key={name}
        className="badge badge-soft badge-secondary font-mono"
        href={`#/${locale}/api/${name}`}
      >
        {name}
      </a>
    ) : (
      <code key={name} className="badge badge-soft badge-secondary">
        {name}
      </code>
    ),
  );
}
