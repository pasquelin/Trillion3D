import { useWords } from '../i18n.ts'
import type { Locale } from '../../content/locale.ts'
import { ComingCard, ExampleCard } from './ExampleCard.tsx'
import { DocPage } from '../layout/DocPage.tsx'
import { routeHref } from '../portal/routes.ts'
import { Grid } from '../ui/Grid.tsx'
import { JumpTo } from '../ui/JumpTo.tsx'
import { Section } from '../ui/Text.tsx'
import {
  exampleMissing,
  exampleTitle,
  isReady,
  themedEntries,
  themeTitle,
  thumbnailOf,
} from './list.ts'

/** The heading a theme's section scrolls to. */
const themeAnchor = (theme: string) => `theme-${theme}`

/** The Examples landing page, theme by theme: complete tiles, then clickable parked ones, then a
 * tile per example still to write, opening nothing. */
export function Examples({ locale }: { locale: Locale }) {
  const t = useWords(locale)
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
          <Grid dense>
            {[...ready, ...parked].map((entry) => {
              return (
                <ExampleCard
                  key={entry.id}
                  title={exampleTitle(entry.id, locale)}
                  href={routeHref({ locale, area: 'examples', id: entry.id })}
                  thumbnail={thumbnailOf(entry.id)}
                  state={
                    isReady(entry)
                      ? undefined
                      : `${t('examples.partial')} — ${t('examples.waitsFor')} ${exampleMissing(entry.id, locale)}`
                  }
                />
              )
            })}
            {coming.map(({ id }) => (
              <ComingCard key={id} title={exampleTitle(id, locale)} label={t('examples.coming')} />
            ))}
          </Grid>
        </Section>
      ))}
    </DocPage>
  )
}
