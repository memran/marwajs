export function stripWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
