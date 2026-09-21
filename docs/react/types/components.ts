import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';

interface CanvasAction extends Omit<ComponentPropsWithoutRef<'button'>, 'title' | 'aria-label'> {
  label: string;
  symbol: ReactNode;
  [key: `data-${string}`]: unknown;
}

export interface CanvasProps extends ComponentPropsWithoutRef<'canvas'> {
  label?: string;
  canvasRef?: Ref<HTMLCanvasElement>;
  actions?: CanvasAction[];
  pending?: boolean;
  loadingLabel?: string;
}

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

export interface CardProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: ReactNode;
  surface?: 'default' | 'nested' | 'inset';
}

export interface AlertProps extends ComponentPropsWithoutRef<'div'> {
  tone?: 'info' | 'success' | 'warning' | 'error';
}

export interface FieldProps extends ComponentPropsWithoutRef<'fieldset'> {
  label: ReactNode;
}

export type FormProps = ComponentPropsWithoutRef<'fieldset'>;

export interface SelectProps extends Omit<ComponentPropsWithoutRef<'select'>, 'size'> {
  size?: 'sm' | 'md';
}

export type RangeProps = ComponentPropsWithoutRef<'input'>;

export type ToggleProps = ComponentPropsWithoutRef<'input'>;

export type StatGroupProps = ComponentPropsWithoutRef<'div'>;

export interface StatProps {
  title: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  valueProps?: ComponentPropsWithoutRef<'div'> & Record<string, unknown>;
  descriptionProps?: ComponentPropsWithoutRef<'div'> & Record<string, unknown>;
}

export type ChartTone =
  'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

interface BarChartRow {
  id?: string | number;
  label: ReactNode;
  value: number | null;
  missing?: string;
  tone?: ChartTone | string;
  status?: ReactNode;
  p95?: number | null;
}

export interface BarChartProps {
  title: ReactNode;
  note?: ReactNode;
  rows: BarChartRow[];
  format: (value: number) => string;
  missingLabel?: string;
}

export interface ModuleExecutionResult {
  ok: boolean;
  kind?: 'cancelled' | 'timeout';
  text?: string;
}

export interface ModuleExecutionTask {
  promise: Promise<ModuleExecutionResult>;
  cancel: () => void;
}

export interface CodeEditorProps {
  initialCode: string;
  resetCode: () => string;
  locale?: string;
}

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

export interface CodeSurfaceProps {
  code: string;
  locale?: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export interface ProgressiveRange {
  start: number;
  end: number;
}

export interface ProgressiveListState {
  start: number;
  end: number;
  heights?: Record<string | number, number>;
}

interface ProgressiveListLabels {
  previous: ReactNode;
  next: ReactNode;
  loading: ReactNode;
  end: ReactNode;
}

export interface ProgressiveListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  batchSize?: number;
  maxBatches?: number;
  initialState?: ProgressiveListState;
  labels: ProgressiveListLabels;
  onStateChange?: (state: ProgressiveListState) => void;
}

export interface StickyPanelProps {
  controls: ReactNode;
  children: ReactNode;
  sticky?: boolean;
}

interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  render: () => ReactNode;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  sticky?: boolean;
  accessory?: ReactNode;
}

interface TabsMenuOption {
  value: string;
  label: string;
}

export interface TabsMenuProps {
  value: string;
  options: TabsMenuOption[];
  primary?: string[];
  allLabel: string;
  moreLabel: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
}
