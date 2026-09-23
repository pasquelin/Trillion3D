interface ThumbnailProps {
  href: string;
  src: string;
  label: string;
  /** The page the reader is on: outlined, and named current. */
  active?: boolean;
}

/** A render as a list shows it: the width of its column, 16:10, loaded when it scrolls near. */
export function Cover({ src }: { src: string }) {
  return (
    <img
      className="aspect-[16/10] w-full rounded-lg bg-base-300 object-cover"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

/** A picture that opens a page: the render the width of its column, its title under it on at most
 * two lines. */
export function Thumbnail({ href, src, label, active = false }: ThumbnailProps) {
  return (
    <a
      className={`grid gap-2 rounded-box p-2 hover:bg-base-300 ${active ? 'bg-base-300 ring-2 ring-primary' : ''}`}
      href={href}
      title={label}
      aria-current={active ? 'page' : undefined}
    >
      <Cover src={src} />
      <span className="line-clamp-2 text-sm font-medium">{label}</span>
    </a>
  );
}
