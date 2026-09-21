import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import type { RendererLessonItem } from '../../lessons/rendererLessonTypes.ts';
import { LearningCards } from '../components/LearningCards.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { LessonTemplate } from '../components/LessonTemplate.tsx';
import { ApiBadges } from '../components/ApiBadges.tsx';
import { Alert } from '../components/UI.tsx';
import { rendererInitialState } from '../../lessons/rendererLessons.ts';
import { rendererCodeFor } from '../../lessons/rendererLessonCode.ts';
import { RendererControls, controlValue } from './RendererControls.tsx';
import { RendererViewport } from './RendererViewport.tsx';
import { local } from '../../content/locale.ts';

interface RendererLessonProps {
  lesson: RendererLessonItem;
  locale?: Locale;
  onSelect?: (id: string) => void;
}

export function RendererLesson({ lesson, locale = 'en', onSelect }: RendererLessonProps) {
  const initial = useMemo(() => rendererInitialState(lesson), [lesson]);
  const [state, setState] = useState(initial);
  const french = locale === 'fr';
  const title = local(lesson.title, locale);
  useEffect(() => setState(initial), [initial]);
  const controls = (
    <RendererControls
      lesson={lesson}
      locale={locale}
      state={state}
      setState={setState}
      onReset={() => setState(initial)}
      onSelect={onSelect}
    />
  );
  const cards = (
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
  );
  const code = (
    <>
      {lesson.warning && <Alert tone="warning">{local(lesson.warning, locale)}</Alert>}
      <CodeBlock code={rendererCodeFor(lesson, state)} locale={locale} />
    </>
  );
  const viewport = (
    <RendererViewport
      key={lesson.id}
      lesson={lesson}
      state={state}
      locale={locale}
      label={`${title} — WebGPU`}
    />
  );
  const badges = <ApiBadges names={lesson.functions} locale={locale} />;
  return (
    <LessonTemplate
      id={lesson.id}
      title={title}
      description={local(lesson.description, locale)}
      badges={badges}
      controls={controls}
      cards={cards}
      code={code}
      viewport={viewport}
    />
  );
}
