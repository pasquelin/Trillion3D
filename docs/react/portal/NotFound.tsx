import { useState, type JSX } from 'react';
import { routeHref } from '../../js/portal/routes.js';
import { initialState, SCENARIOS } from '../../js/gallery/scenarios.js';
import { WebGPUCanvas } from '../gallery/WebGPUCanvas.tsx';
import { usePlaygroundMotion } from '../gallery/usePlaygroundMotion.ts';
import { SectionHeader } from '../components/SectionHeader.tsx';
import { Section } from '../components/Section.tsx';
import type { NotFoundProps } from '../types/portal.ts';

export function NotFound({ locale }: NotFoundProps): JSX.Element {
  const fr = locale === 'fr';
  const [state, setState] = useState(() => initialState('hierarchy'));
  const motion = usePlaygroundMotion(SCENARIOS.hierarchy, setState, { autoPlay: true });
  return (
    <div className="grid gap-6">
      <SectionHeader
        level={1}
        eyebrow="404"
        title={fr ? 'Page introuvable' : 'Page not found'}
        description={
          fr
            ? 'Cette adresse ne correspond à aucune page du portail.'
            : 'This address does not match a page in the portal.'
        }
      />
      <Section title={fr ? 'Retrouver votre chemin' : 'Find your way back'}>
        <div className="flex flex-wrap gap-3">
          <a className="btn btn-primary" href={routeHref({ locale, area: 'learn', id: 'home' })}>
            {fr ? 'Revenir à l’accueil' : 'Return home'}
          </a>
          <a className="btn btn-outline" href={routeHref({ locale, area: 'examples' })}>
            {fr ? 'Explorer les exemples' : 'Explore examples'}
          </a>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={motion.toggle}
            aria-pressed={motion.playing}
          >
            {motion.playing
              ? fr
                ? 'Mettre en pause'
                : 'Pause animation'
              : fr
                ? 'Animer'
                : 'Animate'}
          </button>
        </div>
      </Section>
      <WebGPUCanvas
        id="hierarchy"
        state={state}
        locale={locale}
        animating={motion.playing}
        related
        label={
          fr
            ? 'Orbites géométriques — illustration 3D interactive'
            : 'Geometric orbits — interactive 3D illustration'
        }
      />
    </div>
  );
}
