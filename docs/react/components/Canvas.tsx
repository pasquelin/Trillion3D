import type { CanvasProps } from '../types/components.ts';
import { Button } from './UI.tsx';
import { Loading } from './Loading.tsx';

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
