import { useWords } from '../i18n.ts';
import { entrySummary } from '../../content/model.ts';
import type { CourseChapter, PortalEntry } from '../../content/model.ts';
import type { Locale } from '../../content/locale.ts';
import { thumbnailOf } from '../examples/list.ts';
import { DocPage } from '../layout/DocPage.tsx';
import { routeHref } from '../portal/routes.ts';
import { Actions, LinkButton } from '../ui/Button.tsx';
import { CodeBlock } from '../ui/CodeBlock.tsx';
import { Inline, Prose } from '../ui/Prose.tsx';
import { RenderFrame } from '../ui/RenderFrame.tsx';
import { Figure, Section, TextLink } from '../ui/Text.tsx';

/** A block of the chapter's code: markup reads as HTML, the rest as script. */
const languageOf = (block: string) => (block.trimStart().startsWith('<') ? 'html' : undefined);

/**
 * One chapter of the course: a picture of what it builds, the steps, the few lines of code, the
 * example live to change, then the button to the next chapter.
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
      <Section title={words.picture}>
        <Figure href={example} src={thumbnailOf(chapter.example)} alt={title} />
      </Section>
      <Section title={words.steps}>
        <Prose html={`<ol>${chapter.steps.map((step) => `<li>${step}</li>`).join('')}</ol>`} />
      </Section>
      <Section title={words.code}>
        {chapter.code.map((block) => (
          <CodeBlock
            key={block}
            code={block}
            locale={locale}
            label={words.code}
            language={languageOf(block)}
          />
        ))}
      </Section>
      <Section title={words.tryIt}>
        <Prose html={`<p>${chapter.tryIt}</p>`} />
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
