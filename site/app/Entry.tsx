import { t } from '../content/i18n/index.ts';
import { issueUrl, REPOSITORY } from '../content/model.ts';
import { demoFor } from '../demos/registry.ts';
import { ApiDemo } from './ApiDemo.tsx';
import { DocPage } from './layout/DocPage.tsx';
import { summaryOf } from './layout/menus.ts';
import { CodeBlock } from './ui/CodeBlock.tsx';
import { Card } from './ui/Card.tsx';
import { Alert } from './ui/Alert.tsx';
import { Inline, Prose } from './ui/Prose.tsx';
import { DefinitionTable } from './ui/Table.tsx';
import { Note, Paragraph, TextLink } from './ui/Text.tsx';
import type { DemoDef } from '../demos/kit.ts';
import type { Locale } from '../content/locale.ts';
import type { PortalEntry } from '../content/model.ts';

function LiveDemo({ demo, locale }: { demo: DemoDef; locale: Locale }) {
  return (
    <Card title={t(locale, 'entry.live')}>
      <Note>{t(locale, 'entry.liveHint')}</Note>
      <ApiDemo demo={demo} locale={locale} />
    </Card>
  );
}

/** One guide or API entry: its description, its prose, its signature, its example, its values. */
export function Entry({ entry, locale = 'en' }: { entry: PortalEntry; locale?: Locale }) {
  const demo = demoFor(entry.id);
  const summary = summaryOf(entry.description);
  const rest = entry.description.slice(summary.length).trim();
  return (
    <DocPage
      eyebrow={t(locale, `kind.${entry.kind}`)}
      title={entry.title || entry.id}
      lead={<Inline text={summary} />}
      actions={
        entry.module && (
          <TextLink href={`${REPOSITORY}/blob/develop/${entry.module}`}>{entry.module}</TextLink>
        )
      }
    >
      {entry.issue && (
        <Alert tone="warning">
          <span>
            {t(locale, 'common.inDevelopment')}:{' '}
            <TextLink href={issueUrl(entry.issue)}>#{entry.issue}</TextLink>
          </span>
        </Alert>
      )}
      {rest && (
        <Paragraph>
          <Inline text={rest} />
        </Paragraph>
      )}
      {entry.html && <Prose html={entry.html} />}
      {entry.signature && (
        <CodeBlock code={entry.signature} locale={locale} label={t(locale, 'entry.signature')} />
      )}
      {entry.example && (
        <CodeBlock code={entry.example} locale={locale} label={t(locale, 'entry.example')} />
      )}
      {demo && <LiveDemo demo={demo} locale={locale} />}
      {(entry.values?.length ?? 0) > 0 && (
        <Card
          title={
            entry.valuesTitle ??
            t(locale, entry.kind === 'Type' ? 'entry.values' : 'entry.arguments')
          }
        >
          <DefinitionTable
            rows={(entry.values ?? []).map((value) => ({
              name: value.name,
              value: <Inline text={value.desc} />,
            }))}
          />
        </Card>
      )}
      {(entry.replaces || entry.proof) && (
        <Card title={t(locale, 'entry.proof')}>
          {entry.replaces && (
            <p>
              <strong>{t(locale, 'entry.replaces')}: </strong>
              {entry.replaces}
            </p>
          )}
          {entry.proof && <p>{entry.proof}</p>}
        </Card>
      )}
    </DocPage>
  );
}
