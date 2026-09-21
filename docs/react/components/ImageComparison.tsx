interface ImageComparisonItem {
  label: string;
  src: string;
}

export interface ImageComparisonProps {
  left: ImageComparisonItem;
  right: ImageComparisonItem;
  label: string;
  width?: number;
  height?: number;
  fitted?: boolean;
}

/** DaisyUI owns the single draggable image divider. */
export function ImageComparison({
  left,
  right,
  label,
  width,
  height,
  fitted = false,
}: ImageComparisonProps) {
  const ratio = width && height ? width / height : 16 / 9;
  return (
    <figure
      className="diff rounded-box w-full"
      tabIndex={0}
      aria-label={`${label}: ${left.label} / ${right.label}`}
      style={{ aspectRatio: ratio, ...(fitted ? { width: `min(92vw, ${88 * ratio}dvh)` } : {}) }}
    >
      <div className="diff-item-1" role="img" tabIndex={0} aria-label={left.label}>
        <img loading="lazy" src={left.src} alt={left.label} />
      </div>
      <div className="diff-item-2" role="img" aria-label={right.label}>
        <img loading="lazy" src={right.src} alt={right.label} />
      </div>
      <div className="diff-resizer" />
    </figure>
  );
}
