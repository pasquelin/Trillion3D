import type { ReactNode } from 'react';
import { Card } from './UI.tsx';

interface ControlPanelProps {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** The control surface every interactive page shares: one wrapping row of fields, each as tall as
 * its own control, its buttons placed among them rather than on a row of their own. Lessons, the
 * playground and the engine scene all read the same way. */
export function ControlPanel({ title, children, className = '', ...props }: ControlPanelProps) {
  return (
    <Card title={title} className={`control-panel ${className}`} {...props}>
      <div className="control-panel-grid">{children}</div>
    </Card>
  );
}

/** The panel's buttons: placed by the caller among the fields, pushed to the end of their row. */
export function ControlActions({ children }: { children: ReactNode }) {
  return <div className="control-panel-actions">{children}</div>;
}

/** A field label carrying the control's current value, so a slider reads without guessing. */
export function ControlLabel({ label, value }: { label: ReactNode; value?: ReactNode }) {
  return (
    <span className="control-label">
      <span className="min-w-0">{label}</span>
      {value !== undefined && <span className="control-value">{value}</span>}
    </span>
  );
}
