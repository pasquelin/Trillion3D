/**
 * The page reads' round trip, as a transport estimates its own: the time from a request until the
 * page's bytes have landed, smoothed with TCP's gain of an eighth (RFC 6298), so one slow answer
 * moves it by an eighth of its lateness. The first measure is taken as it is; zero until there is
 * one. A measure that is not a finite duration is not one.
 */
export function createRoundTrip() {
  let ms: number | undefined;
  return {
    ms: () => ms ?? 0,
    note(sample: number) {
      if (sample >= 0 && sample < Infinity) ms = ms === undefined ? sample : ms + (sample - ms) / 8;
    },
  };
}
