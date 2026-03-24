import { readFileSync, existsSync } from 'node:fs';
import type { MigrationSnapshot } from '../types.js';

export const getMigrationSection = (): string => {
  const latestPath = 'data/migration-latest.json';
  if (!existsSync(latestPath)) return '';

  try {
    const snap = JSON.parse(readFileSync(latestPath, 'utf-8')) as MigrationSnapshot;
    const b = snap.backend;
    const f = snap.frontend;
    const s = snap.specs;
    const pct = snap.overall.progressPercent;
    const pctColor = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';

    const moduleChips = b.modules
      .map((m) => {
        const cls = ['module-chip', m.hasCommands ? 'has-cmd' : '', m.hasQueries ? 'has-qry' : '']
          .filter(Boolean)
          .join(' ');
        return `<span class="${cls}" title="${m.handlerCount} handlers">${m.name}</span>`;
      })
      .join('\n            ');

    return `
  <div class="migration">
    <h2>Lecteur Magic Migration (${snap.date})</h2>
    <div class="migration-grid">
      <div class="migration-card">
        <h3>Overall Progress</h3>
        <div class="migration-stat"><span>Progress</span><span class="val" style="color:${pctColor}">${pct}%</span></div>
        <div class="progress-bar"><div class="fill" style="width:${pct}%;background:${pctColor}"></div></div>
        <div class="migration-stat" style="margin-top:0.4rem"><span>Total files</span><span class="val">${snap.overall.totalFiles}</span></div>
      </div>
      <div class="migration-card">
        <h3>Backend (Caisse.API)</h3>
        <div class="migration-stat"><span>CQRS Modules</span><span class="val">${b.moduleCount}</span></div>
        <div class="migration-stat"><span>Handlers</span><span class="val">${b.totalHandlers}</span></div>
        <div class="migration-stat"><span>Domain entities</span><span class="val">${b.domainEntities}</span></div>
        <div class="migration-stat"><span>C# files</span><span class="val">${b.csFiles}</span></div>
      </div>
      <div class="migration-card">
        <h3>Tests</h3>
        <div class="migration-stat"><span>Test files</span><span class="val">${b.testFiles}</span></div>
        <div class="migration-stat"><span>Est. tests</span><span class="val">~${b.testCount}</span></div>
        <div class="progress-bar"><div class="fill" style="width:${Math.min(100, (b.testCount / 200) * 100)}%;background:#58a6ff"></div></div>
      </div>
      <div class="migration-card">
        <h3>Frontend (adh-web)</h3>
        <div class="migration-stat"><span>React components</span><span class="val">${f.reactComponents}</span></div>
        <div class="migration-stat"><span>TS files</span><span class="val">${f.tsFiles}</span></div>
        <div class="migration-stat"><span>HTML prototypes</span><span class="val">${f.htmlPages}</span></div>
        <div class="migration-stat"><span>Storybook</span><span class="val">${f.hasStorybook ? 'Yes' : 'No'}</span></div>
      </div>
      <div class="migration-card">
        <h3>OpenSpec</h3>
        <div class="migration-stat"><span>Total specs</span><span class="val">${s.totalSpecs}</span></div>
        <div class="migration-stat"><span>Annotated</span><span class="val">${s.annotatedPrograms}</span></div>
        <div class="migration-stat"><span>Patterns</span><span class="val">${s.migrationPatterns}</span></div>
        <div class="migration-stat"><span>Migration docs</span><span class="val">${s.migrationDocs}</span></div>
      </div>
    </div>
    <details>
      <summary style="cursor:pointer;color:#8b949e;font-size:0.85rem">Migrated Modules (${b.moduleCount})</summary>
      <div class="module-grid" style="margin-top:0.5rem">
        ${moduleChips}
      </div>
      <div style="font-size:0.7rem;color:#6e7681;margin-top:0.4rem">
        Green border = Commands | Blue border = Queries
      </div>
    </details>
  </div>`;
  } catch {
    return '';
  }
};
