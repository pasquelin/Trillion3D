import { useEffect, useRef } from 'react';
import { CodeBlock } from '../components/CodeBlock.jsx';
import { ExampleLayout } from '../components/ExampleLayout.jsx';
import { Alert } from '../components/UI.jsx';
import { engineExampleCode } from '../../js/engine-scene/code.js';
import { sceneCopy } from '../../js/engine-scene/content.js';
import { mountScene } from '../../js/engine-scene/lifecycle.js';
import { EnginePreview, engineCopy } from './EnginePreview.jsx';
import { EngineStats } from './Stats.jsx';
import { EngineGuide } from './Guide.jsx';

export function EngineExample({ locale = 'en', diagnostic = 'beauty', code = engineExampleCode }) {
  const host = useRef(null),
    copy = engineCopy(locale);
  useEffect(
    () => mountScene(host.current, sceneCopy[locale] ?? sceneCopy.en, locale),
    [locale, diagnostic],
  );
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

export function EngineScene({ locale = 'en' }) {
  const copy = sceneCopy[locale] ?? sceneCopy.en;
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
