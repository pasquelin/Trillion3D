import { Badge } from '../ui/Badge.tsx'
import { showFallbackImage } from '../ui/Thumbnail.tsx'
import { examplePlaceholder } from './list.ts'

interface ExampleCardProps {
  title: string
  href: string
  /** The example's settled render. */
  thumbnail: string
  /** A compact state/capability label for a written example parked on the engine. */
  state?: string
}

/** A written example as the home's mosaic draws a tile: its render at 16:10, growing a little
 * under the pointer, its parked state (if any) in a corner — its theme is the section's heading —
 * and its title at the bottom over a dark gradient; the whole tile opens the example. */
export function ExampleCard({ title, href, thumbnail, state }: ExampleCardProps) {
  return (
    <a
      className="group relative block aspect-[16/10] min-w-0 overflow-hidden rounded-box bg-base-300 focus-visible:outline-2 focus-visible:outline-primary"
      href={href}
      title={state ? `${title} — ${state}` : title}
    >
      <img
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
        decoding="async"
        src={thumbnail}
        alt=""
        onError={(event) => showFallbackImage(event.currentTarget, examplePlaceholder)}
      />
      {state && (
        <span className="absolute inset-x-2 top-2 flex min-w-0">
          <Badge tone="info" size="sm" className="max-w-full truncate">
            {state}
          </Badge>
        </span>
      )}
      <TileTitle title={title} />
    </a>
  )
}

/** The title at the bottom of a tile, over a dark gradient. */
function TileTitle({ title }: { title: string }) {
  return (
    <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent px-3 pb-2 pt-8 text-sm font-medium text-white">
      <span className="line-clamp-2">{title}</span>
    </span>
  )
}

/** An example not written yet: a tile the size of the others, the shared placeholder render, a
 * "coming" label in its corner and its title; it opens nothing. */
export function ComingCard({ title, label }: { title: string; label: string }) {
  return (
    <div
      className="relative aspect-[16/10] min-w-0 overflow-hidden rounded-box bg-base-300 opacity-70"
      title={`${title} — ${label}`}
    >
      <img
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        src={examplePlaceholder}
        alt=""
      />
      <span className="absolute inset-x-2 top-2 flex min-w-0">
        <Badge size="sm">{label}</Badge>
      </span>
      <TileTitle title={title} />
    </div>
  )
}
