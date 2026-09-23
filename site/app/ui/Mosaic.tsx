interface Tile {
  id: string;
  href: string;
  src: string;
  label: string;
  /** A flagship, twice as wide and twice as tall as the others. */
  large?: boolean;
}

/** Pictures side by side at the renders' 16:10, each opening its page, its title at the bottom
 * over a dark gradient; a large tile spans two columns and two rows, the small ones fill the holes
 * around it. */
export function Mosaic({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-flow-dense grid-cols-2 gap-1 md:grid-cols-4 xl:grid-cols-6">
      {tiles.map((tile) => (
        <a
          key={tile.id}
          className={`group relative aspect-[16/10] min-w-0 overflow-hidden rounded-field bg-base-300 ${tile.large ? 'col-span-2 row-span-2' : ''}`}
          href={tile.href}
          title={tile.label}
        >
          <img
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            src={tile.src}
            alt=""
            loading="lazy"
          />
          <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent px-3 pb-2 pt-8 text-sm font-medium text-white">
            <span className="line-clamp-2">{tile.label}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
