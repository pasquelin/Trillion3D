import { t } from '../../content/i18n/index.ts';
import { examples } from '../../content/catalog.ts';
import type { CatalogExample } from '../../content/catalog.ts';
import type { Locale } from '../../content/locale.ts';
import { ExampleCard } from '../gallery/ExampleCard.tsx';
import { DocPage } from '../layout/DocPage.tsx';
import { LinkButton } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { Grid } from '../ui/Grid.tsx';
import { StepList } from '../ui/List.tsx';
import { routeHref } from './routes.ts';

const FEATURED = ['compose-transform', 'perspective', 'lod-budget']
  .map((id) => examples.find((example) => example.id === id))
  .filter((example): example is CatalogExample => example !== undefined);

const STEPS = ['quick-start', 'architecture', 'example-diagnostics'];

/** The home of Learn: where to start, three lessons to try, and the first steps in order. */
export function Home({ locale }: { locale: Locale }) {
  return (
    <DocPage
      eyebrow={t(locale, 'home.eyebrow')}
      title={t(locale, 'home.title')}
      lead={t(locale, 'home.description')}
      actions={
        <>
          <LinkButton
            variant="primary"
            href={routeHref({ locale, area: 'learn', id: 'quick-start' })}
          >
            {t(locale, 'home.start')} →
          </LinkButton>
          <LinkButton href={routeHref({ locale, area: 'api', id: '' })}>
            {t(locale, 'home.explore')}
          </LinkButton>
        </>
      }
    >
      <Card title={t(locale, 'home.lessonsTitle')}>
        <p>{t(locale, 'home.lessonsDescription')}</p>
        <Grid>
          {FEATURED.map((example) => (
            <ExampleCard key={example.id} example={example} locale={locale} />
          ))}
        </Grid>
      </Card>
      <Card title={t(locale, 'home.pathTitle')}>
        <p>{t(locale, 'home.pathDescription')}</p>
        <StepList
          steps={STEPS.map((id, index) => ({
            id,
            href: routeHref({ locale, area: 'learn', id }),
            title: t(locale, `home.step${index + 1}Title`),
            text: t(locale, `home.step${index + 1}Description`),
          }))}
        />
      </Card>
    </DocPage>
  );
}
