import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import type {
  RendererLessonControl,
  RendererLessonItem,
} from '../../lessons/rendererLessonTypes.ts';
import { LearningCards } from '../components/LearningCards.tsx';
import { Section } from '../components/Section.tsx';
import { SectionHeader } from '../components/SectionHeader.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { ExampleLayout } from '../components/ExampleLayout.tsx';
import { Alert, Button, Field, Form, Range, Select, Toggle } from '../components/UI.tsx';
import { examples } from '../../content/catalog.ts';
import { rendererInitialState } from '../../lessons/rendererLessons.ts';
import { rendererCodeFor } from '../../lessons/rendererLessonCode.ts';
import { RendererViewport } from './RendererViewport.tsx';
import { rawEntries } from '../portal/data.ts';
import { local } from '../../content/locale.ts';

const documentedApi = new Set(rawEntries.map(({ id }) => id));

const controlValue = (
  item: RendererLessonControl,
  state: Record<string, number>,
  french: boolean,
): string | number => {
  const current = state[item.id] ?? item.value;
  if (item.type === 'boolean')
    return current === 1 ? (french ? 'Activé' : 'Enabled') : french ? 'Désactivé' : 'Disabled';
  return Number(current.toFixed(3));
};

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
                    <div className="grid gap-2">
                      <Toggle
                        aria-label={local(item.label, locale)}
                        checked={(state[item.id] ?? item.value) === 1}
                        onChange={(event) =>
                          setState({ ...state, [item.id]: event.target.checked ? 1 : 0 })
                        }
                      />
                      {item.legend && (
                        <ul className="flex flex-wrap gap-3 text-xs">
                          {item.legend.map((entry) => (
                            <li key={entry.color} className="flex items-center gap-1.5">
                              <span
                                className="size-2.5 rounded-full"
                                style={{ backgroundColor: entry.color }}
                                aria-hidden="true"
                              />
                              {local(entry.label, locale)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
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
