// Command line flags shared by the harnesses: one reader, and the refusal of a flag never read.

/** Command line flags that remember every name a harness asked for, so that a flag it never read
 *  (misspelt, or renamed since) is refused instead of silently changing nothing. */
export class Flags extends Map<string, string> {
  readonly #read = new Set<string>();
  override get(name: string) {
    this.#read.add(name);
    return super.get(name);
  }
  override has(name: string) {
    this.#read.add(name);
    return super.has(name);
  }
  /** Throws on every flag given and never read. Called once a command has read all its options,
   *  before any build, server or browser: a later read would be refused. */
  refuseUnread() {
    const unread = [...this.keys()].filter((name) => !this.#read.has(name));
    if (unread.length) throw new Error(`unknown flag: ${unread.map((n) => `--${n}`).join(', ')}`);
  }
}

/** Command line `--name value` / `--name=value` arguments. Shared by harnesses:
 *  a single place knows what a flag means, and a missing value defaults to `'true'`. */
export function parseArgs(argv: string[]) {
  const flags = new Flags();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const eq = arg.indexOf('=');
    if (eq > 0) flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags.set(arg.slice(2), argv[++i]);
    else flags.set(arg.slice(2), 'true');
  }
  return flags;
}
