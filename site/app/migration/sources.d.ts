/** Program sources the portal shows as text, bundled as strings (`loader` of the site builds). */
declare module '*.txt' {
  const text: string;
  export default text;
}
declare module '*.html' {
  const text: string;
  export default text;
}
