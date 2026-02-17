export interface ProjectConfig {
  name: string;
  hasCI: boolean;
  stack: "nextjs" | "fastify" | "dotnet" | "node" | "unknown";
  hasQodo: boolean;
  hasClaude: boolean;
  hasSelfHealing: boolean;
  vercel: boolean;
}

export const KNOWN_PROJECTS: ProjectConfig[] = [
  {
    name: "Email_Assistant",
    hasCI: true,
    stack: "fastify",
    hasQodo: true,
    hasClaude: false,
    hasSelfHealing: false,
    vercel: true,
  },
  {
    name: "ClubMedRoomAssignment",
    hasCI: true,
    stack: "dotnet",
    hasQodo: false,
    hasClaude: false,
    hasSelfHealing: false,
    vercel: false,
  },
  {
    name: "CasaSync",
    hasCI: true,
    stack: "nextjs",
    hasQodo: false,
    hasClaude: false,
    hasSelfHealing: false,
    vercel: false,
  },
  {
    name: "Livret_accueil_Au-Marais",
    hasCI: true,
    stack: "nextjs",
    hasQodo: false,
    hasClaude: false,
    hasSelfHealing: false,
    vercel: true,
  },
  {
    name: "Site_Au-marais",
    hasCI: true,
    stack: "nextjs",
    hasQodo: false,
    hasClaude: false,
    hasSelfHealing: false,
    vercel: true,
  },
  {
    name: "Lecteur_Magic",
    hasCI: true,
    stack: "dotnet",
    hasQodo: false,
    hasClaude: false,
    hasSelfHealing: false,
    vercel: false,
  },
];

export const GITHUB_OWNER = "ThonyMusic";

export const SCAN_CONFIG = {
  cronIntervalHours: 6,
  dashboardRefreshHours: 4,
  ignoredRepos: [
    "DevOps-Factory",
    "Parametrage_Claude",
    "Migration_Pc1_vers_Pc2",
    ".github",
  ],
  requiredFiles: {
    node: ["package.json"],
    dotnet: ["*.csproj", "*.sln"],
  },
  workflowFiles: {
    claudeReview: "claude-review.yml",
    selfHealing: "self-healing.yml",
    qodoMerge: "qodo-merge.yml",
  },
};
