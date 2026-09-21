import { useEffect, useRef } from 'react';
import type { Locale } from '../../content/locale.ts';
import type { DiagnosticMode } from '../../lessons/engine-scene/diagnosticModes.ts';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { ExampleLayout } from '../components/ExampleLayout.tsx';
import { Alert } from '../components/UI.tsx';
import { engineExampleCode } from '../../lessons/engine-scene/code.ts';
import { mountScene } from '../../lessons/engine-scene/lifecycle.ts';
import { EnginePreview, engineCopy } from './EnginePreview.tsx';
import { EngineStats } from './Stats.tsx';
import { EngineGuide } from './Guide.tsx';

interface EngineExampleProps {
  locale?: Locale;
  diagnostic?: DiagnosticMode;
  code?: string;
}

export function EngineExample({
  locale = 'en',
  diagnostic = 'beauty',
  code = engineExampleCode,
}: EngineExampleProps) {
  const host = useRef<HTMLDivElement>(null);
  const copy = engineCopy(locale);
  useEffect(() => {
    if (host.current) {
      return mountScene(host.current, copy, locale);
    }
  }, [locale, diagnostic]);
  return (
    <div ref={host}>
      <ExampleLayout
        left={
          <section>
            <h2 className="text-2xl font-semibold mb-4">{copy.code}</h2>
            <CodeBlock code={code} locale={locale} label={copy.code} />
          </section>
        }
        right={<EnginePreview locale={locale} diagnostic={diagnostic} />}
        footer={
          <>
            <EngineStats copy={copy} />
            <EngineGuide copy={copy} locale={locale} diagnostic={diagnostic} />
          </>
        }
      />
    </div>
  );
}

export function EngineScene({ locale = 'en' }: { locale?: Locale }) {
  const copy = engineCopy(locale);
  return (
    <section>
      <span className="badge badge-soft badge-success">{copy.label}</span>
      <h1 className="text-4xl font-bold mt-4">{copy.title}</h1>
      <p className="text-lg mt-4">{copy.intro}</p>
      <Alert className="my-6">
        <span>{copy.try}</span>
      </Alert>
      <EngineExample locale={locale} />
      <section className="mt-8">
        <h2 className="text-2xl font-semibold">{copy.learn}</h2>
        <ol className="list-decimal pl-6 mt-4 space-y-3">
          {copy.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <a
          className="link link-primary inline-block mt-6"
          href="https://github.com/pasquelin/WebGeometry/blob/develop/scripts/docs/garden-source.mjs"
        >
          {copy.source}
        </a>
      </section>
    </section>
  );
}
