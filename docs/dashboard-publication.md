# Publication du dashboard

Le workflow `dashboard-build.yml` produit le site après les rapports de sécurité,
coût, conformité et recommandations. Le job `build` charge ensuite `dashboard/`
avec `actions/upload-pages-artifact`. Le job `deploy-pages` déploie cet artefact
du même passage, sans nouveau checkout de `master`.

## Fichiers publiés

Le HTML, le rapport quotidien, les statuts et les rapports de présentation
(conformité, coût, DORA, recommandations, posture de sécurité et dérive des
templates) sont générés pendant le passage. Ils ne sont plus suivis par Git.
Ils restent accessibles aux mêmes chemins relatifs dans le site Pages.

Les producteurs historiques de `dashboard/scan-report.json`,
`dashboard/quality-scores.json` et `dashboard/quality-report.md` restent inchangés.
Ces fichiers servent d'entrées au dashboard ou à d'autres scripts.

## État conservé entre les passages

Le workflow ne committe que les fichiers suivants :

- `dashboard/history.json` : tendances et détection des baisses de santé ;
- `data/activity-log.json` : journal partagé des producteurs ;
- `data/alert-tracker.json` : période de grâce des alertes ;
- `data/security-registry.json` et `data/security-registry-history.json` :
  comparaison avec le registre précédent et tendances de sécurité ;
- `data/last-email-digest.txt`, s'il existe : date du dernier courriel envoyé.

La date du courriel est enregistrée après le succès de l'envoi, puis incluse dans
le commit d'état. Un envoi ignoré ou échoué ne marque pas la journée comme traitée.
Les passages du dashboard ne s'annulent plus mutuellement pendant cette séquence.

La synchronisation avec `master` utilise un rebase puis un push normal. Un conflit
fait échouer le passage et reste visible dans Actions ; aucun reset ni restauration
d'un ancien instantané ne remplace les données d'un autre producteur. La publication
attend la réussite du job `build`, y compris la persistance de l'état.

## Vérification après fusion

Au prochain passage du workflow, vérifier le succès du chargement de l'artefact,
du commit d'état et du déploiement Pages. Vérifier également le graphique des
tendances et les sections des rapports sur le site. Le commit automatique ne doit
contenir aucun fichier de présentation.

La rétention des artefacts suit la configuration GitHub Actions du dépôt. L'état
nécessaire au passage suivant reste dans Git et ne dépend pas de cette rétention.
Ce changement freine les nouveaux commits de présentation ; il ne réécrit pas
l'historique Git existant. La concurrence avec les autres workflows producteurs
reste possible et doit être traitée séparément si des conflits persistent.
