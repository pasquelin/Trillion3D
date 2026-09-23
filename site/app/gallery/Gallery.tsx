import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import type { ProgressiveListState } from '../ui/ProgressiveList.tsx';
import type { CatalogExample } from '../../content/catalog.ts';
import { Alert } from '../ui/Alert.tsx';
import { DocPage } from '../layout/DocPage.tsx';
import { Note } from '../ui/Text.tsx';
import { examples } from '../../content/catalog.ts';
import { engineExample, ExampleCard } from './ExampleCard.tsx';
import { themeOf, themes } from './lessonThemes.ts';
import { ProgressiveList } from '../ui/ProgressiveList.tsx';
import { ThemeTabs } from './ThemeTabs.tsx';
import { GalleryShowcase } from './GalleryShowcase.tsx';

/** A visitor's restored gallery state: category and scroll position, kept per locale. */
interface GalleryViewState {
  category: string;
  progressive?: ProgressiveListState;
  scrollY: number;
}

const PAGE_SIZE = 24;
const viewState = new Map<Locale, GalleryViewState>();
const LESSONS: CatalogExample[] = [engineExample, ...examples];

export function Gallery({ locale = 'en' }: { locale?: Locale }) {
  const restored = useRef(viewState.get(locale));
  const [category, setCategory] = useState(restored.current?.category ?? 'all');
  const progressive = useRef<ProgressiveListState | undefined>(restored.current?.progressive);
  const scrollY = useRef(restored.current?.scrollY ?? 0);
  const currentView = useRef({ category });
  currentView.current = { category };
  const entries = useMemo(
    () => LESSONS.filter((entry) => category === 'all' || themeOf(entry) === category),
    [category],
  );
  const categories = themes
    .map(([value]) => value)
    .filter((value) => LESSONS.some((entry) => themeOf(entry) === value));
  const french = locale === 'fr';
  useEffect(() => {
    // The shell's content area is what scrolls.
    const area = document.getElementById('main-content');
    const rememberScroll = () => {
      scrollY.current = area?.scrollTop ?? 0;
    };
    area?.addEventListener('scroll', rememberScroll, { passive: true });
    if (restored.current)
      requestAnimationFrame(() => requestAnimationFrame(() => area?.scrollTo(0, scrollY.current)));
    return () => {
      area?.removeEventListener('scroll', rememberScroll);
      viewState.set(locale, {
        ...currentView.current,
        progressive: progressive.current,
        scrollY: scrollY.current,
      });
    };
  }, [locale]);
  return (
    <DocPage
      data-gallery
      eyebrow={french ? 'Apprendre par l’image' : 'Learn by seeing'}
      title={french ? 'Leçons' : 'Lessons'}
    >
      <GalleryShowcase locale={locale} />
      <div>
        <ThemeTabs
          active={category}
          available={categories}
          locale={locale}
          onSelect={(item) => {
            setCategory(item);
            progressive.current = undefined;
          }}
        />
      </div>
      <Note role="status">
        {entries.length} {french ? 'leçons affichées' : 'lessons shown'}
      </Note>
      {!!entries.length && (
        <ProgressiveList
          key={category}
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
          renderItem={(entry) => <ExampleCard key={entry.id} example={entry} locale={locale} />}
        />
      )}
      {!entries.length && (
        <Alert tone="info">{french ? 'Aucune leçon trouvée.' : 'No lessons found.'}</Alert>
      )}
    </DocPage>
  );
}
