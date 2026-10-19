import type { ProjectStatus } from './types.js';

const products = [
  { name: 'CasaSync', repos: ['thonyAGP/CasaSync'] },
  { name: 'Zentra', repos: ['thonyAGP/zentra'] },
  { name: 'LB2I', repos: ['thonyAGP/LB2I-Fiscal-Manager'] },
  { name: 'Drivyn', repos: ['thonyAGP/CarAssist', 'thonyAGP/drivyn-reports'] },
  { name: 'Larbin', repos: [] },
];

/** CI status is deliberately separate from live service availability. */
export const renderPrioritySection = (statuses: ProjectStatus[]): string => {
  const cards = products.map(product => {
    const rows = product.repos.map(repo => {
      const result = statuses.find(p => p.fullName === repo);
      const text = result?.ciStatus === 'pass' ? 'CI réussie'
        : result?.ciStatus === 'fail' ? 'CI en échec' : 'Sans résultat CI affiché';
      return '<p><a href="https://github.com/' + repo + '">' + repo.split('/')[1] + '</a> : ' + text + '</p>';
    }).join('');
    const note = product.name === 'Larbin'
      ? '<p>Agent personnel via Telegram. État du service non vérifié ici. Socle à conserver : Boxmail, Rappels et guichet.</p>' : '';
    return '<div class="alert-card" style="border-left-color:#58a6ff"><h3>' + product.name + '</h3>' + rows + note + '</div>';
  }).join('');
  return '<section aria-label="Priorités métier"><h2>Vos 5 priorités</h2>'
    + '<p>CasaSync, Zentra, LB2I, Drivyn et Larbin. Les résultats CI ne prouvent pas la disponibilité en production.</p>'
    + cards + '</section><h2>Vue globale du parc — surveillance conservée</h2>';
};
