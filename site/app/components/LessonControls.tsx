import type { ReactNode } from 'react';
import { ControlActions, ControlLabel, ControlPanel } from './ControlPanel.tsx';
import { Field, Range, Select, Toggle } from './UI.tsx';

interface Common {
  id: string;
  label?: ReactNode;
  /** Extra DOM attributes a page needs on the input itself (data hooks, disabled…). */
  props?: Record<string, unknown>;
}

export type LessonControl =
  | (Common & {
      kind: 'select';
      value?: string;
      defaultValue?: string;
      options: { value: string; label: ReactNode }[];
      onChange?: (value: string) => void;
    })
  | (Common & {
      kind: 'range';
      value?: number;
      defaultValue?: number;
      display?: ReactNode;
      min: number;
      max: number;
      step: number;
      onChange?: (value: number) => void;
    })
  | (Common & {
      kind: 'toggle';
      checked?: boolean;
      defaultChecked?: boolean;
      legend?: { color: string; label: ReactNode }[];
      onChange?: (checked: boolean) => void;
    });

const name = (control: LessonControl): string =>
  typeof control.label === 'string' ? control.label : control.id;

function Control({ control }: { control: LessonControl }) {
  if (control.kind === 'select')
    return (
      <Select
        size="sm"
        aria-label={name(control)}
        value={control.value}
        defaultValue={control.defaultValue}
        onChange={(event) => control.onChange?.(event.target.value)}
        {...control.props}
      >
        {control.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  if (control.kind === 'range')
    return (
      <Range
        aria-label={name(control)}
        min={control.min}
        max={control.max}
        step={control.step}
        value={control.value}
        defaultValue={control.defaultValue}
        onChange={(event) => control.onChange?.(Number(event.target.value))}
        {...control.props}
      />
    );
  return (
    <div className="control-toggle">
      <Toggle
        aria-label={name(control)}
        checked={control.checked}
        defaultChecked={control.defaultChecked}
        onChange={(event) => control.onChange?.(event.target.checked)}
        {...control.props}
      />
      {control.legend && (
        <ul className="control-legend">
          {control.legend.map((entry) => (
            <li key={entry.color}>
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
                aria-hidden="true"
              />
              {entry.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every lesson's controls, rendered from one description: same field, same label, same value
 * beside it, same order — a page says what it controls, never how it looks. */
export function LessonControls({
  title,
  controls,
  actions,
}: {
  title?: ReactNode;
  controls: LessonControl[];
  actions?: ReactNode;
}) {
  return (
    <ControlPanel title={title}>
      {controls.map((control) =>
        control.label === undefined ? (
          <div key={control.id} className="control-panel-wide" data-control={control.id}>
            <Control control={control} />
          </div>
        ) : (
          <Field
            key={control.id}
            className={control.kind === 'toggle' ? 'control-panel-toggle' : ''}
            data-control={control.id}
            label={
              <ControlLabel
                label={control.label}
                value={control.kind === 'range' ? control.display : undefined}
              />
            }
          >
            <Control control={control} />
          </Field>
        ),
      )}
      {actions && <ControlActions>{actions}</ControlActions>}
    </ControlPanel>
  );
}
