/**
 * Locates where new entries go in factory.config.ts: just before the `];`
 * that closes KNOWN_PROJECTS (not whichever array happens to precede
 * GITHUB_OWNER). Returns -1 when the array cannot be found.
 */
export const findKnownProjectsInsertPos = (content: string): number => {
  const start = content.indexOf('export const KNOWN_PROJECTS');
  if (start === -1) return -1;
  const end = content.indexOf('\n];', start);
  return end === -1 ? -1 : end + 1;
};
