import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface PositionState {
  offset: number;
  depth: number;
}

const Position = createContext<PositionState>({ offset: 0, depth: 0 });

/** Nested toolbars stack below the portal header using their actual rendered heights. */
interface StickyPanelProps {
  controls: ReactNode;
  children: ReactNode;
  sticky?: boolean;
}

export function StickyPanel({ controls, children, sticky = false }: StickyPanelProps) {
  const parent = useContext(Position);
  const ref = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [stuck, setStuck] = useState(false);
  const [height, setHeight] = useState(0);
  const [edges, setEdges] = useState({ left: 0, right: 0 });
  useEffect(() => {
    if (!sticky || !ref.current) return;
    const toolbar = ref.current;
    const container = toolbar.parentElement;
    if (!container) return;
    const boundary = toolbar.closest('main') ?? container;
    const observer = new ResizeObserver(() => {
      setHeight(toolbar.getBoundingClientRect().height);
      const box = container.getBoundingClientRect(),
        frame = boundary.getBoundingClientRect();
      setEdges({
        left: Math.max(0, box.left - frame.left),
        right: Math.max(0, frame.right - box.right),
      });
    });
    observer.observe(toolbar);
    observer.observe(container);
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [sticky]);
  useEffect(() => {
    if (!sticky || !anchor.current || !ref.current) return;
    const top = parseFloat(getComputedStyle(ref.current).top);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) {
          setStuck(!entry.isIntersecting && entry.boundingClientRect.top < top);
        }
      },
      { rootMargin: `-${top}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [sticky, parent.offset]);
  const position = sticky ? { offset: parent.offset + height, depth: parent.depth + 1 } : parent;
  return (
    <div className="relative grid min-w-0 grid-cols-1 gap-4">
      <span
        ref={anchor}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 h-px w-px"
      />
      <div
        ref={ref}
        className={
          sticky
            ? `sticky self-start bg-base-200 shadow-sm ${stuck ? 'rounded-none' : 'rounded-box'}`
            : undefined
        }
        style={
          sticky
            ? {
                top: `calc(4.25rem + ${parent.offset}px)`,
                zIndex: 30 - parent.depth,
                marginLeft: stuck ? -edges.left : 0,
                marginRight: stuck ? -edges.right : 0,
                paddingLeft: stuck ? edges.left : 0,
                paddingRight: stuck ? edges.right : 0,
              }
            : undefined
        }
      >
        {controls}
      </div>
      <Position.Provider value={position}>{children}</Position.Provider>
    </div>
  );
}
