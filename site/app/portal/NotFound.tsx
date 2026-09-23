import { useState } from 'react';
import { useWords } from '../i18n.ts';
import { routeHref } from './routes.ts';
import { initialState, SCENARIOS } from '../../lessons/scenarios.ts';
import { WebGPUCanvas } from '../gallery/WebGPUCanvas.tsx';
import { usePlaygroundMotion } from '../gallery/usePlaygroundMotion.ts';
import { DocPage } from '../layout/DocPage.tsx';
import { Actions, Button, LinkButton } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import type { Locale } from '../../content/locale.ts';

export function NotFound({ locale }: { locale: Locale }) {
  const t = useWords(locale);
  const [state, setState] = useState(() => initialState('hierarchy'));
  const motion = usePlaygroundMotion(SCENARIOS.hierarchy, setState, { autoPlay: true });
  return (
    <DocPage eyebrow="404" title={t('notFound.title')} lead={t('notFound.lead')}>
      <Card title={t('notFound.wayBack')}>
        <Actions>
          <LinkButton variant="primary" href={routeHref({ locale, area: 'learn', id: 'home' })}>
            {t('notFound.home')}
          </LinkButton>
          <LinkButton variant="outline" href={routeHref({ locale, area: 'examples', id: '' })}>
            {t('notFound.examples')}
          </LinkButton>
          <Button onClick={motion.toggle} aria-pressed={motion.playing}>
            {t(motion.playing ? 'notFound.pause' : 'playground.animate')}
          </Button>
        </Actions>
      </Card>
      <WebGPUCanvas
        id="hierarchy"
        state={state}
        locale={locale}
        animating={motion.playing}
        related
        label={t('notFound.illustration')}
      />
    </DocPage>
  );
}
