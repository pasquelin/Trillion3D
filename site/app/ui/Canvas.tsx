import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { Button } from './Button.tsx';
import { RenderFrame } from './RenderFrame.tsx';

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
  const surface = (
    <canvas
      ref={canvasRef}
      aria-label={label}
      aria-busy={pending || undefined}
      className={`block w-full rounded-box ${pending ? 'invisible' : ''} ${className}`}
      {...props}
    />
  );
  if (!actions.length && !pending && !overlay) return surface;
  return (
    <RenderFrame
      pending={pending}
      loadingLabel={loadingLabel}
      overlay={overlay}
      actions={
        actions.length > 0
          ? actions.map(({ label: actionLabel, symbol, ...buttonProps }) => (
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
            ))
          : undefined
      }
    >
      {surface}
    </RenderFrame>
  );
}
