interface ThumbnailProps {
  href: string;
  src: string;
  label: string;
  /** The page the reader is on: outlined, and named current. */
  active?: boolean;
}

/** A render as a list shows it, the width of its column at 16:10 and loaded when it scrolls
 *  near: `list` under a thumbnail's title, `card` framed atop a card, `placeholder` for a render
 *  still to come. */
export function Cover({
  src,
  look = 'list',
}: {
  src: string;
  look?: 'list' | 'card' | 'placeholder';
}) {
  if (look === 'card') {
    return (
      <div className="aspect-[16/10] overflow-hidden rounded-box bg-base-300">
        <img
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          src={src}
          alt=""
        />
      </div>
    );
  }
  return (
    <img
      className={`aspect-[16/10] w-full ${look === 'list' ? 'rounded-lg bg-base-300' : 'rounded-box'} object-cover`}
      src={src}
      alt=""
      loading="lazy"
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
