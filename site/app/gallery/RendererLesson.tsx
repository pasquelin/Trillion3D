import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import type { RendererLessonItem } from '../../lessons/rendererLessonTypes.ts';
import { LearningCards } from '../components/LearningCards.tsx';
import { SectionHeader } from '../components/SectionHeader.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { ExampleLayout } from '../components/ExampleLayout.tsx';
import { Alert } from '../components/UI.tsx';
import { rendererInitialState } from '../../lessons/rendererLessons.ts';
import { rendererCodeFor } from '../../lessons/rendererLessonCode.ts';
import { RendererControls, controlValue } from './RendererControls.tsx';
import { RendererViewport } from './RendererViewport.tsx';
import { rawEntries } from '../portal/data.ts';
import { local } from '../../content/locale.ts';

const documentedApi = new Set(rawEntries.map(({ id }) => id));

interface RendererLessonProps {
  lesson: RendererLessonItem;
  locale?: Locale;
  onSelect?: (id: string) => void;
}

export function RendererLesson({ lesson, locale = 'en', onSelect }: RendererLessonProps) {
  const initial: Record<string, number> = useMemo(() => rendererInitialState(lesson), [lesson]);
  const [state, setState] = useState<Record<string, number>>(initial);
  const french = locale === 'fr';
  const title = local(lesson.title, locale);
  useEffect(() => setState(initial), [initial]);
  const left = (
    <div className="playground-learn grid gap-4">
      <RendererControls
        lesson={lesson}
        locale={locale}
        state={state}
        setState={setState}
        onReset={() => setState(initial)}
        onSelect={onSelect}
      />
      <LearningCards
        input={
          lesson.controls.length
            ? lesson.controls
                .map((item) => `${local(item.label, locale)}: ${controlValue(item, state, french)}`)
                .join(' · ')
            : french
              ? 'Géométrie préparée avant compilation.'
              : 'Geometry authored before compilation.'
        }
        output={
          french
            ? 'Image calculée par le backend WebGPU public.'
            : 'Image computed by the public WebGPU backend.'
        }
        attempt={local(lesson.try, locale)}
        changes={local(lesson.changes, locale)}
        locale={locale}
      />
      {lesson.warning && <Alert tone="warning">{local(lesson.warning, locale)}</Alert>}
      <CodeBlock code={rendererCodeFor(lesson, state)} locale={locale} />
      {lesson.constructionCode && (
        <CodeBlock
          code={lesson.constructionCode}
          locale={locale}
          label={french ? 'Construction hors ligne (Node.js)' : 'Offline construction (Node.js)'}
        />
      )}
    </div>
  );
  const right = (
    <RendererViewport
      key={lesson.id}
      lesson={lesson}
      state={state}
      locale={locale}
      label={`${title} — WebGPU`}
    />
  );
  return (
    <section className="lesson-layout grid gap-5" data-renderer-playground={lesson.id}>
      <SectionHeader title={title} description={local(lesson.description, locale)} level={1} />
      <ExampleLayout
        left={left}
        right={right}
        footer={
          <div className="flex flex-wrap gap-2">
            {lesson.functions.map((name) =>
              documentedApi.has(name) ? (
                <a
                  key={name}
                  className="badge badge-soft badge-secondary font-mono"
                  href={`#/${locale}/api/${name}`}
                >
                  {name}
                </a>
              ) : (
                <code key={name} className="badge badge-soft badge-secondary">
                  {name}
                </code>
              ),
            )}
          </div>
        }
      />
    </section>
  );
}
