import { useWords } from '../i18n.ts';
import { entrySummary } from '../../content/model.ts';
import type { CourseChapter, PortalEntry } from '../../content/model.ts';
import type { Locale } from '../../content/locale.ts';
import { DocPage } from '../layout/DocPage.tsx';
import { routeHref } from '../portal/routes.ts';
import { Actions, LinkButton } from '../ui/Button.tsx';
import { CodeBlock } from '../ui/CodeBlock.tsx';
import { Inline, Prose, Steps } from '../ui/Prose.tsx';
import { RenderFrame } from '../ui/RenderFrame.tsx';
import { Section, TextLink } from '../ui/Text.tsx';

/**
 * One chapter of the course: the steps, the few lines of code, the example live to change across
 * the page, then the button to the next chapter.
 */
export function Chapter({ entry, locale }: { entry: PortalEntry; locale: Locale }) {
  const t = useWords(locale);
  const chapter: CourseChapter = entry.chapter!;
  const { words } = chapter;
  const title = entry.title || entry.id;
  const example = routeHref({ locale, area: 'examples', id: chapter.example });
  return (
    <DocPage
      data-chapter={entry.id}
      eyebrow={t('kind.Chapter')}
      title={title}
      lead={<Inline text={entrySummary(entry)} />}
    >
      <Section title={words.steps}>
        <Steps steps={chapter.steps} />
      </Section>
      <Section title={words.code}>
        {chapter.code.map((block) => (
          <CodeBlock key={block} code={block} locale={locale} label={words.code} />
        ))}
      </Section>
      <Section title={words.tryIt}>
        <Prose html={chapter.tryIt} />
        <RenderFrame>
          <iframe src={`examples/${chapter.example}.html`} title={title} loading="lazy" />
        </RenderFrame>
        <p>
          <TextLink href={example}>{words.open}</TextLink>
        </p>
      </Section>
      <Actions>
        <LinkButton variant="primary" href={chapter.next.href}>
          {chapter.next.label} →
        </LinkButton>
      </Actions>
    </DocPage>
  );
}
