/** The locations the vertex struct of the module text `code` declares. */
export const locationsOf = (code: string) =>
  /struct VSOut\{([^}]*)\}/.exec(code)![1].match(/@location\(\d+\)/g)
