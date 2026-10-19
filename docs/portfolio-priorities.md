# Priorités du portefeuille — 19 octobre 2026

Décision du propriétaire : CasaSync, Zentra, LB2I, Drivyn et Larbin.

| Produit ou service | Dépôt / dépendances | Traitement |
| --- | --- | --- |
| CasaSync | CasaSync | Prioritaire |
| Zentra | zentra | Prioritaire ; production documentée sur Oracle (zentra.lb2i.com), commit servi à vérifier |
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

## Hébergement réel et preuve de livraison

Le runbook actuel de Zentra (`deploy/oracle/README.md`) et CHG-007 décrivent la production sur la VM Oracle de Boxmail, avec pm2 zentra-api/zentra-web. Vercel et Railway y sont écartés comme hébergement du service utilisé. Un statut Vercel réussi ne prouve donc pas que zentra.lb2i.com sert le correctif, et un statut Railway en échec ne prouve pas une panne de cette production. Le commit et la version doivent être vérifiés sur Oracle avant toute conclusion.

Le correctif Zentra #79 est fusionné et la CI complète passe : runtime audité sans critique (50 high restent), 888 tests API, 707 tests web et build de 34 routes. La livraison Oracle reste à exécuter avec l'accès serveur ; aucune connexion SSH/Oracle ni RemoteTrigger n'est fournie dans la session d'audit.

La source précise de Larbin est `Boxmail_cleaning`, branche `main`, `deploy/larbin/routine.md` : routine Claude avec veille horaire de 05 h à 21 h UTC et fenêtre de 58 minutes. Le runbook OpenClaw indique cette ancienne voie dormante. Ce sont des informations versionnées ; l'état actuel de la routine sur claude.ai n'est pas prouvé par GitHub.

Le dépôt Boxmail a une branche par défaut de session différente de `main`, que son runbook suit pour le déploiement. Le choix de la branche de référence doit être vérifié avant de conclure à l'absence de source, de CI ou de service.
