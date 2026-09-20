import { useMemo, useState } from 'react';
import { CodeBlock } from '../components/CodeBlock.jsx';
import { ExampleLayout } from '../components/ExampleLayout.jsx';
import { Alert, Button, Field, Form, Range, Select } from '../components/UI.jsx';
import { examples } from '../../js/gallery/catalog.js';
import { rendererInitialState } from '../../js/gallery/rendererLessons.js';
import { rendererCodeFor } from '../../js/gallery/rendererLessonCode.js';
import { RendererViewport } from './RendererViewport.jsx';

const local = (value, locale) => value[locale === 'fr' ? 'fr' : 'en'];

function LearningCards({ lesson, state, locale }) {
  const french = locale === 'fr';
  return (
    <div className="playground-cards grid gap-3 sm:grid-cols-2">
      <Alert>
        <Content title={french ? 'Entrée' : 'Input'}>
          {lesson.controls
            .map((item) => `${local(item.label, locale)}: ${state[item.id]}`)
            .join(' · ')}
        </Content>
      </Alert>
      <Alert>
        <Content title={french ? 'Sortie moteur' : 'Engine output'}>
          {french
            ? 'Image calculée par le backend WebGPU public.'
            : 'Image computed by the public WebGPU backend.'}
        </Content>
      </Alert>
      <Alert>
        <Content title={french ? 'À essayer' : 'What to try'}>{local(lesson.try, locale)}</Content>
      </Alert>
      <Alert>
        <Content title={french ? 'Ce qui change' : 'What changes'}>
          {local(lesson.changes, locale)}
        </Content>
      </Alert>
    </div>
  );
}

export function RendererLesson({ lesson, locale = 'en', onSelect }) {
  const initial = useMemo(() => rendererInitialState(lesson), [lesson]),
    [state, setState] = useState(initial),
    french = locale === 'fr',
    title = local(lesson.title, locale);
  const left = (
    <div className="playground-learn grid gap-4">
      <Form>
        <Field label={french ? 'Expérience' : 'Experiment'}>
          <Select
            size="sm"
            value={lesson.id}
            aria-label={french ? 'Choisir une expérience' : 'Choose an experiment'}
            onChange={(event) => onSelect?.(event.target.value)}
          >
            {examples.map((example) => (
              <option key={example.id} value={example.id}>
                {local(example.title, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-4">
          {lesson.controls.map((item) => (
            <Field key={item.id} label={local(item.label, locale)} className="grow">
              <Range
                aria-label={local(item.label, locale)}
                min={item.min}
                max={item.max}
                step={item.step}
                value={state[item.id]}
                onChange={(event) => setState({ ...state, [item.id]: Number(event.target.value) })}
              />
            </Field>
          ))}
        </div>
        <Button size="sm" onClick={() => setState(initial)}>
          {french ? 'Réinitialiser' : 'Reset'}
        </Button>
      </Form>
      <LearningCards lesson={lesson} state={state} locale={locale} />
      <CodeBlock code={rendererCodeFor(lesson, state)} locale={locale} />
    </div>
  );
  const right = (
    <RendererViewport lesson={lesson} state={state} locale={locale} label={`${title} — WebGPU`} />
  );
  return (
    <section className="grid gap-5" data-renderer-playground={lesson.id}>
      <header>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="opacity-70 mt-2">{local(lesson.description, locale)}</p>
      </header>
      <ExampleLayout
        left={left}
        right={right}
        footer={
          <div className="flex flex-wrap gap-2">
            {lesson.functions.map((name) => (
              <a
                key={name}
                className="badge badge-soft badge-secondary font-mono"
                href={`#/${locale}/api/${name}`}
              >
                {name}
              </a>
            ))}
          </div>
        }
      />
    </section>
  );
}

function Content({ title, children }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase opacity-60">{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
