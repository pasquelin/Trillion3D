import { useImperativeHandle, useRef } from 'react';
import type { ReactNode, Ref } from 'react';
import { useFrameFocus } from '../hooks/useFrameFocus.ts';
import type { FrameKeyboard } from '../hooks/useFrameFocus.ts';
import { Loading } from './Loading.tsx';

interface RenderFrameProps {
  children: ReactNode;
  pending?: boolean;
  loadingLabel?: string;
  overlay?: ReactNode;
  actions?: ReactNode;
  ref?: Ref<HTMLDivElement>;
  /** Take the height the parent column leaves, instead of a screen-bound one of its own. */
  fill?: boolean;
  /** A demo framed here reads the keyboard: when it takes it, and the hint shown while it has not. */
  keyboard?: { mode: FrameKeyboard; hint: string };
}

/** The chrome every rendered viewport shares: one frame, one radius, one background, one loading
 * state laid over it. A lesson's canvas and an example's iframe are framed the same way; a demo
 * that reads the keyboard wears a ring while it holds it, and a hint while it does not. */
export function RenderFrame({
  children,
  pending = false,
  loadingLabel,
  overlay,
  actions,
  ref,
  fill = false,
  keyboard,
}: RenderFrameProps) {
  const host = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => host.current!, []);
  const held = useFrameFocus(host, keyboard?.mode);
  return (
    <div
      ref={host}
      className={`render-frame relative min-w-0 ${fill ? 'h-full min-h-0' : 'h-[min(60dvh,42rem)]'}`}
      data-keyboard={keyboard ? (held ? 'held' : 'free') : undefined}
    >
      {children}
      {pending && <Loading label={loadingLabel} />}
      {keyboard && !held && !pending && (
        <p className="frame-hint pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-box bg-base-100/90 px-3 py-1 text-sm shadow-sm">
          {keyboard.hint}
        </p>
      )}
      {overlay && <div className="canvas-overlay absolute top-3 left-3 z-20">{overlay}</div>}
      {actions && (
        <div className="canvas-overlay absolute top-3 right-3 z-20 join rounded-box bg-base-100/90 shadow-sm">
          {actions}
        </div>
      )}
    </div>
  );
}
