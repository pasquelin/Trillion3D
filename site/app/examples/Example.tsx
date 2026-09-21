import { useEffect, useState } from 'react';
import roadmap from '../../content/gallery-roadmap.json';
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { ExampleLayout } from '../components/ExampleLayout.tsx';

/** One example: its HTML file shown as source on the left, run by the engine in an iframe on
 * the right. The file is the whole example. */
export function Example({ id, locale }: { id: string; locale: Locale }) {
  const entry = roadmap.entries.find((candidate) => candidate.id === id)!;
  const [source, setSource] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(entry.file, { signal: controller.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then(setSource)
      .catch(() => {});
    return () => controller.abort();
  }, [entry.file]);
  const title = local(entry.title, locale);
  return (
    <section data-example={id}>
      <h1 className="text-3xl font-bold mb-6">{title}</h1>
      <ExampleLayout
        left={<CodeBlock code={source} language="html" locale={locale} label={entry.file} />}
        right={<iframe className="example-frame" src={entry.file} title={title} />}
      />
    </section>
  );
}
