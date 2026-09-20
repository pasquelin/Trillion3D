import { useEffect, useMemo, useRef, useState } from 'react';
import { Loading } from './Loading.jsx';

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function progressiveRange(direction, range, pageCount, maxPages) {
  if (pageCount <= 1) return { start: 0, end: 0 };
  if (direction === 'back') {
    const start = Math.max(0, range.start - 1);
    return { start, end: Math.min(pageCount - 1, start + maxPages - 1) };
  }
  const end = Math.min(pageCount - 1, range.end + 1);
  return { start: Math.max(0, end - maxPages + 1), end };
}

export function ProgressiveList({
  items,
  renderItem,
  batchSize = 24,
  maxBatches = 3,
  initialState,
  labels,
  onStateChange,
}) {
  const pageCount = Math.max(1, Math.ceil(items.length / batchSize));
  const [range, setRange] = useState(() => ({
    start: clamp(initialState?.start ?? 0, 0, pageCount - 1),
    end: clamp(initialState?.end ?? 0, 0, pageCount - 1),
  }));
  const [heights, setHeights] = useState(() => initialState?.heights ?? {});
  const [loading, setLoading] = useState(false);
  const root = useRef(null);
  const pages = useMemo(
    () => Array.from({ length: range.end - range.start + 1 }, (_, index) => range.start + index),
    [range],
  );

  useEffect(() => {
    const nodes = root.current?.querySelectorAll('[data-progressive-page]') ?? [];
    const measure = () => {
      const next = {};
      for (const node of nodes) next[node.dataset.progressivePage] = node.offsetHeight;
      setHeights((current) => ({ ...current, ...next }));
    };
    measure();
    const observer = 'ResizeObserver' in window ? new ResizeObserver(measure) : null;
    nodes.forEach((node) => observer?.observe(node));
    return () => observer?.disconnect();
  }, [pages]);

  useEffect(() => onStateChange?.({ ...range, heights }), [heights, onStateChange, range]);

  const move = (direction) => {
    if (loading) return;
    setLoading(true);
    requestAnimationFrame(() => {
      setRange((current) => progressiveRange(direction, current, pageCount, maxBatches));
      setLoading(false);
    });
  };
  const observe = (node, direction) => {
    if (!node || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && move(direction),
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  };
  const topHeight = Array.from({ length: range.start }, (_, page) => heights[page] ?? 0).reduce(
    (total, height) => total + height,
    0,
  );
  const bottomHeight = Object.entries(heights).reduce(
    (total, [page, height]) => total + (Number(page) > range.end ? height : 0),
    0,
  );
  const mountedItems = pages.reduce(
    (total, page) => total + items.slice(page * batchSize, (page + 1) * batchSize).length,
    0,
  );

  return (
    <div ref={root} data-progressive-list data-mounted-items={mountedItems}>
      <div style={{ height: topHeight }} aria-hidden="true" />
      {range.start > 0 && (
        <button
          ref={(node) => observe(node, 'back')}
          type="button"
          className="btn btn-ghost btn-sm mx-auto flex"
        >
          {labels.previous}
        </button>
      )}
      {pages.map((page) => (
        <div
          key={page}
          data-progressive-page={page}
          className="grid gap-5 pb-5 sm:grid-cols-2 xl:grid-cols-3"
        >
          {items.slice(page * batchSize, (page + 1) * batchSize).map(renderItem)}
        </div>
      ))}
      {loading && (
        <div className="relative h-16">
          <Loading label={labels.loading} />
        </div>
      )}
      <div style={{ height: bottomHeight }} aria-hidden="true" />
      {!loading && range.end < pageCount - 1 && (
        <button
          ref={(node) => observe(node, 'forward')}
          type="button"
          className="btn btn-ghost btn-sm mx-auto flex"
        >
          {labels.next}
        </button>
      )}
      {!loading && range.end === pageCount - 1 && (
        <p className="py-6 text-center text-sm opacity-70" role="status">
          {labels.end}
        </p>
      )}
    </div>
  );
}
