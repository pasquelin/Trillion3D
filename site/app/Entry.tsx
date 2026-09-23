import { useWords } from './i18n.ts';
import { kindName } from '../content/i18n/dictionary.ts';
import { issueUrl } from '../content/model.ts';
import { demoFor } from '../demos/registry.ts';
import { ApiDemo } from './ApiDemo.tsx';
import { DocPage } from './layout/DocPage.tsx';
import { Collapse } from './ui/Collapse.tsx';
import { entryRest, entrySummary } from '../content/model.ts';
import { LEARN_SECTIONS } from './portal/routes.ts';
import { CodeBlock } from './ui/CodeBlock.tsx';
import { Card } from './ui/Card.tsx';
import { Alert } from './ui/Alert.tsx';
import { Inline, Prose } from './ui/Prose.tsx';
import { Members, Parameters, Returns } from './EntryFields.tsx';
import { Note, Paragraph, TextLink } from './ui/Text.tsx';
import type { DemoDef } from '../demos/kit.ts';
import type { Locale } from '../content/locale.ts';
import type { PortalEntry } from '../content/model.ts';

function LiveDemo({ demo, locale }: { demo: DemoDef; locale: Locale }) {
  const t = useWords(locale);
  return (
    <Card title={t('entry.live')}>
      <Note>{t('entry.liveHint')}</Note>
      <ApiDemo demo={demo} locale={locale} />
    </Card>
  );
}

/** The text past the summary: the rest of the description, then the entry's prose. */
function Details({ rest, html }: { rest: string; html?: string }) {
  return (
    <>
      {rest && (
        <Paragraph>
          <Inline text={rest} />
        </Paragraph>
      )}
      {html && <Prose html={html} />}
    </>
  );
}

/**
 * One guide or API entry. A guide reads as text: its description, its prose, then its code. An
 * API entry keeps one order: its summary, the signature, the parameters, what it returns, the
 * example, the members, then the long description, folded under Details.
 */
export function Entry({ entry, locale }: { entry: PortalEntry; locale: Locale }) {
  const t = useWords(locale);
  const demo = demoFor(entry.id);
  const summary = entrySummary(entry);
  const rest = entryRest(entry);
  const guide = LEARN_SECTIONS.includes(entry.section);
  const details = <Details rest={rest} html={entry.html} />;
  return (
    <DocPage
      eyebrow={kindName(entry.kind, locale)}
      title={entry.title || entry.id}
      lead={<Inline text={summary} />}
    >
      {entry.issue && (
        <Alert tone="warning">
          <span>
            {t('common.inDevelopment')}:{' '}
            <TextLink href={issueUrl(entry.issue)}>#{entry.issue}</TextLink>
          </span>
        </Alert>
      )}
      {guide && details}
      {entry.signature && (
        <CodeBlock code={entry.signature} locale={locale} label={t('entry.signature')} />
      )}
      <Parameters entry={entry} locale={locale} />
      <Returns entry={entry} locale={locale} />
      {entry.example && (
        <CodeBlock code={entry.example} locale={locale} label={t('entry.example')} />
      )}
      <Members entry={entry} locale={locale} />
      {demo && <LiveDemo demo={demo} locale={locale} />}
      {!guide && (rest || entry.html) && <Collapse title={t('entry.details')}>{details}</Collapse>}
      {(entry.replaces || entry.proof) && (
        <Card title={t('entry.proof')}>
          {entry.replaces && (
            <p>
              <strong>{t('entry.replaces')}: </strong>
              {entry.replaces}
            </p>
          )}
          {entry.proof && <p>{entry.proof}</p>}
        </Card>
      )}
    </DocPage>
  );
}
