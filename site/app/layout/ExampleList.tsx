interface ExampleLink {
  key: string;
  label: string;
  href: string;
  thumbnail: string;
  active: boolean;
}

export interface ExampleGroup {
  id: string;
  title: string;
  items: ExampleLink[];
}

/** The Examples sidebar's list: theme by theme, one card per example — its render the width of
 * the sidebar, its title under it on at most two lines, the current one outlined. */
export function ExampleList({ groups }: { groups: ExampleGroup[] }) {
  return (
    <div className="grid grid-cols-1 gap-6">
      {groups.map((group) => (
        <section key={group.id} className="grid grid-cols-1 gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest opacity-60">{group.title}</h2>
          <ul className="grid grid-cols-1 gap-3">
            {group.items.map((item) => (
              <li key={item.key}>
                <a
                  className={`grid gap-2 rounded-box p-2 hover:bg-base-300 ${item.active ? 'bg-base-300 ring-2 ring-primary' : ''}`}
                  href={item.href}
                  title={item.label}
                  aria-current={item.active ? 'page' : undefined}
                >
                  <img
                    className="aspect-[16/10] w-full rounded-lg bg-base-300 object-cover"
                    src={item.thumbnail}
                    alt=""
                    loading="lazy"
                  />
                  <span className="line-clamp-2 text-sm font-medium">{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
