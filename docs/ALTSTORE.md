# App iOS compagnon — contraintes de sideload (AltStore, sans compte dev payant)

L'app iOS sert uniquement à **maintenir la session vivante** et à **remonter la
position réelle** au moteur. Elle sera distribuée par **sideload via AltStore**,
avec un **Apple ID gratuit** (pas de compte développeur payant). Ces contraintes
doivent être intégrées dès la conception.

## Ce que le provisioning gratuit impose

- **Certificat valable 7 jours** : l'app expire et doit être **re-signée**. AltStore
  le fait automatiquement tant que l'iPhone est sur le même réseau qu'**AltServer**
  (laisser AltServer tourner sur le PC). → À documenter pour l'utilisateur.
- **Pas d'APNs / push distant** : aucune notification push, donc le **keep-alive ne
  doit jamais dépendre du push**.
- **Max 3 apps** sideloadées simultanément, quota d'App IDs limité → **un seul bundle
  ID stable**.
- Entitlements avancés (associated domains, etc.) indisponibles.

## Stratégie keep-alive (sans push)

- Utiliser le **background location** (que l'app fait déjà pour remonter la position
  réelle) comme mécanisme de maintien en vie + reconnexion du WebSocket. C'est
  aligné avec la raison d'être de l'app et **fonctionne en provisioning gratuit**.
- Background modes à activer : `location`, éventuellement `fetch`/`processing`
  (`BGTaskScheduler`). Reconnexion auto du WebSocket au réveil.

## Live Activities / Dynamic Island

- Les **mises à jour locales** (ActivityKit, même device) sont possibles ; les
  **mises à jour distantes** (par push) ne le sont pas. → Garder la Dynamic Island
  **optionnelle** et purement locale.

## Conséquences sur le contrat

- L'app iOS ne consomme **que** l'API du moteur (`/spec`). Les actions clés côté
  app : `HEARTBEAT`, `REAL_LOCATION` (anti-dérive), réception de `STATUS`/`LOCATION`.
- Aucune dépendance à une capacité payante : tout le reste vit côté moteur (PC/serveur).
