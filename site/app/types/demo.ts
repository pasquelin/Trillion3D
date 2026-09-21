interface DemoSliderControl {
  kind?: 'slider';
  name: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
}

interface DemoChoiceOption {
  value: string | number;
  label: string;
}

interface DemoChoiceControl {
  kind: 'choice';
  name: string;
  label: string;
  options: DemoChoiceOption[];
  value: string | number;
}

export type DemoControlDef = DemoSliderControl | DemoChoiceControl;

export interface MatrixView {
  kind: 'matrix';
  title?: string;
  values: number[];
  note?: string;
}

interface ValuesView {
  kind: 'values';
  title?: string;
  rows: [string, string | number][];
}

interface VerdictView {
  kind: 'verdict';
  title?: string;
  ok: boolean;
  text: string;
}

interface SwatchItem {
  label: string;
  css: string;
}

interface SwatchView {
  kind: 'swatch';
  title?: string;
  swatches: SwatchItem[];
}

export interface DrawingView {
  kind: 'canvas';
  title?: string;
  height: number;
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

export type DemoViewItem = MatrixView | ValuesView | VerdictView | SwatchView | DrawingView;

export interface DemoDef {
  controls?: DemoControlDef[];
  run: (state: Record<string, unknown>) => DemoViewItem[];
}
