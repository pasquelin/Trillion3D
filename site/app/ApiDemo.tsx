import { useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber, localizedCanvasContext } from '../demos/kit.ts';
import { localizeDemoText } from '../content/i18n/demo.fr.ts';
import { Canvas } from './components/Canvas.tsx';
import { Section } from './components/Section.tsx';
import { Alert, Card, Field, Form, Range, Select } from './components/UI.tsx';
import type { Locale } from '../content/locale.ts';
import type {
  DemoControlDef,
  DemoDef,
  DemoViewItem,
  DrawingView,
  MatrixView,
} from './types/demo.ts';

const text = (value: unknown, locale: Locale): string =>
  localizeDemoText(String(value ?? ''), locale);

interface DemoControlProps {
  control: DemoControlDef;
  value: unknown;
  locale: Locale;
  onChange: (value: string | number) => void;
}

function DemoControl({ control, value, locale, onChange }: DemoControlProps) {
  const label = text(control.label, locale);
  if (control.kind === 'choice') {
    return (
      <Field label={label}>
        <Select
          size="sm"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          {control.options.map((option) => (
            <option value={option.value} key={String(option.value)}>
              {text(option.label, locale)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  const numericValue = Number(value ?? 0);
  return (
    <Field label={label} className="w-48">
      <Range
        min={control.min}
        max={control.max}
        step={control.step}
        value={numericValue}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="font-mono text-xs text-right">{formatNumber(numericValue)}</output>
    </Field>
  );
}

function Matrix({ view }: { view: MatrixView }) {
  const rows = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => view.values[column * 4 + row]),
  );
  return (
    <div className="overflow-x-auto">
      <table className="table table-xs w-auto">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((value, column) => (
                <td className="font-mono text-xs text-right" key={column}>
                  {formatNumber(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Drawing({ view, locale }: { view: DrawingView; locale: Locale }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = Math.max(1, element.clientWidth);
    element.height = view.height;
    const ctx = element.getContext('2d');
    if (ctx) {
      view.paint(localizedCanvasContext(ctx, locale), element.width, element.height);
    }
  }, [view, locale]);
  return (
    <Canvas
      canvasRef={canvas}
      label={text(view.title || 'Demo drawing', locale)}
      className="border border-base-300 bg-base-200"
      style={{ height: view.height }}
    />
  );
}

function DemoView({ view, locale }: { view: DemoViewItem; locale: Locale }) {
  let body;
  if (view.kind === 'matrix') {
    body = (
      <>
        <Matrix view={view} />
        {view.note && <p className="text-xs opacity-60">{text(view.note, locale)}</p>}
      </>
    );
  } else if (view.kind === 'values') {
    body = (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {view.rows.map((row, index) => (
          <div className="contents" key={`${row[0]}-${index}`}>
            <dt className="font-mono text-xs opacity-70">{text(row[0], locale)}</dt>
            <dd className="min-w-0 break-words font-mono text-xs">{text(row[1], locale)}</dd>
          </div>
        ))}
      </dl>
    );
  } else if (view.kind === 'verdict') {
    body = (
      <Alert tone={view.ok ? 'success' : 'error'}>
        <span className="badge badge-sm">{text(view.ok ? 'kept' : 'rejected', locale)}</span>
        <span>{text(view.text, locale)}</span>
      </Alert>
    );
  } else if (view.kind === 'swatch') {
    body = (
      <div className="flex flex-wrap gap-3">
        {view.swatches.map((swatch, index) => (
          <div className="text-xs" key={`${swatch.label}-${index}`}>
            <div
              className="w-24 h-12 rounded-box border border-base-300"
              style={{ background: swatch.css }}
            />
            <div className="font-mono mt-1 opacity-70">{text(swatch.label, locale)}</div>
          </div>
        ))}
      </div>
    );
  } else {
    body = <Drawing view={view} locale={locale} />;
  }
  return (
    <Card className="min-w-0" title={view.title ? text(view.title, locale) : undefined}>
      {body}
    </Card>
  );
}

export function ApiDemo({ demo, locale = 'en' }: { demo: DemoDef; locale?: Locale }) {
  const controls = demo.controls ?? [];
  const initial = (): Record<string, unknown> =>
    Object.fromEntries(controls.map((control) => [control.name, control.value]));
  const [state, setState] = useState<Record<string, unknown>>(initial);
  const views = useMemo(() => demo.run(state) ?? [], [demo, state]);
  return (
    <section className="api-demo">
      {controls.length > 0 && (
        <Section
          className="mb-4"
          title={locale === 'fr' ? 'Commandes de la démonstration' : 'Demo controls'}
        >
          <Form className="flex flex-wrap items-end">
            {controls.map((control) => (
              <DemoControl
                key={control.name}
                control={control}
                value={state[control.name]}
                locale={locale}
                onChange={(value) => setState((current) => ({ ...current, [control.name]: value }))}
              />
            ))}
          </Form>
        </Section>
      )}
      <div className="api-demo-results grid grid-cols-1 gap-4">
        {views.map((view, index) => (
          <DemoView view={view} locale={locale} key={`${view.kind}-${view.title ?? index}`} />
        ))}
      </div>
    </section>
  );
}
