# Suivi des incidents et des résultats automatiques

## Signaux à distinguer

- Une CI verte prouve le résultat des contrôles de ce commit.
- Une PR fusionnée prouve son acceptation ; elle ne prouve pas que la panne de production a disparu.
- Un journal récent prouve qu'une routine a écrit. Lire aussi son résultat et les étapes en échec.
- Une sonde HTTP disponible ne prouve pas que tous les traitements métier progressent.

Pour chaque incident, conserver le dépôt, le flux, la version, la première et la dernière occurrence,
une empreinte stable, le lien du diagnostic, la correction associée et la preuve du retour au service.
Dédupliquer les exports qui recouvrent une même session. Publier les détails d'un projet privé
dans son dépôt ou son espace de suivi privé.

## Résultats des agents

`feedback-collector.ts` examine au plus 100 PR récentes par dépôt configuré. Il reconnaît les marqueurs
explicites de branche, label et titre utilisés par les automatisations. Les catégories configuration,
remédiation, tests, formatage et auto-réparation sont distinguées. Une PR sans marqueur ne reçoit
aucun crédit d'automatisation.

Les anciennes attributions sont conservées comme historique mais exclues des chiffres jusqu'à
relecture des métadonnées GitHub. Les dates de création, fermeture et fusion viennent de GitHub.
Les changements d'état sont sauvegardés dans la même instance du journal. Une PR fusionnée
reste « fusionnée » quel que soit son nombre de commits ; celui-ci ne démontre pas une intervention humaine.
Un échec de lecture GitHub rend le passage en erreur et bloque la publication du rapport hebdomadaire.

La limite de 100 PR est une fenêtre de collecte, pas une garantie de couverture historique complète.
Les niveaux de confiance historiques des patterns ne sont pas recalculés rétroactivement par cette correction.

## Continuité du suivi CI

Le workflow CI Health Check conserve ensemble :

- `data/activity-log.json` ;
- `data/ci-failure-tracker.json` ;
- `data/escalation-tracker.json` ;
- `data/self-heal-cooldowns.json`.

Sans ces fichiers, un runner neuf recommence au premier échec et peut différer une alerte indéfiniment.
Leurs versions produites par le passage sont préservées aussi dans le chemin de repli après conflit de rebase.
Les cooldowns sont fusionnés par dépôt en conservant la date la plus récente, pour préserver les
lancements concurrents enregistrés par Factory Watchdog.
Une tentative d'auto-réparation n'est enregistrée comme lancée que si le dispatch a réussi.

Après déploiement, vérifier deux passages espacés d'au moins deux heures sur un incident persistant :
la première occurrence doit rester stable, le compteur augmenter, et l'alerte dépasser sa période d'attente.
Après retour au vert, les compteurs de l'incident doivent disparaître.
