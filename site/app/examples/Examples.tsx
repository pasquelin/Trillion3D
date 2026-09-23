import { t } from '../../content/i18n/index.ts';
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { ExampleCard } from '../gallery/ExampleCard.tsx';
import { DocPage } from '../layout/DocPage.tsx';
import { routeHref } from '../portal/routes.ts';
import { Grid } from '../ui/Grid.tsx';
import { readyThemes, thumbnailOf } from './list.ts';

/** The Examples landing page: one card per ready example, theme by theme, its settled render as
 * thumbnail, opening the example. */
export function Examples({ locale }: { locale: Locale }) {
  return (
    <DocPage data-examples title={t(locale, 'nav.examples')} lead={t(locale, 'examples.lead')}>
      <Grid>
        {readyThemes.flatMap(({ theme, entries }) =>
          entries.map((entry) => (
            <ExampleCard
              key={entry.id}
              locale={locale}
              href={routeHref({ locale, area: 'examples', id: entry.id })}
              badge={local(theme.title, locale)}
              example={{
                id: entry.id,
                category: entry.theme,
                title: entry.title,
                preview: thumbnailOf(entry.id),
              }}
            />
          )),
        )}
      </Grid>
    </DocPage>
  );
}
