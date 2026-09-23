import type { ReactNode } from 'react';

interface HeroProps {
  /** A standalone demo file, running full-bleed behind the text, dimmed. */
  scene: string;
  title: ReactNode;
  lead: ReactNode;
  actions: ReactNode;
}

/** The DaisyUI hero over a live scene: the demo plays behind, the text and the actions in front.
 * The demo's own controls panel is hidden; the scene is a picture, not a control. */
export function Hero({ scene, title, lead, actions }: HeroProps) {
  return (
    <section className="hero relative min-h-[28rem] overflow-hidden rounded-box bg-[#0e1621]">
      <iframe
        src={scene}
        title=""
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 h-full w-full border-0"
        onLoad={(event) =>
          event.currentTarget.contentWindow?.postMessage(
            { type: 'wg:controls', visible: false },
            location.origin,
          )
        }
      />
      <div className="hero-overlay bg-linear-to-r from-black/85 via-black/55 to-black/10" />
      <div className="hero-content w-full justify-start text-neutral-content">
        <div className="grid max-w-xl gap-4">
          <h1 className="text-4xl font-bold md:text-5xl">{title}</h1>
          <p className="text-lg opacity-90">{lead}</p>
          <div className="flex flex-wrap gap-3">{actions}</div>
        </div>
      </div>
    </section>
  );
}
