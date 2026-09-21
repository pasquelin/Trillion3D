import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { Button } from './UI.tsx';
import { Loading } from './Loading.tsx';

interface CanvasAction extends Omit<ComponentPropsWithoutRef<'button'>, 'title' | 'aria-label'> {
  label: string;
  symbol: ReactNode;
  [key: `data-${string}`]: unknown;
}

interface CanvasProps extends ComponentPropsWithoutRef<'canvas'> {
  label?: string;
  canvasRef?: Ref<HTMLCanvasElement>;
  actions?: CanvasAction[];
  pending?: boolean;
  loadingLabel?: string;
  overlay?: ReactNode;
}

export function Canvas({
  label,
  className = '',
  canvasRef,
  actions = [],
  pending = false,
  loadingLabel,
  overlay,
  ...props
}: CanvasProps) {
  const contents = (
    <>
      <canvas
        ref={canvasRef}
        aria-label={label}
        aria-busy={pending || undefined}
        className={`block w-full rounded-box ${pending ? 'invisible' : ''} ${className}`}
        {...props}
      />
      {pending && <Loading label={loadingLabel} />}
      {overlay && <div className="canvas-overlay absolute top-3 left-3 z-20">{overlay}</div>}
      {actions.length > 0 && (
        <div className="canvas-overlay absolute top-3 right-3 z-20 join rounded-box bg-base-100/90 shadow-sm">
          {actions.map(({ label: actionLabel, symbol, ...buttonProps }) => (
            <Button
              key={actionLabel}
              size="sm"
              className="join-item"
              title={actionLabel}
              aria-label={actionLabel}
              {...buttonProps}
              disabled={pending || buttonProps.disabled}
            >
              {symbol}
            </Button>
          ))}
        </div>
      )}
    </>
  );
  return actions.length || pending || overlay ? (
    <div className="engine-canvas-frame relative min-w-0">{contents}</div>
  ) : (
    contents
  );
}
