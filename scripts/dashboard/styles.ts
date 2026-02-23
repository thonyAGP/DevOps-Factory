export const getStyles = (): string => `
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #0d1117;
      --border: #30363d;
      --border-active: #58a6ff;
      --border-subtle: #21262d;
      --text-primary: #c9d1d9;
      --text-secondary: #8b949e;
      --text-muted: #848d97;
      --accent-blue: #58a6ff;
      --accent-green: #22c55e;
      --accent-red: #ef4444;
      --accent-orange: #f59e0b;
      --accent-purple: #b87eff;
      --accent-cyan: #06b6d4;
      --accent-pink: #ec4899;
      --accent-teal: #34d399;
    }
    [data-theme="light"] {
      --bg-primary: #ffffff;
      --bg-secondary: #f6f8fa;
      --bg-tertiary: #ffffff;
      --border: #d0d7de;
      --border-active: #0969da;
      --border-subtle: #d8dee4;
      --text-primary: #1f2937;
      --text-secondary: #57606a;
      --text-muted: #6e7781;
      --accent-blue: #0969da;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1rem 2rem;
    }
    a { color: var(--accent-blue); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Skip link for a11y */
    .skip-link {
      position: absolute; left: -9999px; top: 0;
      background: var(--accent-blue); color: #fff;
      padding: 0.5rem 1rem; z-index: 1000;
      border-radius: 0 0 4px 0;
    }
    .skip-link:focus { left: 0; }

    /* Sticky nav */
    .sticky-nav {
      position: sticky; top: 0; z-index: 100;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 0.6rem 1rem;
      display: flex; align-items: center; gap: 0.5rem;
      flex-wrap: wrap;
      margin: 0 -1rem 1.5rem;
    }
    .sticky-nav h1 {
      color: var(--accent-blue); font-size: 1.2rem;
      margin-right: auto;
      white-space: nowrap;
    }
    .nav-links {
      display: flex; gap: 0.4rem; flex-wrap: wrap;
    }
    .nav-links a {
      font-size: 0.7rem; padding: 3px 8px;
      border-radius: 4px; background: var(--bg-tertiary);
      border: 1px solid var(--border); color: var(--text-secondary);
    }
    .nav-links a:hover { border-color: var(--accent-blue); color: var(--accent-blue); text-decoration: none; }

    /* Controls bar */
    .controls {
      display: flex; gap: 0.5rem; align-items: center;
      flex-wrap: wrap; margin-bottom: 1rem;
    }
    .search-input {
      background: var(--bg-tertiary); border: 1px solid var(--border);
      border-radius: 6px; padding: 0.4rem 0.8rem;
      color: var(--text-primary); font-size: 0.85rem;
      flex: 1; min-width: 180px; max-width: 300px;
    }
    .search-input:focus { outline: none; border-color: var(--accent-blue); }
    .search-input::placeholder { color: var(--text-muted); }
    .sort-select {
      background: var(--bg-tertiary); border: 1px solid var(--border);
      border-radius: 6px; padding: 0.4rem 0.6rem;
      color: var(--text-primary); font-size: 0.8rem;
    }
    .filter-btn {
      background: var(--bg-tertiary); border: 1px solid var(--border);
      border-radius: 6px; padding: 0.35rem 0.7rem;
      color: var(--text-secondary); font-size: 0.75rem;
      cursor: pointer; transition: all 0.15s;
    }
    .filter-btn:hover, .filter-btn.active {
      border-color: var(--accent-blue); color: var(--accent-blue);
      background: rgba(88,166,255,0.1);
    }
    .theme-toggle, .export-btn {
      background: var(--bg-tertiary); border: 1px solid var(--border);
      border-radius: 6px; padding: 0.35rem 0.7rem;
      color: var(--text-secondary); font-size: 0.8rem;
      cursor: pointer;
    }
    .theme-toggle:hover, .export-btn:hover {
      border-color: var(--accent-blue); color: var(--accent-blue);
    }

    /* Header */
    .header { text-align: center; margin-bottom: 1rem; padding-top: 0.5rem; }
    .header .timestamp { color: var(--text-secondary); font-size: 0.8rem; margin-top: 0.3rem; }

    /* Summary strip */
    .summary {
      display: flex; gap: 0.8rem; justify-content: center;
      flex-wrap: wrap; margin-bottom: 1.5rem;
    }
    .summary-item {
      background: var(--bg-secondary); border: 1px solid var(--border);
      border-radius: 8px; padding: 0.6rem 1.2rem;
      text-align: center; min-width: 100px;
    }
    .summary-item .number { font-size: 1.4rem; font-weight: bold; }
    .summary-item .label { color: var(--text-secondary); font-size: 0.7rem; }

    /* All clear */
    .all-clear {
      background: rgba(34,197,94,0.1); border: 1px solid var(--accent-green);
      border-radius: 8px; padding: 1rem; text-align: center;
      color: var(--accent-green); font-weight: bold; margin-bottom: 1.5rem;
    }

    /* Section titles */
    .section-title {
      font-size: 1rem; color: var(--text-secondary);
      margin-bottom: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .section-title.alert { color: var(--accent-red); }

    /* Section cards (shared) */
    .section-card {
      background: var(--bg-secondary); border: 1px solid var(--border);
      border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem;
    }
    .section-card h2 { font-size: 1rem; margin-bottom: 0.8rem; }

    /* Alert cards */
    .alerts { margin-bottom: 2rem; }
    .alert-card {
      background: var(--bg-secondary); border: 1px solid var(--border);
      border-left: 4px solid var(--accent-red);
      border-radius: 8px; padding: 1rem 1.2rem; margin-bottom: 0.8rem;
    }
    .alert-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
    .issue-list { list-style: none; padding: 0; }
    .issue-list li {
      padding: 0.3rem 0; padding-left: 1.2rem;
      position: relative; font-size: 0.9rem;
    }
    .issue-list li::before { content: "\\26A0"; position: absolute; left: 0; }

    /* OK cards */
    .ok-section { margin-bottom: 2rem; }
    .ok-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 0.5rem;
    }
    .ok-card {
      background: var(--bg-secondary); border: 1px solid var(--border);
      border-radius: 8px; overflow: hidden;
    }
    .ok-card summary {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.7rem 1rem; cursor: pointer;
      list-style: none; user-select: none;
    }
    .ok-card summary::-webkit-details-marker { display: none; }
    .ok-card summary .health-score { margin-left: auto; font-size: 0.9rem; font-weight: bold; }
    .ok-card summary canvas { flex-shrink: 0; }
    .ok-card[open] { border-color: var(--border-active); }
    .ok-detail { padding: 0 1rem 0.8rem; border-top: 1px solid var(--border-subtle); }
    .ok-detail .metric {
      display: flex; justify-content: space-between;
      padding: 0.3rem 0; font-size: 0.85rem;
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
    .metric-label { color: var(--text-secondary); }
    .val { font-weight: bold; }

    /* Progress bar */
    .progress-bar {
      background: var(--border-subtle); border-radius: 4px;
      height: 8px; margin-top: 0.5rem; overflow: hidden;
    }
    .progress-bar .fill { height: 100%; border-radius: 4px; transition: width 0.3s; }

    /* Trends */
    .trends {
      background: var(--bg-secondary); border: 1px solid var(--border);
      border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem;
    }
    .trends h2 { color: var(--accent-blue); font-size: 1rem; margin-bottom: 0.8rem; }
    .trends canvas { max-height: 220px; }

    /* Factory status */
    .factory-status { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem; }
    .factory-status h2 { color: var(--accent-purple); font-size: 1rem; margin-bottom: 0.8rem; }
    .factory-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 0.8rem; }
    .factory-health-card { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.8rem 1rem; border-left: 3px solid; }
    .factory-health-indicator { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.8rem; border-radius: 6px; margin-bottom: 0.6rem; }
    .factory-health-detail .metric { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem; }
    .factory-stats-card { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.8rem 1rem; }
    .factory-stats-card h3 { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.03em; }
    .factory-stats-card .metric { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem; }
    .activity-timeline { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; overflow: hidden; }
    .activity-timeline summary { padding: 0.7rem 1rem; cursor: pointer; color: var(--text-secondary); font-size: 0.85rem; user-select: none; }
    .activity-timeline[open] { border-color: var(--accent-purple); }
    .timeline-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .timeline-table td { padding: 0.4rem 0.6rem; border-top: 1px solid var(--border-subtle); vertical-align: middle; }
    .source-badge { font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; white-space: nowrap; }

    /* Security & Performance posture */
    .security-posture, .performance-posture { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem; }
    .security-posture h2 { color: #f97316; font-size: 1rem; margin-bottom: 0.8rem; }
    .performance-posture h2 { color: var(--accent-cyan); font-size: 1rem; margin-bottom: 0.8rem; }
    .security-grid { display: grid; grid-template-columns: 140px 1fr; gap: 0.8rem; align-items: start; }
    .security-score-card { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-left: 3px solid; border-radius: 6px; padding: 1rem; text-align: center; }
    .security-score-value { font-size: 2rem; font-weight: bold; }
    .security-score-label { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem; }
    .security-metrics-card { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.8rem 1rem; }
    .security-metric { display: flex; align-items: center; gap: 0.6rem; padding: 0.3rem 0; font-size: 0.85rem; }
    .security-metric .metric-label { min-width: 120px; }

    /* DORA */
    .dora-section { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem; }
    .dora-section h2 { color: #a78bfa; font-size: 1rem; margin-bottom: 0.8rem; }
    .dora-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.6rem; margin-bottom: 0.8rem; }
    .dora-card { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.8rem; text-align: center; }
    .dora-card .dora-value { font-size: 1.4rem; font-weight: bold; }
    .dora-card .dora-label { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.2rem; }
    .dora-rating { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; text-transform: uppercase; }
    .dora-repo-list { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.6rem 0.8rem; font-size: 0.8rem; max-height: 200px; overflow-y: auto; }
    .dora-repo-row { display: flex; justify-content: space-between; padding: 0.25rem 0; border-bottom: 1px solid var(--border-subtle); }
    .dora-repo-row:last-child { border-bottom: none; }

    /* Cost */
    .cost-section { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem; }
    .cost-section h2 { color: var(--accent-teal); font-size: 1rem; margin-bottom: 0.8rem; }
    .cost-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.6rem; margin-bottom: 0.8rem; }
    .cost-card { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.8rem; text-align: center; }
    .cost-card .cost-value { font-size: 1.4rem; font-weight: bold; }
    .cost-card .cost-label { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.2rem; }
    .cost-recs, .compliance-gaps, .rec-gaps { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.6rem 0.8rem; font-size: 0.8rem; }
    .cost-recs ul, .compliance-gaps ul, .rec-gaps ul { margin: 0; padding-left: 1.2rem; }
    .cost-recs li, .compliance-gaps li, .rec-gaps li { padding: 0.15rem 0; color: var(--text-primary); }

    /* Compliance */
    .compliance-section { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem; }
    .compliance-section h2 { color: var(--accent-orange); font-size: 1rem; margin-bottom: 0.8rem; }
    .compliance-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.6rem; margin-bottom: 0.8rem; }
    .compliance-card { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.8rem; text-align: center; }
    .compliance-card .compliance-value { font-size: 1.4rem; font-weight: bold; }
    .compliance-card .compliance-label { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.2rem; }

    /* Recommendations */
    .rec-section { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem; }
    .rec-section h2 { color: #3b82f6; font-size: 1rem; margin-bottom: 0.8rem; }
    .rec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.6rem; margin-bottom: 0.8rem; }
    .rec-card { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.8rem; text-align: center; }
    .rec-card .rec-value { font-size: 1.4rem; font-weight: bold; }
    .rec-card .rec-label { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.2rem; }

    /* Migration */
    .migration { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem; }
    .migration h2 { color: #a78bfa; font-size: 1rem; margin-bottom: 0.8rem; }
    .migration-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 0.8rem; margin-bottom: 1rem; }
    .migration-card { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.8rem 1rem; }
    .migration-card h3 { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.03em; }
    .migration-stat { display: flex; justify-content: space-between; padding: 0.2rem 0; font-size: 0.85rem; }
    .module-grid { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.5rem; }
    .module-chip { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: rgba(139,92,246,0.15); color: #a78bfa; border: 1px solid rgba(139,92,246,0.3); }
    .module-chip.has-cmd { border-left: 2px solid var(--accent-green); }
    .module-chip.has-qry { border-right: 2px solid var(--accent-blue); }

    /* Back to top */
    .back-to-top {
      position: fixed; bottom: 2rem; right: 2rem;
      background: var(--accent-blue); color: #fff;
      border: none; border-radius: 50%;
      width: 40px; height: 40px; font-size: 1.2rem;
      cursor: pointer; opacity: 0; transition: opacity 0.3s;
      display: flex; align-items: center; justify-content: center;
      z-index: 50;
    }
    .back-to-top.visible { opacity: 1; }

    /* Responsive */
    @media (max-width: 768px) {
      body { padding: 0 0.5rem 1rem; }
      .sticky-nav { padding: 0.4rem 0.5rem; }
      .sticky-nav h1 { font-size: 1rem; }
      .nav-links { display: none; }
      .factory-grid { grid-template-columns: 1fr; }
      .security-grid { grid-template-columns: 1fr; }
      .ok-grid { grid-template-columns: 1fr; }
      .summary { gap: 0.4rem; }
      .summary-item { min-width: 80px; padding: 0.5rem 0.8rem; }
      .summary-item .number { font-size: 1.1rem; }
      .controls { flex-direction: column; align-items: stretch; }
      .search-input { max-width: 100%; }
    }
    @media (max-width: 480px) {
      .summary-item { min-width: 70px; padding: 0.4rem 0.6rem; }
      .summary-item .number { font-size: 1rem; }
      .summary-item .label { font-size: 0.6rem; }
    }
`;
