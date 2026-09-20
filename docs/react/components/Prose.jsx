export function Inline({ text = '' }) {
  return String(text)
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)
    .map((part, index) => {
      if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
      if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
      return part;
    });
}

/** Only repository-authored documentation HTML belongs here; never user input. */
export function Prose({ html }) {
  return <div className="wg-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Table({ children }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-zebra">{children}</table>
    </div>
  );
}
