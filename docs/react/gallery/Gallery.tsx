import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Locale } from '../types/portal.ts';
import type { ProgressiveListState } from '../types/components.ts';
import type { GalleryExample, GalleryViewState } from '../types/gallery.ts';
import roadmap from '../../data/gallery-roadmap.json';
import { Alert, Field } from '../components/UI.tsx';
import { examples } from '../../js/gallery/catalog.js';
import { engineExample, ExampleCard } from './ExampleCard.tsx';
import { themeOf, themes } from './roadmapThemes.ts';
import { ProgressiveList } from '../components/ProgressiveList.tsx';
import { ThemeTabs } from './ThemeTabs.tsx';
import { galleryRoadmapEntry } from './roadmapRelated.ts';
import { GalleryShowcase } from './GalleryShowcase.tsx';

const PAGE_SIZE = 24;
const viewState = new Map<Locale, GalleryViewState>();
const READY: GalleryExample[] = [engineExample, ...examples].map((entry) => ({
  ...entry,
  status: 'ready',
}));
const ROADMAP = roadmap.entries.map(galleryRoadmapEntry);

const normalized = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase();

const searchable = (entry: GalleryExample): string =>
  normalized(
    `${entry.id} ${entry.title.en} ${entry.title.fr} ${entry.description?.en ?? ''} ${entry.description?.fr ?? ''} ${entry.subject ?? ''} ${entry.supplementaryTopic ?? ''} ${(entry.functions ?? []).join(' ')}`,
  );

export function Gallery({ locale = 'en' }: { locale?: Locale }) {
  const restored = useRef(viewState.get(locale));
  const [query, setQuery] = useState(restored.current?.query ?? '');
  const [category, setCategory] = useState(restored.current?.category ?? 'all');
  const [expanded, setExpanded] = useState('');
  const progressive = useRef<ProgressiveListState | undefined>(restored.current?.progressive);
  const scrollY = useRef(restored.current?.scrollY ?? 0);
  const currentView = useRef<{ query: string; category: string }>({ query, category });
  currentView.current = { query, category };
  const entries = useMemo(
    () =>
      [...READY, ...ROADMAP].filter(
        (entry) =>
          (category === 'all' || themeOf(entry) === category) &&
          searchable(entry).includes(normalized(query)),
      ),
    [query, category],
  );
  const categories = themes
    .map(([value]) => value)
    .filter((value) => [...READY, ...ROADMAP].some((entry) => themeOf(entry) === value));
  const french = locale === 'fr';
  const filter =
    (setter: Dispatch<SetStateAction<string>>) => (event: ChangeEvent<HTMLInputElement>) => {
      setter(event.target.value);
      progressive.current = undefined;
      setExpanded('');
    };
  useEffect(() => {
    const rememberScroll = () => {
      scrollY.current = window.scrollY;
    };
    addEventListener('scroll', rememberScroll, { passive: true });
    if (restored.current)
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, scrollY.current)));
    return () => {
      removeEventListener('scroll', rememberScroll);
      viewState.set(locale, {
        ...currentView.current,
        progressive: progressive.current,
        scrollY: scrollY.current,
      });
    };
  }, [locale]);
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
      <GalleryShowcase locale={locale} />
      <div className="mb-4">
        <ThemeTabs
          active={category}
          available={categories}
          locale={locale}
          onSelect={(item) => {
            setCategory(item);
            progressive.current = undefined;
            setExpanded('');
          }}
        />
      </div>
      <p className="text-sm opacity-70 mb-4" role="status">
        {entries.length} {french ? 'résultats affichés' : 'results shown'} · {READY.length}{' '}
        {french ? 'leçons prêtes dans toute la galerie' : 'ready lessons in the full gallery'}
      </p>
      {!!entries.length && (
        <ProgressiveList
          key={`${category}:${normalized(query)}`}
          items={entries}
          batchSize={PAGE_SIZE}
          maxBatches={3}
          initialState={progressive.current}
          onStateChange={(state) => {
            progressive.current = state;
          }}
          labels={{
            previous: french ? 'Charger les résultats précédents' : 'Load previous results',
            next: french ? 'Charger plus de résultats' : 'Load more results',
            loading: french ? 'Chargement…' : 'Loading…',
            end: french ? 'Fin des résultats' : 'End of results',
          }}
          renderItem={(entry) => (
            <ExampleCard
              key={entry.id}
              example={entry}
              locale={locale}
              expanded={expanded === entry.id}
              onOpen={(id) => setExpanded((value) => (value === id ? '' : id))}
            />
          )}
        />
      )}
      {!entries.length && (
        <Alert tone="info">{french ? 'Aucun sujet trouvé.' : 'No topics found.'}</Alert>
      )}
    </section>
  );
}
