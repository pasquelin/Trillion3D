import { useWords } from '../i18n.ts';
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { ExampleCard, PendingExampleCard } from './ExampleCard.tsx';
import { DocPage } from '../layout/DocPage.tsx';
import { routeHref } from '../portal/routes.ts';
import { Grid } from '../ui/Grid.tsx';
import { Section } from '../ui/Text.tsx';
import { isReady, themedEntries, thumbnailOf } from './list.ts';

/** The Examples landing page, theme by theme: one card per ready example, its settled render as
 * thumbnail, opening the example; then one card per example still in progress or waiting for the
 * engine, opening nothing. */
export function Examples({ locale }: { locale: Locale }) {
  const t = useWords(locale);
  return (
    <DocPage data-examples title={t('nav.examples')} lead={t('examples.lead')}>
      {themedEntries.map(({ theme, entries }) => (
        <Section key={theme.id} title={local(theme.title, locale)}>
          <Grid>
            {entries.map((entry) =>
              isReady(entry) ? (
                <ExampleCard
                  key={entry.id}
                  title={local(entry.title, locale)}
                  href={routeHref({ locale, area: 'examples', id: entry.id })}
                  badge={local(theme.title, locale)}
                  thumbnail={thumbnailOf(entry.id)}
                />
              ) : (
                <PendingExampleCard
                  key={entry.id}
                  locale={locale}
                  title={local(entry.title, locale)}
                  missing={entry.missing && local(entry.missing, locale)}
                  issue={entry.issue}
                />
              ),
            )}
          </Grid>
        </Section>
      ))}
    </DocPage>
  );
}
