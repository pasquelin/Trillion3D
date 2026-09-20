import { useMemo, useState } from 'react';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { Alert, Field } from '../components/UI.jsx';
import { examples } from '../../js/gallery/catalog.js';
import { engineExample, ExampleCard } from './ExampleCard.jsx';

const local = (value, locale) => value[locale === 'fr' ? 'fr' : 'en'];
const categories = {
  transforms: { en: 'Transforms', fr: 'Transformations' },
  camera: { en: 'Camera', fr: 'Caméra' },
  vectors: { en: 'Vectors', fr: 'Vecteurs' },
  bounds: { en: 'Bounds', fr: 'Volumes' },
  scene: { en: 'Scene', fr: 'Scène' },
  color: { en: 'Color', fr: 'Couleur' },
  streaming: { en: 'Streaming', fr: 'Streaming' },
};
const searchable = (example) =>
  `${example.title.en} ${example.title.fr} ${example.description.en} ${example.description.fr} ${(example.functions ?? []).join(' ')}`.toLowerCase();

export function Gallery({ locale = 'en' }) {
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('all');
  const categoryIds = [...new Set(examples.map((example) => example.category))];
  const visible = useMemo(
    () =>
      [engineExample, ...examples].filter(
        (example) =>
          (category === 'all' || example.category === category) &&
          searchable(example).includes(query.toLowerCase()),
      ),
    [query, category],
  );
  const french = locale === 'fr';
  return (
    <section data-gallery>
      <div className="flex flex-col gap-5 mb-6 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeader
          level={1}
          eyebrow={french ? 'Apprendre par l’image' : 'Learn by seeing'}
          title={french ? 'Galerie interactive' : 'Interactive gallery'}
        />
        <Field
          className="w-full lg:max-w-sm"
          label={french ? 'Rechercher les exemples' : 'Search examples'}
        >
          <input
            className="input input-bordered w-full"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={french ? 'Rechercher les exemples' : 'Search examples'}
          />
        </Field>
      </div>
      <div
        className="tabs tabs-box bg-base-200 flex flex-wrap h-auto mb-4"
        role="tablist"
        aria-label={french ? 'Filtrer les exemples' : 'Filter examples'}
      >
        {['all', ...categoryIds].map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            className={`tab ${category === item ? 'tab-active' : ''}`}
            aria-selected={category === item}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item === 'all' ? (french ? 'Tous' : 'All') : local(categories[item], locale)}
          </button>
        ))}
      </div>
      <p className="text-sm opacity-70 mb-4" role="status">
        {french
          ? `${visible.length} résultat${visible.length > 1 ? 's' : ''}`
          : `${visible.length} result${visible.length === 1 ? '' : 's'}`}
      </p>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((example) => (
          <ExampleCard key={example.id} example={example} locale={locale} />
        ))}
      </div>
      {visible.length === 0 && (
        <Alert tone="info">{french ? 'Aucun exemple trouvé.' : 'No examples found.'}</Alert>
      )}
    </section>
  );
}
