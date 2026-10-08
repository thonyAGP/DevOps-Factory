# CHG-009: Ecosystem Agent V2 - Automatisme complet

**Status**: `ARCHIVED`
**Date**: 2026-04-17 (draft + approved)
**Origine**: V1 livree (CHG-008 ARCHIVED). Le proprietaire veut de l'automatisme : auto-boot, notifications, auto-fix.

## Contexte

V1 fonctionne (29/29 acceptance) mais requiert un demarrage manuel (`pnpm dev`). Pas de notifications, pas d'auto-fix. L'agent doit tourner H24 sans intervention.

## Objectif

Transformer l'Ecosystem Agent d'un outil lance manuellement en un **agent autonome** qui :

- Demarre automatiquement au boot Windows
- Se relance apres crash
- Notifie des alertes critiques (tray icon + toast Windows)
- Corrige automatiquement les problemes low-risk (PRs auto)
- Recherche intelligemment dans la base de connaissances (FTS5)

## Phases

| Phase     | Contenu                                                                            | Critere de succes                                      | Status                                       |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| **V2-P1** | Service Windows valide (node-windows fix + auto-start + auto-restart + smoke test) | `Get-Service Ecosystem-Agent` Running apres reboot     | LIVRE 2026-04-17 (Ecosystem-Agent `678f7a3`) |
| **V2-P2** | Tray icon + notifications (PowerShell .NET NotifyIcon + Task Scheduler)            | Icone visible + toast sur alerte critique              | LIVRE 2026-04-17 (Ecosystem-Agent `b79aacf`) |
| **V2-P3** | FTS5 + score ameliore (knowledge search + divergences dans score sante)            | `ecosystem_knowledge` < 10ms, score inclut divergences | LIVRE 2026-04-17 (Ecosystem-Agent `10cb28d`) |
| **V2-P4** | Auto-fix low-risk (configsync/deps patch auto-push sans approve manuelle)          | PR creee automatiquement pour fix low-risk             | LIVRE 2026-04-17 (Ecosystem-Agent `a6b3624`) |

## Requirements

### R1: Service Windows (V2-P1)

- Le systeme SHALL s'installer comme service Windows via `scripts/install.ps1`
- Le systeme SHALL demarrer automatiquement au boot (startup type = Automatic)
- Le systeme SHALL se relancer automatiquement apres crash (max 5 restarts, backoff 2s)
- Le systeme SHALL etre geré via `Get-Service`, `Start-Service`, `Stop-Service`
- Le systeme SHALL logger dans le Windows Event Viewer
- Le systeme MUST NOT necessiter de `npm install -g` (dep locale uniquement)
- Le systeme SHALL avoir un script `uninstall.ps1` pour desinstallation propre

### R2: Tray Icon + Notifications (V2-P2)

- Le systeme SHALL afficher une icone dans le system tray (vert=ok, rouge=erreur, gris=arrete)
- Le systeme SHALL afficher un menu contextuel (Open Dashboard, Restart Scanner, Stop Agent)
- Le systeme SHALL envoyer une notification Windows toast pour alertes critiques (CVE, secret_leak, CI casse)
- Le systeme SHOULD permettre de configurer les notifications (on/off par type)

### R3: FTS5 + Score (V2-P3)

- Le systeme SHALL utiliser FTS5 pour `ecosystem_knowledge` (remplace LIKE)
- Le systeme SHALL inclure les divergences dans le score sante
- Le systeme SHOULD ameliorer le matching `ecosystem_similar` avec stemming basique

### R4: Auto-fix (V2-P4)

- Le systeme SHALL auto-pusher les fixes configsync quand le risque est low
- Le systeme SHALL auto-pusher les deps upgrade patches (pas minors/majors)
- Le systeme SHALL envoyer une notification pour chaque PR auto-creee
- Le systeme MUST NOT auto-pusher sans que les safety gates passent (git clean, gh auth, etc.)

## Decisions

| #   | Question                 | Decision                                                 | Justification                                                                                |
| --- | ------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Approche service Windows | `node-windows` en dep locale (pas globale) + scripts CJS | Evite les problemes Volta/global. node-windows gere auto-restart et Event Viewer nativement  |
| 2   | Tray icon lib            | PowerShell + .NET NotifyIcon (pas de lib Node)           | Zero npm deps, natif Windows, fiable. Les libs Node tray sont toutes abandonnees ou fragiles |
| 3   | Auto-fix scope           | configsync + deps patch only                             | Risque minimal, pas de changement de code source auto                                        |
