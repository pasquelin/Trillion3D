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

/** A titled part of a page's body: its heading, then what it holds. */
export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-4">
      <h2 className="text-xl font-bold md:text-2xl">{title}</h2>
      {children}
    </section>
  );
}

/** A picture across the page that opens what it shows, at the renders' 16:10. */
export function Figure({ href, src, alt }: { href: string; src: string; alt: string }) {
  return (
    <a className="block max-w-3xl overflow-hidden rounded-box" href={href}>
      <img className="aspect-[16/10] w-full object-cover" src={src} alt={alt} loading="lazy" />
    </a>
  );
}
