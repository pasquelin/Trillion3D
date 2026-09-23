import { useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import { routeHref } from '../portal/routes.ts';
import { Card } from '../ui/Card.tsx';
import { local } from '../../content/locale.ts';
import { showcaseScenes as scenes } from '../../content/showcase.ts';

export function GalleryShowcase({ locale }: { locale: Locale }) {
  const french = locale === 'fr',
    [selectedId, setSelectedId] = useState(scenes[0].id),
    selected = scenes.find(({ id }) => id === selectedId) ?? scenes[0];
  return (
    <Card className="mb-8 overflow-hidden shadow-lg" data-gallery-showcase>
      <div className="grid grid-cols-1 gap-5">
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
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
          className="grid grid-cols-1 gap-4 rounded-box focus-visible:outline-2 focus-visible:outline-primary"
          href={routeHref({ locale, area: 'lessons', id: selected.id })}
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
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
