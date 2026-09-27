/**
 * The page reads' round trip, as a transport estimates its own: the time from a request to its
 * response's headers, smoothed with TCP's gain of an eighth (RFC 6298), so one slow answer moves it
 * by an eighth of its lateness. The first measure is taken as it is; zero until there is one. A
 * measure that is not a finite duration is not one.
 */
export function createRoundTrip() {
  let ms = 0,
    measured = false;
  return {
    get ms() {
      return ms;
    },
    note(sample: number) {
      if (!(sample >= 0 && sample < Infinity)) return;
      ms = measured ? ms + (sample - ms) / 8 : sample;
      measured = true;
    },
  };
}
