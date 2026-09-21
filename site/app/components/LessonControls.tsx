import type { ReactNode } from 'react';
import { Card, Field, Range, Select, Toggle } from './UI.tsx';

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

/** One control with its label and, for a slider, its value beside it. */
function ControlField({ control, className = '' }: { control: LessonControl; className?: string }) {
  if (control.label === undefined)
    return (
      <div className={className}>
        <Control control={control} />
      </div>
    );
  return (
    <Field
      className={`control-panel-field ${className}`}
      label={
        <span className="control-label">
          <span className="min-w-0">{control.label}</span>
          {control.kind === 'range' && control.display !== undefined && (
            <span className="control-value">{control.display}</span>
          )}
        </span>
      }
    >
      <Control control={control} />
    </Field>
  );
}

/** Every lesson's controls, on one fixed pattern: the first row carries the experiment picker the
 * page names and the panel's buttons, the second the lesson's own parameters, evenly spread. A
 * page says what it controls, never where it goes. */
export function LessonControls({
  title,
  picker,
  controls,
  actions,
}: {
  title?: ReactNode;
  picker?: LessonControl;
  controls: LessonControl[];
  actions?: ReactNode;
}) {
  return (
    <Card title={title} className="control-panel">
      <div className="control-panel-grid">
        <div className="control-panel-pick">
          {picker && <ControlField control={picker} className="control-panel-wide" />}
          {actions && <div className="control-panel-actions">{actions}</div>}
        </div>
        {controls.length > 0 && (
          <div className="control-panel-parameters">
            {controls.map((control) => (
              <ControlField key={control.id} control={control} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
