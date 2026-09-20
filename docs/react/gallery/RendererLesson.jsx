import { LearningCards } from '../components/LearningCards.jsx';
import { Section } from '../components/Section.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { useEffect, useMemo, useState } from 'react';
import { CodeBlock } from '../components/CodeBlock.jsx';
import { ExampleLayout } from '../components/ExampleLayout.jsx';
import { Alert, Button, Field, Form, Range, Select, Toggle } from '../components/UI.jsx';
import { examples } from '../../js/gallery/catalog.js';
import { rendererInitialState } from '../../js/gallery/rendererLessons.js';
import { rendererCodeFor } from '../../js/gallery/rendererLessonCode.js';
import { RendererViewport } from './RendererViewport.jsx';
import { rawEntries } from '../../js/portal/data.js';

const local = (value, locale) => value[locale === 'fr' ? 'fr' : 'en'];
const documentedApi = new Set(rawEntries.map(({ id }) => id));
const controlValue = (item, state, french) => {
  const current = state[item.id] ?? item.value;
  if (item.type === 'boolean')
    return current === 1 ? (french ? 'Activé' : 'Enabled') : french ? 'Désactivé' : 'Disabled';
  return Number(current.toFixed(3));
};

export function RendererLesson({ lesson, locale = 'en', onSelect }) {
  const initial = useMemo(() => rendererInitialState(lesson), [lesson]),
    [state, setState] = useState(initial),
    french = locale === 'fr',
    title = local(lesson.title, locale);
  useEffect(() => setState(initial), [initial]);
  const left = (
    <div className="playground-learn grid gap-4">
      <Section>
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
          {lesson.controls.length > 0 && (
            <div className="flex flex-wrap gap-4">
              {lesson.controls.map((item) => (
                <Field key={item.id} label={local(item.label, locale)} className="grow">
                  {item.type === 'boolean' ? (
                    <Toggle
                      aria-label={local(item.label, locale)}
                      checked={(state[item.id] ?? item.value) === 1}
                      onChange={(event) =>
                        setState({ ...state, [item.id]: event.target.checked ? 1 : 0 })
                      }
                    />
                  ) : (
                    <Range
                      aria-label={local(item.label, locale)}
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={state[item.id] ?? item.value}
                      onChange={(event) =>
                        setState({ ...state, [item.id]: Number(event.target.value) })
                      }
                    />
                  )}
                </Field>
              ))}
            </div>
          )}
          {lesson.controls.length > 0 && (
            <Button size="sm" onClick={() => setState(initial)}>
              {french ? 'Réinitialiser' : 'Reset'}
            </Button>
          )}
        </Form>
      </Section>
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
    <section className="grid gap-5" data-renderer-playground={lesson.id}>
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
