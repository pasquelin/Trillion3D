import { useMemo, useState } from 'react';
import { SECTIONS } from '../../content/model.ts';
import { routeHref } from './routes.ts';
import { searchEntries } from './search.ts';
import { Card } from '../components/UI.tsx';
import { expandEntryLinks } from './entryLinks.ts';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry, TranslateFn } from '../types/portal.ts';

interface ApiIndexProps {
  locale: Locale;
  entries: PortalEntry[];
  t: TranslateFn;
}

export function ApiIndex({ locale, entries, t }: ApiIndexProps) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => searchEntries(entries, query), [entries, query]);
  const groups = SECTIONS.filter(({ id }) => !['guides', 'examples', 'demo'].includes(id))
    .map((section) => ({
      section,
      items: expandEntryLinks(matches.filter((entry: PortalEntry) => entry.section === section.id)),
    }))
    .filter(({ items }) => items.length);

  return (
    <section className="api-index">
      <header className="api-heading">
        <div>
          <p className="eyebrow">{t(locale, 'nav.api')}</p>
          <h1>{locale === 'fr' ? 'Référence du moteur' : 'Engine reference'}</h1>
          <p>
            {locale === 'fr'
              ? 'Fonctions, types et constantes publics, regroupés par responsabilité.'
              : 'Public functions, types, and constants grouped by responsibility.'}
          </p>
        </div>
        <label className="form-control api-search">
          <span className="label-text font-semibold">{t(locale, 'search.label')}</span>
          <input
            type="search"
            className="input input-bordered w-full"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(locale, 'search.placeholder')}
          />
        </label>
      </header>
      <div className="api-grid">
        {groups.map(({ section, items }) => (
          <Card key={section.id} className="api-group" title={t(locale, `section.${section.id}`)}>
            <ul className="menu w-full p-0">
              {items.map(({ key, label, id }) => (
                <li key={key}>
                  <a href={routeHref({ locale, area: 'api', id })}>
                    <code className="api-name">{label}</code>
                    <span aria-hidden="true">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {groups.length === 0 && (
        <p className="alert alert-soft" role="status">
          {t(locale, 'sidebar.noResults')}
        </p>
      )}
    </section>
  );
}
