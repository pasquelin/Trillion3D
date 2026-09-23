import { t } from '../../content/i18n/index.ts';
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { readyEntries, thumbnailOf } from '../examples/list.ts';
import { formatValue } from '../../reports/metrics.ts';
import { sceneName } from '../../reports/presentation.ts';
import { useHeadline } from '../reports/useHeadline.ts';
import { Actions, LinkButton } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { Grid } from '../ui/Grid.tsx';
import { Hero } from '../ui/Hero.tsx';
import { LiveCode } from '../ui/LiveCode.tsx';
import { Stat, StatGroup } from '../ui/Stats.tsx';
import { Section } from '../ui/Text.tsx';
import { Thumbnail } from '../ui/Thumbnail.tsx';
import { routeHref } from './routes.ts';

/** The scene behind the title: geometry streamed by clusters, each cluster its own colour. */
const HERO_SCENE = 'examples/observatory-streamed.html';

/** What the engine gives, each with the example that shows it. */
const VALUES = [
  ['stream', 'observatory-streamed'],
  ['budget', 'memory-on-a-budget'],
  ['measure', 'a-field-of-pebbles'],
] as const;

const FIRST_SCENE = `import { createWorld, geometry, material, object, light } from '../runtime/engine.js';

const world = createWorld('view', { controls: 'orbit' });
const box = geometry.box(1, 1, 1);
const cube = object.mesh(box, material.meshStandard({ color: '#e0663c' }));
world.scene.add(cube);
world.scene.add(light.directional({ intensity: 3, position: [3, 5, 4] }));
world.camera.position.set(2.5, 2, 3);
world.camera.lookAt(0, 0, 0);
world.invalidate();`;

/** The home of the site: what the engine does, running; the first scene; where to go next. */
export function Home({ locale }: { locale: Locale }) {
  const headline = useHeadline();
  const examples = routeHref({ locale, area: 'examples', id: '' });
  return (
    <div className="grid min-w-0 grid-cols-1 gap-10">
      <Hero
        scene={HERO_SCENE}
        title={t(locale, 'home.title')}
        lead={t(locale, 'home.description')}
        actions={
          <>
            <LinkButton
              variant="primary"
              href={routeHref({ locale, area: 'learn', id: 'quick-start' })}
            >
              {t(locale, 'home.start')}
            </LinkButton>
            <LinkButton variant="outline" className="text-neutral-content" href={examples}>
              {t(locale, 'home.examples')}
            </LinkButton>
          </>
        }
      />
      <Grid>
        {VALUES.map(([key, example]) => (
          <Card key={key} image={thumbnailOf(example)} title={t(locale, `home.${key}Title`)}>
            <p>{t(locale, `home.${key}Text`)}</p>
          </Card>
        ))}
      </Grid>
      <Section title={t(locale, 'home.firstTitle')}>
        <p>{t(locale, 'home.firstText')}</p>
        <LiveCode
          code={FIRST_SCENE}
          from="examples/"
          label={t(locale, 'home.firstTitle')}
          locale={locale}
        />
      </Section>
      <Section title={t(locale, 'home.examplesTitle')}>
        <Grid dense>
          {readyEntries.slice(0, 6).map((entry) => (
            <Thumbnail
              key={entry.id}
              href={routeHref({ locale, area: 'examples', id: entry.id })}
              src={thumbnailOf(entry.id)}
              label={local(entry.title, locale)}
            />
          ))}
        </Grid>
        <Actions>
          <LinkButton href={examples}>{t(locale, 'home.allExamples')} →</LinkButton>
        </Actions>
      </Section>
      {headline && (
        <Card title={t(locale, 'home.measuredTitle')}>
          <StatGroup>
            <Stat
              title={t(locale, 'home.measuredStat')}
              description={`${sceneName(headline.scene)} · ${t(locale, 'home.measuredView')}`}
            >
              {formatValue(headline.gpu, locale, 'ms')}
            </Stat>
          </StatGroup>
          <Actions>
            <LinkButton href={routeHref({ locale, area: 'reports', id: headline.campaign })}>
              {t(locale, 'home.measuredLink')} →
            </LinkButton>
          </Actions>
        </Card>
      )}
    </div>
  );
}
