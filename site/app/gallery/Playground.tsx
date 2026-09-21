import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import { LearningCards } from '../components/LearningCards.tsx';
import { CodeEditor } from '../components/CodeEditor.tsx';
import { formatNumericText } from '../code/formatNumber.ts';
import { LessonTemplate } from '../components/LessonTemplate.tsx';
import { Button } from '../components/UI.tsx';
import type { LessonControl } from '../components/LessonControls.tsx';
import { LessonControls } from '../components/LessonControls.tsx';
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
    <LessonControls
      title={french ? 'Commandes de l’expérience' : 'Experiment controls'}
      controls={[
        {
          kind: 'select',
          id: 'experiment',
          value: example.id,
          options: examples.map((item) => ({ value: item.id, label: local(item.title, locale) })),
          onChange: choose,
          props: { 'aria-label': french ? 'Choisir une expérience' : 'Choose an experiment' },
        },
        ...scenario.controls.map(([name, min, max, , step]): LessonControl => ({
          kind: 'range',
          id: name,
          label: controlLabel(name, locale),
          display: state[name],
          min,
          max,
          step,
          value: state[name],
          onChange: (value) => setState({ ...state, [name]: value }),
        })),
      ]}
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              motion.stop();
              setState(initialState(example.id));
            }}
          >
            {french ? 'Réinitialiser' : 'Reset'}
          </Button>
          <Button size="sm" variant="outline" onClick={motion.applyPreset}>
            {french ? 'Préréglage' : 'Preset'}
          </Button>
          {scenario.animated && (
            <Button size="sm" variant="primary" onClick={motion.toggle}>
              {motion.playing ? (french ? 'Pause' : 'Pause') : french ? 'Animer' : 'Animate'}
            </Button>
          )}
        </>
      }
    />
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
  const code = (
    <CodeEditor
      key={example.id}
      initialCode={initialCode}
      resetCode={() => codeFor(example.id, state)}
      locale={locale}
    />
  );
  const viewport = (
    <WebGPUCanvas
      id={example.id}
      state={state}
      locale={locale}
      animating={motion.playing}
      label={`${local(example.title, locale)} — 3D`}
    />
  );
  const note = (
    <>
      <p className="text-xs opacity-60">
        {french
          ? 'Illustration mathématique 3D ; la scène moteur montre le streaming réel.'
          : '3D mathematical illustration; the engine scene shows actual streaming.'}
      </p>
      <Diagram id={example.id} state={state} locale={locale} label={local(example.title, locale)} />
    </>
  );
  const badges = (example.functions ?? []).map((name: string) => (
    <a
      key={name}
      className="badge badge-soft badge-secondary font-mono"
      href={`#/${locale}/api/${name}`}
    >
      {name}
    </a>
  ));
  return (
    <div data-playground={example.id}>
      <LessonTemplate
        title={local(example.title, locale)}
        description={local(example.description, locale)}
        badges={badges}
        controls={controls}
        cards={cards}
        code={code}
        viewport={viewport}
        note={note}
      />
    </div>
  );
}
