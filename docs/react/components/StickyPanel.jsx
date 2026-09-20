import { createContext, useContext, useEffect, useRef, useState } from 'react';
const Position = createContext({ offset: 0, depth: 0 });
/** Nested toolbars stack below the portal header using their actual rendered heights. */
export function StickyPanel({ controls, children, sticky = false }) {
  const parent = useContext(Position);
  const ref = useRef(null);
  const [height, setHeight] = useState(0);
  const [edges, setEdges] = useState({ left: 0, right: 0 });
  useEffect(() => {
    if (!sticky || !ref.current) return;
    const toolbar = ref.current;
    const container = toolbar.parentElement;
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
  const position = sticky ? { offset: parent.offset + height, depth: parent.depth + 1 } : parent;
  return (
    <div className="grid min-w-0 gap-4">
      <div
        ref={ref}
        className={sticky ? 'sticky self-start bg-base-200 shadow-sm' : undefined}
        style={
          sticky
            ? {
                top: `calc(4.25rem + ${parent.offset}px)`,
                zIndex: 30 - parent.depth,
                marginLeft: -edges.left,
                marginRight: -edges.right,
                paddingLeft: edges.left,
                paddingRight: edges.right,
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
