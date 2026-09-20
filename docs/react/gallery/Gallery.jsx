import { useMemo, useState } from 'react';
import roadmap from '../../data/gallery-roadmap.json';
import { Alert, Field } from '../components/UI.jsx';
import { examples } from '../../js/gallery/catalog.js';
import { engineExample, ExampleCard } from './ExampleCard.jsx';
import { themeOf, themes } from './roadmapThemes.js';
import { Pagination } from '../components/Pagination.jsx';
import { ThemeTabs } from './ThemeTabs.jsx';

const PAGE_SIZE = 24;
const READY = [engineExample, ...examples].map((entry) => ({ ...entry, status: 'ready' }));
const normalized = (value) =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase();
const searchable = (entry) =>
  normalized(
    `${entry.id} ${entry.title.en} ${entry.title.fr} ${entry.description?.en ?? ''} ${entry.description?.fr ?? ''} ${entry.subject ?? ''} ${entry.supplementaryTopic ?? ''} ${(entry.functions ?? []).join(' ')}`,
  );

export function Gallery({ locale = 'en' }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all'),
    [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState('');
  const entries = useMemo(
    () =>
      [...READY, ...roadmap.entries].filter(
        (entry) =>
          (category === 'all' || themeOf(entry) === category) &&
          searchable(entry).includes(normalized(query)),
      ),
    [query, category],
  );
  const categories = themes
    .map(([value]) => value)
    .filter((value) => [...READY, ...roadmap.entries].some((entry) => themeOf(entry) === value));
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const visible = entries.slice(
    Math.min(page, pages - 1) * PAGE_SIZE,
    (Math.min(page, pages - 1) + 1) * PAGE_SIZE,
  );
  const french = locale === 'fr';
  const filter = (setter) => (event) => {
    setter(event.target.value);
    setPage(0);
    setExpanded('');
  };
  return (
    <section data-gallery>
      <div className="flex flex-col gap-5 mb-6 lg:flex-row lg:items-end lg:justify-between">
        <header>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            {french ? 'Apprendre par l’image' : 'Learn by seeing'}
          </p>
          <h1 className="text-3xl font-bold mt-2">
            {french ? 'Galerie complète' : 'Complete gallery'}
          </h1>
        </header>
        <Field
          className="w-full lg:max-w-sm"
          label={`${french ? 'Rechercher' : 'Search'} ${READY.length + roadmap.entries.length} ${french ? 'sujets' : 'topics'}`}
        >
          <input
            className="input input-bordered w-full"
            type="search"
            value={query}
            onChange={filter(setQuery)}
            aria-label={french ? 'Rechercher les exemples' : 'Search examples'}
          />
        </Field>
      </div>
      <div className="mb-4">
        <ThemeTabs
          active={category}
          available={categories}
          locale={locale}
          onSelect={(item) => {
            setCategory(item);
            setPage(0);
            setExpanded('');
          }}
        />
      </div>
      <p className="text-sm opacity-70 mb-4" role="status">
        {entries.length} {french ? 'résultats affichés' : 'results shown'} · {READY.length}{' '}
        {french ? 'leçons prêtes dans toute la galerie' : 'ready lessons in the full gallery'}
      </p>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((entry) => (
          <ExampleCard
            key={entry.id}
            example={entry}
            locale={locale}
            expanded={expanded === entry.id}
            onOpen={(id) => setExpanded((value) => (value === id ? '' : id))}
          />
        ))}
      </div>
      {!entries.length && (
        <Alert tone="info">{french ? 'Aucun sujet trouvé.' : 'No topics found.'}</Alert>
      )}
      <Pagination page={page} pages={pages} onChange={setPage} locale={locale} />
    </section>
  );
}
