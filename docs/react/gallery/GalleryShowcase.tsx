import { useState } from 'react';
import type { Locale } from '../types/portal.ts';
import { routeHref } from '../../js/portal/routes.js';
import { Card } from '../components/UI.tsx';
import { local, type Localized } from './localized.ts';

interface ShowcaseScene {
  id: string;
  preview: string;
  title: Localized;
  description: Localized;
  action: Localized;
  alt: Localized;
}

const scenes: ShowcaseScene[] = [
  {
    id: 'runtime-pixel-error',
    preview: './assets/gallery/renderer/runtime-pixel-error.png',
    title: { en: 'Cross the observatory', fr: 'Traverser l’observatoire' },
    description: {
      en: 'Explore 91,352 authored triangles, then reveal where the streamed cut becomes coarser.',
      fr: 'Explorez 91 352 triangles originaux, puis affichez où la géométrie streamée se simplifie.',
    },
    action: { en: 'Explore live LOD', fr: 'Explorer le LOD en direct' },
    alt: {
      en: 'Sunlit observatory with fluted colonnades, copper dome and brass armillary',
      fr: 'Observatoire éclairé avec colonnades cannelées, dôme de cuivre et sphère armillaire',
    },
  },
  {
    id: 'shadow-casting-switch',
    preview: './assets/gallery/renderer/shadow-casting-switch.png',
    title: { en: 'Direct the shadow theatre', fr: 'Diriger le théâtre d’ombres' },
    description: {
      en: 'Switch the key light shadow while three distinct puppets and the theatre stay lit.',
      fr: 'Coupez l’ombre de la lumière principale tout en gardant les trois marionnettes éclairées.',
    },
    action: { en: 'Try the shadow switch', fr: 'Essayer l’interrupteur d’ombre' },
    alt: {
      en: 'Velvet puppet theatre with a bird, fox and leafy branch casting shadows',
      fr: 'Théâtre de velours où un oiseau, un renard et une branche projettent leurs ombres',
    },
  },
];

export function GalleryShowcase({ locale }: { locale: Locale }) {
  const french = locale === 'fr',
    [selectedId, setSelectedId] = useState(scenes[0].id),
    selected = scenes.find(({ id }) => id === selectedId) ?? scenes[0];
  return (
    <Card className="mb-8 overflow-hidden shadow-lg" data-gallery-showcase>
      <div className="grid gap-5">
        <div
          className="grid gap-3 sm:grid-cols-2"
          role="list"
          aria-label={french ? 'Scènes à la une' : 'Featured scenes'}
        >
          {scenes.map((scene) => (
            <div key={scene.id} role="listitem">
              <button
                type="button"
                className={`flex w-full items-center gap-3 rounded-box border p-2 text-left ${scene.id === selected.id ? 'border-primary bg-primary/10' : 'border-base-300 bg-base-100'}`}
                aria-pressed={scene.id === selected.id}
                onClick={() => setSelectedId(scene.id)}
              >
                <img
                  className="aspect-video w-28 rounded-field object-cover"
                  src={scene.preview}
                  alt=""
                />
                <span className="font-semibold">{local(scene.title, locale)}</span>
              </button>
            </div>
          ))}
        </div>
        <a
          className="grid gap-4 rounded-box focus-visible:outline-2 focus-visible:outline-primary"
          href={routeHref({ locale, area: 'examples', id: selected.id })}
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">
                {french ? 'Scène à la une' : 'Featured scene'}
              </p>
              <h2 className="mt-1 text-2xl font-bold">{local(selected.title, locale)}</h2>
              <p className="mt-2 max-w-3xl opacity-75">{local(selected.description, locale)}</p>
            </div>
            <span className="btn btn-primary">{local(selected.action, locale)}</span>
          </div>
          <div className="overflow-hidden rounded-box bg-base-300">
            <img
              className="aspect-video max-h-[32rem] w-full object-cover"
              src={selected.preview}
              alt={local(selected.alt, locale)}
            />
          </div>
        </a>
      </div>
    </Card>
  );
}
