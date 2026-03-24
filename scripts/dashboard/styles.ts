export const DASHBOARD_CSS = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Header */
    .header { text-align: center; margin-bottom: 1.5rem; }
    .header h1 { color: #58a6ff; font-size: 1.8rem; }
    .header .timestamp { color: #8b949e; font-size: 0.8rem; margin-top: 0.3rem; }

    /* Summary strip */
    .summary {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    .summary-item {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 0.8rem 1.5rem;
      text-align: center;
      min-width: 120px;
    }
    .summary-item .number { font-size: 1.6rem; font-weight: bold; }
    .summary-item .label { color: #8b949e; font-size: 0.75rem; }

    /* All clear banner */
    .all-clear {
      background: rgba(34,197,94,0.1);
      border: 1px solid #22c55e;
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
      color: #22c55e;
      font-weight: bold;
      font-size: 1.1rem;
      margin-bottom: 1.5rem;
    }

    /* Section titles */
    .section-title {
      font-size: 1rem;
      color: #8b949e;
      margin-bottom: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .section-title.alert { color: #ef4444; }

    /* Alert cards - problems */
    .alerts { margin-bottom: 2rem; }
    .alert-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-left: 4px solid #ef4444;
      border-radius: 8px;
      padding: 1rem 1.2rem;
      margin-bottom: 0.8rem;
    }
    .alert-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
    }
    .issue-list {
      list-style: none;
      padding: 0;
    }
    .issue-list li {
      padding: 0.3rem 0;
      padding-left: 1.2rem;
      position: relative;
      font-size: 0.9rem;
    }
    .issue-list li::before {
      content: "\\26A0";
      position: absolute;
      left: 0;
    }

    /* OK cards - compact expandable */
    .ok-section { margin-bottom: 2rem; }
    .ok-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 0.5rem;
    }
    .ok-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
    }
    .ok-card summary {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.7rem 1rem;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .ok-card summary::-webkit-details-marker { display: none; }
    .ok-card summary .health-score { margin-left: auto; font-size: 0.9rem; font-weight: bold; }
    .ok-card summary canvas { flex-shrink: 0; }
    .ok-card[open] { border-color: #58a6ff; }
    .ok-detail { padding: 0 1rem 0.8rem; border-top: 1px solid #21262d; }
    .ok-detail .metric {
      display: flex;
      justify-content: space-between;
      padding: 0.3rem 0;
      font-size: 0.85rem;
    }

    /* Shared */
    .status-icon { margin-right: 0.3rem; }
    .health-score { font-weight: bold; }
    .badge { font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; margin-left: 0.3rem; }
    .badge-nextjs { background: #000; color: #fff; border: 1px solid #333; }
    .badge-node { background: #026e00; color: #fff; }
    .badge-dotnet { background: #512bd4; color: #fff; }
    .badge-fastify { background: #000; color: #fff; }
    .badge-astro { background: #ff5d01; color: #fff; }
    .metric-label { color: #8b949e; }

    /* Trends */
    .trends {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .trends h2 { color: #58a6ff; font-size: 1rem; margin-bottom: 0.8rem; }
    .trends canvas { max-height: 220px; }

    /* Migration section */
    .migration {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .migration h2 { color: #8b5cf6; font-size: 1rem; margin-bottom: 0.8rem; }
    .migration-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 0.8rem;
      margin-bottom: 1rem;
    }
    .migration-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem 1rem;
    }
    .migration-card h3 {
      font-size: 0.85rem;
      color: #8b949e;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .migration-stat {
      display: flex;
      justify-content: space-between;
      padding: 0.2rem 0;
      font-size: 0.85rem;
    }
    .migration-stat .val { font-weight: bold; }
    .progress-bar {
      background: #21262d;
      border-radius: 4px;
      height: 8px;
      margin-top: 0.5rem;
      overflow: hidden;
    }
    .progress-bar .fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .module-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-top: 0.5rem;
    }
    .module-chip {
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(139,92,246,0.15);
      color: #a78bfa;
      border: 1px solid rgba(139,92,246,0.3);
    }
    .module-chip.has-cmd { border-left: 2px solid #22c55e; }
    .module-chip.has-qry { border-right: 2px solid #58a6ff; }

    /* Factory Status */
    .factory-status {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .factory-status h2 { color: #a855f7; font-size: 1rem; margin-bottom: 0.8rem; }
    .factory-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.8rem;
      margin-bottom: 0.8rem;
    }
    @media (max-width: 700px) { .factory-grid { grid-template-columns: 1fr; } }
    .factory-health-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem 1rem;
      border-left: 3px solid;
    }
    .factory-health-indicator {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.5rem 0.8rem;
      border-radius: 6px;
      margin-bottom: 0.6rem;
    }
    .factory-health-detail .metric {
      display: flex;
      justify-content: space-between;
      padding: 0.25rem 0;
      font-size: 0.85rem;
    }
    .factory-stats-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem 1rem;
    }
    .factory-stats-card h3 {
      font-size: 0.85rem;
      color: #8b949e;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .factory-stats-card .metric {
      display: flex;
      justify-content: space-between;
      padding: 0.25rem 0;
      font-size: 0.85rem;
    }
    .factory-stats-card .val { font-weight: bold; }
    .activity-timeline {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      overflow: hidden;
    }
    .activity-timeline summary {
      padding: 0.7rem 1rem;
      cursor: pointer;
      color: #8b949e;
      font-size: 0.85rem;
      user-select: none;
    }
    .activity-timeline[open] { border-color: #a855f7; }
    .timeline-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .timeline-table td {
      padding: 0.4rem 0.6rem;
      border-top: 1px solid #21262d;
      vertical-align: middle;
    }
    .source-badge {
      font-size: 0.65rem;
      padding: 1px 6px;
      border-radius: 4px;
      white-space: nowrap;
    }

    /* Security Posture */
    .security-posture {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .security-posture h2 { color: #f97316; font-size: 1rem; margin-bottom: 0.8rem; }
    .security-grid {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 0.8rem;
      align-items: start;
    }
    @media (max-width: 600px) { .security-grid { grid-template-columns: 1fr; } }
    .security-score-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-left: 3px solid;
      border-radius: 6px;
      padding: 1rem;
      text-align: center;
    }
    .security-score-value { font-size: 2rem; font-weight: bold; }
    .security-score-label { font-size: 0.75rem; color: #8b949e; margin-top: 0.2rem; }
    .security-metrics-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem 1rem;
    }
    .security-metric {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.3rem 0;
      font-size: 0.85rem;
    }
    .security-metric .metric-label { min-width: 120px; }

    /* Performance & Quality */
    .performance-posture {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .performance-posture h2 { color: #06b6d4; font-size: 1rem; margin-bottom: 0.8rem; }

    /* DORA Metrics */
    .dora-section {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .dora-section h2 { color: #a78bfa; font-size: 1rem; margin-bottom: 0.8rem; }
    .dora-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.6rem;
      margin-bottom: 0.8rem;
    }
    .dora-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem;
      text-align: center;
    }
    .dora-card .dora-value { font-size: 1.4rem; font-weight: bold; }
    .dora-card .dora-label { font-size: 0.7rem; color: #8b949e; margin-top: 0.2rem; }
    .dora-rating {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: bold;
      text-transform: uppercase;
    }
    .dora-repo-list {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      font-size: 0.8rem;
      max-height: 200px;
      overflow-y: auto;
    }
    .dora-repo-row {
      display: flex;
      justify-content: space-between;
      padding: 0.25rem 0;
      border-bottom: 1px solid #21262d;
    }
    .dora-repo-row:last-child { border-bottom: none; }

    /* Cost Monitor */
    .cost-section {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .cost-section h2 { color: #34d399; font-size: 1rem; margin-bottom: 0.8rem; }
    .cost-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 0.6rem;
      margin-bottom: 0.8rem;
    }
    .cost-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem;
      text-align: center;
    }
    .cost-card .cost-value { font-size: 1.4rem; font-weight: bold; }
    .cost-card .cost-label { font-size: 0.7rem; color: #8b949e; margin-top: 0.2rem; }
    .cost-recs {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      font-size: 0.8rem;
    }
    .cost-recs ul { margin: 0; padding-left: 1.2rem; }
    .cost-recs li { padding: 0.15rem 0; color: #c9d1d9; }
    .compliance-section {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .compliance-section h2 { color: #f59e0b; font-size: 1rem; margin-bottom: 0.8rem; }
    .compliance-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 0.6rem;
      margin-bottom: 0.8rem;
    }
    .compliance-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem;
      text-align: center;
    }
    .compliance-card .compliance-value { font-size: 1.4rem; font-weight: bold; }
    .compliance-card .compliance-label { font-size: 0.7rem; color: #8b949e; margin-top: 0.2rem; }
    .compliance-gaps {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      font-size: 0.8rem;
    }
    .compliance-gaps ul { margin: 0; padding-left: 1.2rem; }
    .compliance-gaps li { padding: 0.15rem 0; color: #c9d1d9; }
    .rec-section {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .rec-section h2 { color: #3b82f6; font-size: 1rem; margin-bottom: 0.8rem; }
    .rec-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 0.6rem;
      margin-bottom: 0.8rem;
    }
    .rec-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem;
      text-align: center;
    }
    .rec-card .rec-value { font-size: 1.4rem; font-weight: bold; }
    .rec-card .rec-label { font-size: 0.7rem; color: #8b949e; margin-top: 0.2rem; }
    .rec-gaps {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      font-size: 0.8rem;
    }
    .rec-gaps ul { margin: 0; padding-left: 1.2rem; }
    .rec-gaps li { padding: 0.15rem 0; color: #c9d1d9; }
`;
