import { useMemo, useState } from 'react';
import roadmap from '../../data/gallery-roadmap.json';
import { Alert, Field } from '../components/UI.jsx';
import { examples } from '../../js/gallery/catalog.js';
import { engineExample, ExampleCard } from './ExampleCard.jsx';
import { PlannedCard } from './PlannedCard.jsx';
import { categoryLabel } from './roadmapLabels.js';

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
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all'),
    [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState('');
  const entries = useMemo(
    () =>
      [...READY, ...roadmap.entries].filter(
        (entry) =>
          (status === 'all' || entry.status === status) &&
          (category === 'all' || entry.category === category) &&
          searchable(entry).includes(normalized(query)),
      ),
    [query, status, category],
  );
  const categories = [
    ...new Set([...READY, ...roadmap.entries].map(({ category: value }) => value)),
  ];
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
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div
          className="tabs tabs-box bg-base-200"
          role="tablist"
          aria-label={french ? 'État' : 'Status'}
        >
          {['all', 'ready', 'planned'].map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              className={`tab ${status === item ? 'tab-active' : ''}`}
              aria-selected={status === item}
              aria-pressed={status === item}
              onClick={() => {
                setStatus(item);
                setPage(0);
              }}
            >
              {
                {
                  all: french ? 'Tous' : 'All',
                  ready: french ? 'Prêts' : 'Ready',
                  planned: french ? 'En création' : 'In development',
                }[item]
              }
            </button>
          ))}
        </div>
        <Field label={french ? 'Catégorie' : 'Category'}>
          <select className="select select-sm" value={category} onChange={filter(setCategory)}>
            <option value="all">{french ? 'Toutes' : 'All'}</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {roadmap.categories[item]?.[french ? 'fr' : 'en'] ?? categoryLabel(item, locale)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-sm opacity-70 mb-4" role="status">
        {entries.length} {french ? 'résultats affichés' : 'results shown'} · {READY.length}{' '}
        {french ? 'leçons prêtes dans toute la galerie' : 'ready lessons in the full gallery'}
      </p>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((entry) =>
          entry.status === 'ready' ? (
            <ExampleCard key={entry.id} example={entry} locale={locale} />
          ) : (
            <PlannedCard
              key={entry.id}
              entry={entry}
              locale={locale}
              expanded={expanded === entry.id}
              onOpen={(id) => setExpanded((value) => (value === id ? '' : id))}
            />
          ),
        )}
      </div>
      {!entries.length && (
        <Alert tone="info">{french ? 'Aucun sujet trouvé.' : 'No topics found.'}</Alert>
      )}
      {pages > 1 && (
        <div className="join flex justify-center mt-6">
          <button className="join-item btn" disabled={page <= 0} onClick={() => setPage(page - 1)}>
            ←
          </button>
          <span className="join-item btn pointer-events-none">
            {Math.min(page, pages - 1) + 1} / {pages}
          </span>
          <button
            className="join-item btn"
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
          >
            →
          </button>
        </div>
      )}
    </section>
  );
}
