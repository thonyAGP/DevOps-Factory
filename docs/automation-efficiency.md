# Automatisations : produire un résultat avant de recommencer

## Inventaire et rapports

Le scanner et la synchronisation du registre partagent l'inventaire **brut** de
GitHub. Un jeton App utilise `installation/repositories` ; une authentification
personnelle peut utiliser `user/repos`. Toutes les pages sont lues. Le champ
`pushed_at` évite un appel supplémentaire par dépôt.

Un refus d'accès, une réponse invalide ou un inventaire vide fait échouer le
scanner avant de remplacer `dashboard/scan-report.json`. Une liste sans projet
reconnu est également refusée. Le dashboard refuse de publier un rapport sans
projet surveillé : zéro donnée ne signifie pas zéro panne.

Les scans planifiés actualisent l'inventaire sans ouvrir de PR de configuration.
La configuration reste disponible explicitement :

```bash
pnpm scan -- --configure
```

Sur GitHub Actions, lancer **Scan Repos** avec `configure: true`. L'option est
désactivée par défaut, notamment pour éviter une vague de PR lors de la reprise
d'un inventaire précédemment cassé.

## Une PR préparée attend d'abord une revue

Avant toute remédiation, le dispatcher lit les PR ouvertes, puis les runs actifs.
Il ne lance pas d'agent si :

- une PR `ai-fix/`, `ai-remediation/`, `reparateur/`, portant un label `ai-fix` ou
  `ai-remediation`, ou un titre contenant `(central-scan)`, attend une revue ;
- le workflow de remédiation est en cours, en file ou en attente ;
- GitHub ne permet pas de vérifier ces conditions. Ce dernier cas donne un
  échec visible, pas un feu vert.

Un dépôt bloqué ne consomme pas le quota et laisse sa place au suivant. Le
workflow persiste les lancements déjà effectués même si un contrôle ultérieur
échoue pendant le même passage. Le
dry-run applique les mêmes contrôles sans lancer d'agent ni écrire d'état. Le
dispatcher reste manuel et conserve l'allowlist, le seuil de risque et le quota
de `REMEDIATION_CONFIG`.

Le self-heal vérifie également les PR préparées **avant** de télécharger les
journaux ou de cloner le dépôt. Un passage bloqué ne compte pas comme une
tentative de réparation et ne renvoie pas une notification identique. Sans
fichier source exploitable, il s'abstient d'appeler un modèle et journalise
`skip-no-source`.

## Vérifier

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Factory CI exécute désormais aussi les tests. Les régressions couvertes incluent
les permissions refusées, la pagination, le cache vide, une PR déjà préparée,
les agents en attente, le quota après un dépôt bloqué et l'absence de donnée
dans le rapport quotidien.
