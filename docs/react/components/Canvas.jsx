import { Button } from './UI.jsx';
import { Loading } from './Loading.jsx';

export function Canvas({
  label,
  className = '',
  canvasRef,
  actions = [],
  pending = false,
  loadingLabel,
  ...props
}) {
  const contents = (
    <>
      <canvas
        ref={canvasRef}
        aria-label={label}
        className={`block w-full rounded-box ${className}`}
        {...props}
      />
      {pending && <Loading label={loadingLabel} />}
      {actions.length > 0 && (
        <div className="canvas-actions absolute top-3 right-3 z-20 join rounded-box bg-base-100/90 shadow-sm">
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
  return actions.length || pending ? (
    <div className="engine-canvas-frame relative min-w-0">{contents}</div>
  ) : (
    contents
  );
}
