import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/** A small, quieter line under a title or a render: a hint, a count, a caveat. */
export function Note({ className = '', ...props }: ComponentPropsWithoutRef<'p'>) {
  return <p className={`text-sm opacity-70 ${className}`} {...props} />;
}

/** A paragraph of running text. */
export function Paragraph(props: ComponentPropsWithoutRef<'p'>) {
  return <p className="leading-relaxed" {...props} />;
}

/** The DaisyUI link: a link inside text. */
export function TextLink({ className = '', ...props }: ComponentPropsWithoutRef<'a'>) {
  return <a className={`link ${className}`} {...props} />;
}

/** The heading of each section level, and the gap under it: a part of the page, then the
 *  parts nested in it. */
const LEVELS = {
  2: { Heading: 'h2', heading: 'text-xl font-bold md:text-2xl', gap: 'gap-4' },
  3: { Heading: 'h3', heading: 'text-lg font-semibold', gap: 'gap-3' },
  4: { Heading: 'h4', heading: 'font-semibold', gap: 'gap-3' },
} as const;

/** A titled part of a page's body: its heading, then what it holds. `id` names the heading, a
 *  stable anchor a page can jump to; `level` nests it in another section. */
export function Section({
  id,
  title,
  level = 2,
  children,
}: {
  id?: string;
  title: ReactNode;
  level?: keyof typeof LEVELS;
  children: ReactNode;
}) {
  const { Heading, heading, gap } = LEVELS[level];
  return (
    <section className={`grid min-w-0 grid-cols-1 ${gap}`}>
      <Heading id={id} className={heading}>
        {title}
      </Heading>
      {children}
    </section>
  );
}
