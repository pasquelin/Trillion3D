import type { Locale } from '../../content/locale.ts';
import { rawEntries } from '../portal/data.ts';
import { Badge, LinkBadge } from './Badge.tsx';

const documented = new Set(rawEntries.map(({ id }) => id));

/** The API names a lesson calls, linked when the catalogue documents them. */
export function ApiBadges({ names, locale }: { names: readonly string[]; locale: Locale }) {
  return names.map((name) =>
    documented.has(name) ? (
      <LinkBadge key={name} tone="secondary" soft mono href={`#/${locale}/api/${name}`}>
        {name}
      </LinkBadge>
    ) : (
      <Badge key={name} tone="secondary" soft mono>
        {name}
      </Badge>
    ),
  );
}
