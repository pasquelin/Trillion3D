import type { ReactNode } from 'react';
import { Loading } from './Loading.tsx';

interface RenderFrameProps {
  children: ReactNode;
  pending?: boolean;
  loadingLabel?: string;
  overlay?: ReactNode;
  actions?: ReactNode;
}

/** The chrome every rendered viewport shares: one frame, one radius, one background, one loading
 * state laid over it. A lesson's canvas and an example's iframe are framed the same way. */
export function RenderFrame({
  children,
  pending = false,
  loadingLabel,
  overlay,
  actions,
}: RenderFrameProps) {
  return (
    <div className="render-frame relative min-w-0">
      {children}
      {pending && <Loading label={loadingLabel} />}
      {overlay && <div className="canvas-overlay absolute top-3 left-3 z-20">{overlay}</div>}
      {actions && (
        <div className="canvas-overlay absolute top-3 right-3 z-20 join rounded-box bg-base-100/90 shadow-sm">
          {actions}
        </div>
      )}
    </div>
  );
}
