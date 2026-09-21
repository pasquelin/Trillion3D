import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import { LearningCards } from '../components/LearningCards.tsx';
import { CodeEditor } from '../components/CodeEditor.tsx';
import { formatNumericText } from '../code/formatNumber.ts';
import { ExampleLayout } from '../components/ExampleLayout.tsx';
import { Section } from '../components/Section.tsx';
import { Button, Field, Form, Range, Select } from '../components/UI.tsx';
import { examples, byId } from '../../content/catalog.ts';
import { codeFor } from '../../lessons/code.ts';
import { evaluate } from '../../lessons/evaluate.ts';
import { guidanceFor } from '../../lessons/guidance.ts';
import { initialState, SCENARIOS } from '../../lessons/scenarios.ts';
import { Diagram } from './Diagram.tsx';
import { WebGPUCanvas } from './WebGPUCanvas.tsx';
import { controlLabel } from './controlLabels.ts';
import { usePlaygroundMotion } from './usePlaygroundMotion.ts';
import { rendererLessonById } from '../../lessons/rendererLessons.ts';
import { RendererLesson } from './RendererLesson.tsx';
import { local } from '../../content/locale.ts';

interface PlaygroundProps {
  id: string;
  locale?: Locale;
  onSelect?: (id: string) => void;
}

export function Playground({ id, locale = 'en', onSelect }: PlaygroundProps) {
  const rendererLesson = rendererLessonById(id);
  if (rendererLesson)
    return (
      <RendererLesson
        key={rendererLesson.id}
        lesson={rendererLesson}
        locale={locale}
        onSelect={onSelect}
      />
    );
  return <MathPlayground id={id} locale={locale} onSelect={onSelect} />;
}

function MathPlayground({ id, locale = 'en', onSelect }: PlaygroundProps) {
  const example = byId(id),
    scenario = SCENARIOS[example.id],
    [state, setState] = useState<Record<string, number>>(() => initialState(example.id));
  useEffect(() => setState(initialState(example.id)), [example.id]);
  const result = useMemo(() => evaluate(example.id, state, locale), [example.id, state, locale]),
    guidance = guidanceFor(example.id, locale),
    french = locale === 'fr',
    initialCode = useMemo(() => codeFor(example.id, initialState(example.id)), [example.id]);
  const motion = usePlaygroundMotion(scenario, setState);
  const choose = (next: string) => {
    setState(initialState(next));
    onSelect?.(next);
  };
  const controls = (
    <Section
      className="playground-controls"
      title={french ? 'Commandes de l’expérience' : 'Experiment controls'}
    >
      <Form>
        <Field label={french ? 'Expérience' : 'Experiment'}>
          <Select
            size="sm"
            value={example.id}
            onChange={(event) => choose(event.target.value)}
            aria-label={french ? 'Choisir une expérience' : 'Choose an experiment'}
          >
            {examples.map((item) => (
              <option key={item.id} value={item.id}>
                {local(item.title, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-4">
          {scenario.controls.map(([name, min, max, , step]) => (
            <Field key={name} label={controlLabel(name, locale)} className="grow">
              <Range
                aria-label={controlLabel(name, locale)}
                min={min}
                max={max}
                step={step}
                value={state[name]}
                onChange={(event) => setState({ ...state, [name]: Number(event.target.value) })}
              />
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              motion.stop();
              setState(initialState(example.id));
            }}
          >
            {french ? 'Réinitialiser' : 'Reset'}
          </Button>
          <Button size="sm" onClick={motion.applyPreset}>
            {french ? 'Préréglage' : 'Preset'}
          </Button>
          {scenario.animated && (
            <Button size="sm" variant="primary" onClick={motion.toggle}>
              {motion.playing ? (french ? 'Pause' : 'Pause') : french ? 'Animer' : 'Animate'}
            </Button>
          )}
        </div>
      </Form>
    </Section>
  );
  const cards = (
    <LearningCards
      input={formatNumericText(result.input)}
      output={formatNumericText(result.value)}
      attempt={guidance.try}
      changes={guidance.changes}
      locale={locale}
    />
  );
  const left = (
    <div className="playground-learn grid gap-4">
      {controls}
      {cards}
      <CodeEditor
        key={example.id}
        initialCode={initialCode}
        resetCode={() => codeFor(example.id, state)}
        locale={locale}
      />
    </div>
  );
  const right = (
    <div className="playground-observe">
      <WebGPUCanvas
        id={example.id}
        state={state}
        locale={locale}
        animating={motion.playing}
        label={`${local(example.title, locale)} — 3D`}
      />
      <p className="text-xs opacity-60 mt-2">
        {french
          ? 'Illustration mathématique 3D ; la scène moteur montre le streaming réel.'
          : '3D mathematical illustration; the engine scene shows actual streaming.'}
      </p>
    </div>
  );
  return (
    <section className="grid gap-5" data-playground={example.id}>
      <header>
        <h1 className="text-3xl font-bold">{local(example.title, locale)}</h1>
        <p className="opacity-70 mt-2">{local(example.description, locale)}</p>
      </header>
      <ExampleLayout
        left={left}
        right={right}
        footer={
          <>
            <Diagram
              id={example.id}
              state={state}
              locale={locale}
              label={local(example.title, locale)}
            />
            <div className="flex flex-wrap gap-2 mt-4">
              {example.functions.map((name: string) => (
                <a
                  key={name}
                  className="badge badge-soft badge-secondary font-mono"
                  href={`#/${locale}/api/${name}`}
                >
                  {name}
                </a>
              ))}
            </div>
          </>
        }
      />
    </section>
  );
}
