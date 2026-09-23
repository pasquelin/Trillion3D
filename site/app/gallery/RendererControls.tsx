import { useWords, wordsOf } from '../i18n.ts';
import type { Locale } from '../../content/locale.ts';
import { local } from '../../content/locale.ts';
import type {
  RendererLessonControl,
  RendererLessonItem,
} from '../../lessons/rendererLessonTypes.ts';
import type { LessonControl } from '../ui/LessonControls.tsx';
import { LessonControls } from '../ui/LessonControls.tsx';
import { experimentPicker } from './experimentPicker.ts';
import { Button } from '../ui/Button.tsx';

export const controlValue = (
  item: RendererLessonControl,
  state: Record<string, number>,
  locale: Locale,
): string | number => {
  const current = state[item.id] ?? item.value;
  if (item.type === 'boolean')
    return wordsOf(locale)(current === 1 ? 'playground.enabled' : 'playground.disabled');
  return Number(current.toFixed(3));
};

interface RendererControlsProps {
  lesson: RendererLessonItem;
  locale: Locale;
  state: Record<string, number>;
  setState: (next: Record<string, number>) => void;
  onReset: () => void;
  onSelect?: (id: string) => void;
}

/** The experiment picker and the lesson's own controls, described for the shared renderer. */
export function RendererControls({
  lesson,
  locale,
  state,
  setState,
  onReset,
  onSelect,
}: RendererControlsProps) {
  const t = useWords(locale);
  const controls: LessonControl[] = lesson.controls.map((item): LessonControl => {
    const label = local(item.label, locale);
    if (item.type === 'boolean')
      return {
        kind: 'toggle',
        id: item.id,
        label,
        checked: (state[item.id] ?? item.value) === 1,
        onChange: (checked) => setState({ ...state, [item.id]: checked ? 1 : 0 }),
        legend: item.legend?.map((entry) => ({
          color: entry.color,
          label: local(entry.label, locale),
        })),
      };
    return {
      kind: 'range',
      id: item.id,
      label,
      display: controlValue(item, state, locale),
      min: item.min,
      max: item.max,
      step: item.step,
      value: state[item.id] ?? item.value,
      onChange: (value) => setState({ ...state, [item.id]: value }),
    };
  });
  return (
    <LessonControls
      picker={experimentPicker(lesson.id, locale, onSelect)}
      controls={controls}
      actions={
        lesson.controls.length > 0 && (
          <Button size="sm" variant="outline" onClick={onReset}>
            {t('playground.reset')}
          </Button>
        )
      }
    />
  );
}
