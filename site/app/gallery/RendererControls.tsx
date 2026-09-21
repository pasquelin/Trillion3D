import type { Locale } from '../../content/locale.ts';
import { local } from '../../content/locale.ts';
import type {
  RendererLessonControl,
  RendererLessonItem,
} from '../../lessons/rendererLessonTypes.ts';
import { examples } from '../../content/catalog.ts';
import { ControlActions, ControlLabel, ControlPanel } from '../components/ControlPanel.tsx';
import { Button, Field, Range, Select, Toggle } from '../components/UI.tsx';

export const controlValue = (
  item: RendererLessonControl,
  state: Record<string, number>,
  french: boolean,
): string | number => {
  const current = state[item.id] ?? item.value;
  if (item.type === 'boolean')
    return current === 1 ? (french ? 'Activé' : 'Enabled') : french ? 'Désactivé' : 'Disabled';
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

/** The experiment picker and the lesson's own controls, on the shared control panel. */
export function RendererControls({
  lesson,
  locale,
  state,
  setState,
  onReset,
  onSelect,
}: RendererControlsProps) {
  const french = locale === 'fr';
  return (
    <ControlPanel>
      <Field
        className="control-panel-wide"
        label={french ? 'Expérience' : 'Experiment'}
        data-control="experiment"
      >
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
        <ControlActions>
          <Button size="sm" variant="outline" onClick={onReset}>
            {french ? 'Réinitialiser' : 'Reset'}
          </Button>
        </ControlActions>
      )}
      {lesson.controls.map((item) => (
        <Field
          key={item.id}
          className={item.type === 'boolean' ? 'control-panel-toggle' : ''}
          data-control={item.id}
          label={
            <ControlLabel
              label={local(item.label, locale)}
              value={item.type === 'boolean' ? undefined : controlValue(item, state, french)}
            />
          }
        >
          {item.type === 'boolean' ? (
            <div className="control-toggle">
              <Toggle
                aria-label={local(item.label, locale)}
                checked={(state[item.id] ?? item.value) === 1}
                onChange={(event) =>
                  setState({ ...state, [item.id]: event.target.checked ? 1 : 0 })
                }
              />
              {item.legend && (
                <ul className="control-legend">
                  {item.legend.map((entry) => (
                    <li key={entry.color}>
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
              onChange={(event) => setState({ ...state, [item.id]: Number(event.target.value) })}
            />
          )}
        </Field>
      ))}
    </ControlPanel>
  );
}
