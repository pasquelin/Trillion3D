import { useEffect, useRef, useState } from 'react';
import roadmap from '../../content/gallery-roadmap.json' with { type: 'json' };
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { ExampleLayout } from '../components/ExampleLayout.tsx';
import { RenderFrame } from '../components/RenderFrame.tsx';

/** One example: its HTML file shown as source on the left, run by the engine on the right, in the
 * frame a lesson's canvas wears. The file is the whole example. */
export function Example({ id, locale }: { id: string; locale: Locale }) {
  const entry = roadmap.entries.find((candidate) => candidate.id === id)!;
  const [source, setSource] = useState('');
  const [running, setRunning] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(entry.file, { signal: controller.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then(setSource)
      .catch(() => {});
    return () => controller.abort();
  }, [entry.file]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const started = () => setRunning(true);
    // The prerendered iframe may have finished loading before this page was hydrated.
    if (element.contentDocument?.readyState === 'complete') started();
    element.addEventListener('load', started);
    return () => element.removeEventListener('load', started);
  }, [entry.file]);
  const title = local(entry.title, locale);
  return (
    <section data-example={id}>
      <h1 className="text-3xl font-bold mb-6">{title}</h1>
      <ExampleLayout
        left={<CodeBlock code={source} language="html" locale={locale} label={entry.file} />}
        right={
          <RenderFrame
            pending={!running}
            loadingLabel={locale === 'fr' ? 'Préparation de la scène…' : 'Preparing the scene…'}
          >
            <iframe ref={frame} src={entry.file} title={title} />
          </RenderFrame>
        }
      />
    </section>
  );
}
