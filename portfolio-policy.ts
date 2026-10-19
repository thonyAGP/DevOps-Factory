/** Business priorities confirmed by the owner on 2026-10-19. */
export const PRIORITY_REPOSITORIES: readonly string[] = [
  'thonyAGP/CasaSync',
  'thonyAGP/zentra',
  'thonyAGP/LB2I-Fiscal-Manager',
  'thonyAGP/CarAssist',
  'thonyAGP/drivyn-reports',
];

/** Dependencies to preserve, not additional autonomous development targets. */
export const SUPPORT_REPOSITORIES: readonly string[] = [
  'thonyAGP/Boxmail_cleaning',
  'thonyAGP/db-backups',
  'thonyAGP/DevOps-Factory',
  'thonyAGP/claude-dev-config',
  'thonyAGP/jira-lb2i',
];

export const isPriorityRepository = (repo: string): boolean =>
  PRIORITY_REPOSITORIES.includes(repo);

/** Restrict existing opt-ins; a business priority never enables an agent by itself. */
export const retainPriorityOptIns = (repos: readonly string[]): string[] =>
  repos.filter(isPriorityRepository);
