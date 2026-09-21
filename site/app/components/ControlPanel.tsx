import type { ReactNode } from 'react';
import { Card } from './UI.tsx';

interface ControlPanelProps {
  title?: ReactNode;
  /** Buttons closing the panel: shown as its last cell, small and aligned to the end. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** The control surface every interactive page shares: one dense grid of fields, each field as
 * tall as its own control, and the panel's buttons in the grid rather than on a row of their
 * own. Lessons, the playground and the engine scene all read the same way. */
export function ControlPanel({ title, actions, children, className = '' }: ControlPanelProps) {
  return (
    <Card title={title} className={`control-panel ${className}`}>
      <div className="control-panel-grid">
        {children}
        {actions && <div className="control-panel-actions">{actions}</div>}
      </div>
    </Card>
  );
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
