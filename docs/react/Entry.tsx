import { t } from '../js/i18n/index.js';
import { issueUrl, REPOSITORY } from '../js/docsModel.js';
import { demoFor } from '../js/demoRegistry.js';
import { apiScenario } from '../js/gallery/apiScenario.js';
import { engineDiagnosticsCode, engineExampleCode } from '../js/engine-scene/code.js';
import { examples } from '../js/gallery/catalog.js';
import { EngineExample } from './engine-scene/index.tsx';
import { GeometryPreview } from './gallery/index.tsx';
import { ApiDemo } from './ApiDemo.tsx';
import { CodeBlock } from './components/CodeBlock.tsx';
import { ExampleLayout } from './components/ExampleLayout.tsx';
import { Card, Alert } from './components/UI.tsx';
import { Inline, Prose, Table } from './components/Prose.tsx';
import type { DemoDef } from './types/demo.ts';
import type { Locale, PortalEntry } from './types/portal.ts';

function LiveDemo({ demo, locale }: { demo: DemoDef; locale: Locale }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t(locale, 'entry.live')}</h2>
        <p className="mt-1 text-sm opacity-70">{t(locale, 'entry.liveHint')}</p>
      </div>
      <ApiDemo demo={demo} locale={locale} />
    </section>
  );
}

function Example({
  entry,
  locale,
  demo,
}: {
  entry: PortalEntry;
  locale: Locale;
  demo: DemoDef | null;
}) {
  if (!entry.example) return null;
  if (['example-explorer', 'createExplorer', 'example-diagnostics'].includes(entry.id)) {
    const diagnostics = entry.id === 'example-diagnostics';
    return (
      <EngineExample
        locale={locale}
        diagnostic={diagnostics ? 'clusters' : 'beauty'}
        code={diagnostics ? engineDiagnosticsCode : engineExampleCode}
      />
    );
  }
  const scenario = apiScenario(entry.id, entry.section);
  const code = (
    <CodeBlock code={entry.example} locale={locale} label={t(locale, 'entry.example')} />
  );
  if (!scenario) return code;
  const example = examples.find(({ id }) => id === scenario);
  return (
    <ExampleLayout
      left={
        <div className="grid gap-6">
          {code}
          {demo && <LiveDemo demo={demo} locale={locale} />}
        </div>
      }
      right={
        <Card title={example.title[locale]}>
          <GeometryPreview id={scenario} locale={locale} related />
          <p>
            {locale === 'fr'
              ? 'Cet exemple associé illustre le concept avec ses propres paramètres.'
              : 'This related example illustrates the concept using its own parameters.'}
          </p>
          <a className="btn btn-primary" href={`#/${locale}/playground/${scenario}`}>
            {locale === 'fr' ? 'Tester les paramètres' : 'Try the parameters'}
          </a>
        </Card>
      }
    />
  );
}

export function Entry({ entry, locale = 'en' }: { entry: PortalEntry; locale?: Locale }) {
  const demo = demoFor(entry.id);
  const embedsDemo = Boolean(
    demo &&
    entry.example &&
    !['example-explorer', 'createExplorer', 'example-diagnostics'].includes(entry.id) &&
    apiScenario(entry.id, entry.section),
  );
  return (
    <article className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-soft badge-primary">{t(locale, `kind.${entry.kind}`)}</span>
          {entry.module && (
            <a className="link text-sm" href={`${REPOSITORY}/blob/develop/${entry.module}`}>
              {entry.module}
            </a>
          )}
        </div>
        <h1 className="text-3xl font-bold break-words">{entry.title || entry.id}</h1>
        <p>
          <Inline text={entry.description} />
        </p>
      </header>
      {entry.issue && (
        <Alert tone="warning">
          <span>
            {t(locale, 'common.inDevelopment')}:{' '}
            <a className="link" href={issueUrl(entry.issue)}>
              #{entry.issue}
            </a>
          </span>
        </Alert>
      )}
      {entry.html && <Prose html={entry.html} />}
      {entry.signature && (
        <CodeBlock code={entry.signature} locale={locale} label={t(locale, 'entry.signature')} />
      )}
      <Example entry={entry} locale={locale} demo={demo} />
      {(entry.values?.length ?? 0) > 0 && (
        <Card
          title={
            entry.valuesTitle ??
            t(locale, entry.kind === 'Type' ? 'entry.values' : 'entry.arguments')
          }
        >
          <Table>
            <tbody>
              {entry.values?.map((value) => (
                <tr key={value.name}>
                  <td className="font-mono font-semibold align-top">{value.name}</td>
                  <td>
                    <Inline text={value.desc} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {demo && !embedsDemo && <LiveDemo demo={demo} locale={locale} />}
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
    </article>
  );
}
