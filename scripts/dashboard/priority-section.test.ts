import { expect, it } from 'vitest';
import { renderPrioritySection } from './priority-section.js';
import type { ProjectStatus } from './types.js';

it('shows the five products and never invents a healthy Larbin status', () => {
  const html = renderPrioritySection([]);
  for (const name of ['CasaSync', 'Zentra', 'LB2I', 'Drivyn', 'Larbin']) expect(html).toContain('<h3>' + name + '</h3>');
  expect(html).toContain('État du service non vérifié ici');
  expect(html).toContain('Sans résultat CI affiché');
});

it('keeps a failing priority visible instead of using the global quality score', () => {
  const status = { fullName: 'thonyAGP/zentra', ciStatus: 'fail' } as ProjectStatus;
  expect(renderPrioritySection([status])).toContain('zentra</a> : CI en échec');
});
