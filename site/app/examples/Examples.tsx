import { useWords } from '../i18n.ts';
import type { Locale } from '../../content/locale.ts';
import { ExampleCard } from './ExampleCard.tsx';
import { DocPage } from '../layout/DocPage.tsx';
import { routeHref } from '../portal/routes.ts';
import { Grid } from '../ui/Grid.tsx';
import { JumpTo } from '../ui/JumpTo.tsx';
import { Section } from '../ui/Text.tsx';
import {
  exampleMissing,
  exampleTitle,
  isReady,
  themedEntries,
  themeTitle,
  thumbnailOf,
} from './list.ts';

/** The heading a theme's section scrolls to. */
const themeAnchor = (theme: string) => `theme-${theme}`;

/** The Examples landing page, theme by theme: complete cards, then clickable parked source, then
 * one quiet line naming the examples still to write. */
export function Examples({ locale }: { locale: Locale }) {
  const t = useWords(locale);
  return (
    <DocPage
      data-examples
      title={t('nav.examples')}
      lead={t('examples.lead')}
      inlineActions
      stickyHeader
      actions={
        <JumpTo
          aria-label={t('examples.jumpTo')}
          placeholder={t('examples.jumpTo')}
          items={themedEntries.map(({ theme, ready, parked }) => ({
            id: themeAnchor(theme),
            label: themeTitle(theme, locale),
            count: ready.length + parked.length,
          }))}
        />
      }
    >
      {themedEntries.map(({ theme, ready, parked, coming }) => (
        <Section key={theme} id={themeAnchor(theme)} title={themeTitle(theme, locale)}>
          <Grid>
            {[...ready, ...parked].map((entry) => {
              return (
                <ExampleCard
                  key={entry.id}
                  title={exampleTitle(entry.id, locale)}
                  href={routeHref({ locale, area: 'examples', id: entry.id })}
                  badge={themeTitle(theme, locale)}
                  thumbnail={thumbnailOf(entry.id)}
                  state={
                    isReady(entry)
                      ? undefined
                      : `${t('examples.partial')} — ${t('examples.waitsFor')} ${exampleMissing(entry.id, locale)}`
                  }
                />
              );
            })}
          </Grid>
          {coming.length > 0 && (
            <p className="mt-3 text-sm text-base-content/65">
              {t('examples.coming', {
                titles: coming.map(({ id }) => exampleTitle(id, locale)).join(' · '),
              })}
            </p>
          )}
        </Section>
      ))}
    </DocPage>
  );
}
