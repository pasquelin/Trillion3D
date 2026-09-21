import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function SectionHeader({
  title,
  description,
  eyebrow,
  level = 2,
  className = '',
  size = 'lg',
}: SectionHeaderProps) {
  const Heading = `h${level}` as const;
  return (
    <header className={`grid gap-2 ${className}`}>
      {eyebrow && (
        <p className="text-xs font-bold uppercase tracking-widest text-primary">{eyebrow}</p>
      )}
      <Heading
        className={`${size === 'sm' ? 'text-lg' : size === 'md' ? 'text-xl' : 'text-3xl'} font-bold`}
      >
        {title}
      </Heading>
      {description && (
        <p className="text-base leading-relaxed text-base-content/80">{description}</p>
      )}
    </header>
  );
}
