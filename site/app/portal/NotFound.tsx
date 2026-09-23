import { useState } from 'react';
import { routeHref } from './routes.ts';
import { initialState, SCENARIOS } from '../../lessons/scenarios.ts';
import { WebGPUCanvas } from '../gallery/WebGPUCanvas.tsx';
import { usePlaygroundMotion } from '../gallery/usePlaygroundMotion.ts';
import { DocPage } from '../layout/DocPage.tsx';
import { Actions, Button, LinkButton } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import type { Locale } from '../../content/locale.ts';

export function NotFound({ locale }: { locale: Locale }) {
  const fr = locale === 'fr';
  const [state, setState] = useState(() => initialState('hierarchy'));
  const motion = usePlaygroundMotion(SCENARIOS.hierarchy, setState, { autoPlay: true });
  return (
    <DocPage
      eyebrow="404"
      title={fr ? 'Page introuvable' : 'Page not found'}
      lead={
        fr
          ? 'Cette adresse ne correspond à aucune page du portail.'
          : 'This address does not match a page in the portal.'
      }
    >
      <Card title={fr ? 'Retrouver votre chemin' : 'Find your way back'}>
        <Actions>
          <LinkButton variant="primary" href={routeHref({ locale, area: 'learn', id: 'home' })}>
            {fr ? 'Revenir à l’accueil' : 'Return home'}
          </LinkButton>
          <LinkButton variant="outline" href={routeHref({ locale, area: 'examples', id: '' })}>
            {fr ? 'Explorer les exemples' : 'Explore examples'}
          </LinkButton>
          <Button onClick={motion.toggle} aria-pressed={motion.playing}>
            {motion.playing
              ? fr
                ? 'Mettre en pause'
                : 'Pause animation'
              : fr
                ? 'Animer'
                : 'Animate'}
          </Button>
        </Actions>
      </Card>
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
    </DocPage>
  );
}
