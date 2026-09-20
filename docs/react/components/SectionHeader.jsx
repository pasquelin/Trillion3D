export function SectionHeader({
  title,
  description,
  eyebrow,
  level = 2,
  className = '',
  size = 'lg',
}) {
  const Heading = `h${level}`;
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
