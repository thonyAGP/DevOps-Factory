# Priorités du portefeuille — 19 octobre 2026

Décision du propriétaire : CasaSync, Zentra, LB2I, Drivyn et Larbin.

| Produit ou service | Dépôt / dépendances | Traitement |
| --- | --- | --- |
| CasaSync | CasaSync | Prioritaire |
| Zentra | zentra | Prioritaire ; audit de sécurité et déploiement Railway à traiter |
| LB2I | LB2I-Fiscal-Manager | Prioritaire |
| Drivyn | CarAssist + drivyn-reports | Prioritaire ; application Android et suivi |
| Larbin | Routine Claude accessible via Telegram | Prioritaire ; configuration distante à vérifier |
| Socle Larbin | Boxmail_cleaning : rappels/ et guichet/ | Préserver les rappels et la validation des envois |
| Soutien | db-backups, DevOps-Factory, claude-dev-config, jira-lb2i | Préserver selon les dépendances des produits prioritaires |
| Autres projets | Inventaire existant | À qualifier ; aucun abandon ni arrêt d'hébergement déduit |

La cartographie de claude-dev-config (plugins/usine-spec/skills/ecosysteme/references/projets.json) rattache routine:Larbin aux services Rappels et guichet de Boxmail. La documentation décrit les routines Claude sur claude.ai ; leur configuration effective n'est pas accessible depuis le connecteur GitHub.

## Effets opérationnels

- Les listes existantes de revues IA sont intersectées avec les priorités : CasaSync reste éligible ; aucun nouvel agent activé.
- L'ancien pilote de réparation LecteurMagic/ClubMed est retiré ; dispatcher inactif tant qu'aucun projet prioritaire n'est explicitement admis.
- Le générateur de tests IA et les PR de formatage ciblent les projets prioritaires compatibles.
- La génération hebdomadaire de tests du contrôleur devient manuelle, liée à une tâche choisie.
- Inventaire, scans de sécurité, surveillance des services exposés et sauvegardes sont conservés.
- Aucun dépôt archivé, domaine, donnée ou service supprimé. Les routines distantes de Larbin ne sont pas modifiées par ces changements GitHub.

Les scores globaux du dashboard ne déterminent pas les priorités métier. Un produit hors priorité encore exposé conserve un besoin de protection.
