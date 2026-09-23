interface FlagProps {
  /** The ISO 3166 region code of the flag, served by the site build under `flags/`. */
  region: string;
  /** What the flag stands for, read by assistive technology; empty where the text beside it
   *  already says it. */
  label: string;
}

/** A small 4:3 flag with rounded corners, the height of a line of text: an SVG file, drawn the
 *  same on every system, where an emoji flag is not. */
export function Flag({ region, label }: FlagProps) {
  return (
    <img
      className="inline-block h-3 w-4 shrink-0 rounded-[2px] object-cover align-middle shadow-[0_0_0_1px_rgb(0_0_0/0.15)]"
      src={`./flags/${region}.svg`}
      alt={label}
      width={16}
      height={12}
      loading="lazy"
    />
  );
}
