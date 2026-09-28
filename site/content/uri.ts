/** Decode a link component, keeping malformed escapes readable and navigable. */
export function decodeLinkComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
