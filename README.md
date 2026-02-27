# 📘 goblin-warehouse

## Aperçu

Le module `goblin-warehouse` est un composant central de l'écosystème Xcraft qui fournit un système de stockage et de gestion d'état partagé entre les différents acteurs (Elf et Goblin). Il implémente un mécanisme sophistiqué de gestion des relations entre les entités (branches), avec un système de propriété (ownership) qui permet de suivre les dépendances entre les objets et d'effectuer un nettoyage automatique lorsque les objets ne sont plus référencés.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Détails des sources](#détails-des-sources)
- [Licence](#licence)

## Structure du module

Le module est organisé autour de plusieurs composants clés :

- **Service principal** (`lib/service.js`) : Le cœur du module, acteur Goblin singleton qui gère l'état global du warehouse
- **Garbage Collector** (`lib/garbageCollector.js`) : Système de nettoyage automatique des entités non référencées
- **Explorateur visuel** (`widgets/warehouse-explorer/`) : Interface graphique pour visualiser et analyser l'état du warehouse
- **Utilitaires graphiques** (`lib/dotHelpers.js`) : Génération de représentations visuelles des relations entre branches
- **Tests** (`test/subscriptions.spec.js`) : Suite de tests validant le comportement des subscriptions et du garbage collector

## Fonctionnement global

Le warehouse fonctionne comme une base de données en mémoire qui stocke l'état des acteurs Goblin et Elf. Chaque entité stockée est appelée une **branche** (branch) et peut entretenir des relations parent-enfant avec d'autres branches au sein de **feeds** (canaux de données).

### Architecture des données

```
Warehouse State
├── _creators: {}           # Créateurs de chaque branche (traçabilité)
├── _generations: {}        # Numéros de génération et flags de dispatch
├── _subscriptions: {}      # Abonnements aux feeds avec relations parent/enfant
├── _patchFeeds: {}         # Feeds configurés pour la livraison de patches
├── _maintenance: {}        # Configuration du mode maintenance
├── _lines: {}              # Gestion des notifications de lignes
├── _linesNotifyPayload: bool  # Flag de notification de payload
├── _feedsAggregator: ...   # Agrégateur pour optimiser les notifications
└── [branch@id]: {}         # Données des branches elles-mêmes
```

### Système de propriété (Ownership)

Le warehouse implémente un graphe orienté de relations :

- **Branches** : Entités identifiées par `namespace@id` (instances) ou `namespace` (singletons)
- **Parents/Enfants** : Relations hiérarchiques maintenues dans les deux sens
- **Feeds** : Canaux regroupant des branches pour diffusion aux clients
- **Générations** : Versioning pour le suivi des changements et les acknowledgments

### Feeds et système de patches

Les feeds sont des canaux de données auxquels les clients s'abonnent pour recevoir les mises à jour en temps réel :

1. **Première livraison** : L'état complet du feed est envoyé via l'événement `<feed>.changed` avec `_xcraftPatch: false`
2. **Mises à jour suivantes** : Seuls les diffs (patches) sont envoyés avec `_xcraftPatch: true`
3. **Agrégation** : Un `MapAggregator` regroupe les notifications en fenêtres de 50ms pour réduire la charge

### Garbage Collection automatique

Le `GarbageCollector` surveille les relations et supprime automatiquement :

- Les branches sans parents valides (immédiatement collectées à l'upsert)
- Les cascades de suppression lors de la suppression d'un parent
- Les feeds vides après suppression de toutes leurs branches
- Les branches ORC (`goblin-orc@`) qui déclenchent un auto-release

Le debouncing à 50ms évite les suppressions prématurées lors d'opérations en rafale. L'événement `warehouse.released` est émis en batch pour notifier les branches collectées.

### Mode maintenance

Le mode maintenance permet de restreindre les opérations du warehouse à un ORC spécifique (`orcName`), empêchant les modifications concurrentes lors des mises à jour critiques.

## Exemples d'utilisation

### Gestion basique des branches

```javascript
// S'abonner à un feed
await this.quest.warehouse.subscribe({
  feed: 'myFeed',
  branches: ['entity@1', 'entity@2'],
});

// Ajouter une entité avec relations de propriété
await this.quest.warehouse.upsert({
  branch: 'entity@3',
  data: {id: 'entity@3', name: 'Mon entité', status: 'active'},
  feeds: 'myFeed',
  parents: 'entity@1',
  generation: 1,
});

// Récupérer des données
const entity = await this.quest.warehouse.get({path: 'entity@3'});

// Vérifier l'existence
const exists = await this.quest.warehouse.has({path: 'entity@3'});
```

### Requêtes avancées

```javascript
// Recherche par type avec filtres (AND entre critères)
const activeEntities = await this.quest.warehouse.query({
  feed: 'myFeed',
  type: 'entity',
  filter: {status: 'active'},
  view: ['id', 'name', 'status'],
});

// Recherche par IDs spécifiques
const specificEntities = await this.quest.warehouse.query({
  ids: ['entity@1', 'entity@3'],
  view: ['id', 'name'],
});

// Recherche multi-types
const mixed = await this.quest.warehouse.query({
  feed: 'myFeed',
  type: ['actor1', 'actor2'],
});
```

### Gestion des relations hiérarchiques

```javascript
// Attacher une branche à un parent supplémentaire
await this.quest.warehouse.attachToParents({
  branch: 'child@1',
  parents: ['parent@1', 'parent@2'],
  feeds: 'myFeed',
  generation: 2,
});

// Détacher d'un parent (déclenche une collecte si plus aucun parent)
await this.quest.warehouse.detachFromParents({
  branch: 'child@1',
  parents: ['parent@1'],
  feed: 'myFeed',
});

// Vérifier les abonnements d'une branche
const feeds = await this.quest.warehouse.getBranchSubscriptions({
  branch: 'child@1',
  filters: ['system'],
});
```

### Opérations par lot

```javascript
// Mise à jour de plusieurs branches en une fois
await this.quest.warehouse.upsertInBatch({
  branches: {
    'item@1': {id: 'item@1', value: 100},
    'item@2': {id: 'item@2', value: 200},
    'item@3': {id: 'item@3', value: 300},
  },
  parents: 'container@1',
  feeds: 'itemsFeed',
});

// Suppression en lot (contourne le système d'ownership)
await this.quest.warehouse.removeBatch({
  branches: ['item@1', 'item@2', 'item@3'],
});
```

### Greffage entre feeds

```javascript
// Copier une branche et ses ancêtres vers un autre feed (top-down)
await this.quest.warehouse.graft({
  branch: 'entity@4',
  fromFeed: 'sourceFeed',
  toFeed: 'targetFeed',
});

// Copier une branche et ses descendants (bottom-up)
await this.quest.warehouse.graft({
  branch: 'entity@4',
  fromFeed: 'sourceFeed',
  toFeed: 'targetFeed',
  reverse: true,
});
```

### Maintenance et diagnostic

```javascript
// Activer le mode maintenance
await this.quest.warehouse.maintenance({
  enable: true,
  description: 'Mise à jour système en cours',
  orcName: 'maintenance-orc',
});

// Vérifier l'intégrité du warehouse
await this.quest.warehouse.check();

// Lister les feeds actifs
const feeds = await this.quest.warehouse.listFeeds();

// Forcer la synchronisation immédiate d'un feed
await this.quest.warehouse.syncChanges({feed: 'myFeed'});

// Renvoyer l'état complet d'un feed
await this.quest.warehouse.resend({feed: 'myFeed'});

// Générer des graphiques de visualisation
await this.quest.warehouse.graph({output: '/tmp/warehouse-graphs'});
```

## Interactions avec d'autres modules

Le warehouse est un composant fondamental qui interagit avec l'ensemble de l'écosystème Xcraft :

- **[xcraft-core-goblin]** : Fournit les mécanismes de base Goblin (quêtes, Shredder, dispatch)
- **[xcraft-core-utils]** : `MapAggregator` pour l'agrégation efficace des notifications de changement
- **[xcraft-core-busclient]** : Communication événementielle pour l'émission des événements `warehouse.released`
- **[xcraft-core-log]** : Journalisation des avertissements et erreurs internes
- **[xcraft-immutablediff]** : Calcul optimisé des diffs entre états Immutable.js pour les patches
- **[xcraft-jsonviz]** : Génération de graphiques au format DOT (Graphviz)

Le warehouse alimente indirectement tous les composants React de l'application via le mécanisme de feeds, qui transmet les mises à jour d'état aux clients abonnés ([goblin-laboratory] agit comme pont entre le warehouse et les widgets).

## Détails des sources

### `warehouse.js` et `warehouse-explorer.js`

Points d'entrée exposant les commandes Xcraft via `exports.xcraftCommands`. `warehouse.js` redirige vers `lib/service.js` et `warehouse-explorer.js` redirige vers `widgets/warehouse-explorer/service.js`. Ces fichiers permettent au framework de découvrir et charger dynamiquement les commandes sur le bus Xcraft au démarrage.

### `lib/service.js`

Service principal implémentant un acteur **Goblin singleton**. Il est initialisé via `Goblin.createSingle` et expose ses quêtes sur le bus Xcraft.

#### État et modèle de données

| Champ                 | Type                                                               | Description                                                           |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `_creators`           | `{[branch]: creator}`                                              | Créateur de chaque branche en cours de création                       |
| `_generations`        | `{[branch]: {generation, hasDispatched}}`                          | Versioning et flag de dispatch de chaque branche                      |
| `_subscriptions`      | `{[feed]: {branches: {[branch]: {parents, children}}, views: {}}}` | Structure complète des abonnements                                    |
| `_patchFeeds`         | `{[feed]: true}`                                                   | Feeds activés pour la livraison de patches                            |
| `_maintenance`        | `{enable, description, orcName}`                                   | Configuration du mode maintenance                                     |
| `_lines`              | `{[lineId]: {[orcName$token]: count}}`                             | Compteurs de lignes de mise à jour                                    |
| `_linesNotifyPayload` | `boolean`                                                          | Indique si le payload doit être inclus dans la notification de lignes |
| `_feedsAggregator`    | `MapAggregator`                                                    | Instance d'agrégateur pour les notifications de changement            |
| `[branch@id]`         | `object`                                                           | Données effectives de chaque branche                                  |

#### Méthodes publiques

- **`upsert(branch, data, parents, feeds, generation)`** — Ajoute ou met à jour une branche. Gère les relations d'ownership, met à jour les générations, et notifie les feeds abonnés via le `_feedsAggregator`. Les branches sans parents valides dans aucun feed sont immédiatement collectées.

- **`upsertInBatch(branches, parents, feeds)`** — Effectue plusieurs `upsert` successifs pour un ensemble de branches partageant les mêmes parents et feeds. Optimisé pour les mises à jour groupées.

- **`get(path, view)`** — Récupère la valeur à un chemin donné dans l'état. Supporte un paramètre `view` (liste de propriétés) pour filtrer le résultat via `Shredder.pluck`.

- **`has(path)`** — Vérifie l'existence d'un chemin dans l'état du warehouse.

- **`hasFeed(feedName)`** — Vérifie si un feed est actuellement actif dans les subscriptions.

- **`query(feed, ids, type, filter, view)`** — Requête avancée sur l'état. Filtre par type (préfixe avant `@`), par IDs, et applique des filtres de propriétés (AND). Supporte les vues pour réduire les données retournées. Si `feed` est fourni, restreint la recherche aux branches de ce feed.

- **`subscribe(feed, branches)`** — Crée ou met à jour un abonnement à un feed. Enregistre le feed comme patch-feed et initialise les relations d'ownership pour chaque branche. Émet `<feed-subscriptions-changed>`.

- **`unsubscribe(feed)`** — Supprime un abonnement et déclenche la collecte en cascade de toutes les branches du feed. Émet `<feed-subscriptions-changed>`.

- **`feedSubscriptionAdd(feed, branch, parents)`** — Ajoute dynamiquement une branche à un feed existant via `attach-to-parents`.

- **`feedSubscriptionDel(feed, branch, parents)`** — Retire dynamiquement une branche d'un feed via `detach-from-parents`.

- **`attachToParents(branch, generation, parents, feeds, view)`** — Établit des relations parent-enfant avec validation rigoureuse. Si un parent est introuvable, l'attachement est refusé. Retourne `true` si l'attachement est effectif. Supporte optionnellement une vue pour restreindre les données diffusées.

- **`detachFromParents(branch, parents, feed)`** — Supprime des relations parent-enfant. Si la branche n'a plus de parents dans un feed, elle est collectée. Déclenche la désinscription du feed si la branche principale du feed disparaît.

- **`deleteBranch(branch)`** — Supprime une branche en déclenchant `unsubscribeBranch` sur l'ensemble des feeds. Les branches `goblin-orc@` déclenchent un auto-release.

- **`graft(branch, fromFeed, toFeed, reverse)`** — Copie une sous-arborescence d'un feed à un autre. En mode normal (top-down), copie la branche et tous ses ancêtres. En mode `reverse` (bottom-up), copie la branche et tous ses descendants.

- **`acknowledge(branch, generation)`** — Confirme la suppression d'une branche en vérifiant que la génération correspond. Si validé, supprime la branche et sa génération de l'état.

- **`release(branch)`** — Supprime explicitement une branche de l'état via `removeBatch` et émet l'événement `released`.

- **`removeBatch(branches)`** — Supprime plusieurs branches et leurs générations directement de l'état, sans passer par le système d'ownership.

- **`resend(feed)`** — Renvoie l'état complet d'un feed à tous ses abonnés, en réinitialisant l'historique des patches pour forcer une livraison complète.

- **`getCreator(branch)`** — Retourne le créateur enregistré d'une branche en cours de création.

- **`delCreator(branch)`** — Supprime le créateur d'une branche et la détache du parent virtuel `new`.

- **`getBranchSubscriptions(branch, filters)`** — Retourne la liste des feeds contenant une branche donnée, avec filtrage optionnel par préfixe.

- **`requestLineUpdate(type, lineId, orcName, token, generation)`** — Gère les compteurs de lignes de mise à jour (add/delete). Émet `lines-updated` avec le payload des lignes si nécessaire.

- **`maintenance(enable, description, orcName)`** — Active ou désactive le mode maintenance. En mode actif, seul l'ORC désigné peut effectuer des opérations.

- **`check()`** — Analyse l'état pour détecter les branches orphelines (parents manquants dans les feeds) et les branches pendantes (présentes dans l'état mais absentes de tous les feeds). Journalise les résultats.

- **`checkOrphan()`** — Retourne la liste des branches dont un parent est référencé dans un feed mais absent de l'état.

- **`checkDangling()`** — Retourne la liste des branches présentes dans l'état mais non référencées dans aucun feed.

- **`status()`** — Journalise l'état complet des subscriptions et des générations pour débogage.

- **`graph(output)`** — Génère deux fichiers `.dot` dans le répertoire `output` : un graphique simple (layout `fdp`) et un graphique détaillé (layout `dot`), horodatés.

- **`syncChanges(feed)`** — Force le `_feedsAggregator` à livrer immédiatement les changements en attente pour un feed.

- **`listFeeds()`** — Retourne la liste des feeds actifs, en excluant les feeds système (`system*` et `null`).

### `lib/garbageCollector.js`

Classe `GarbageCollector` spécialisée dans la gestion du cycle de vie des branches. Elle est instanciée une seule fois au niveau du module avec un callback `feedDispose`.

#### Fonctionnement du garbage collection

1. **`_collect`** : Retire une branche d'un feed en mettant à jour les relations bidirectionnelles parents/enfants. Si un enfant n'a plus de parents dans ce feed, il est ajouté à la liste de collecte pour traitement en cascade. Si la branche n'est plus dans aucun feed, elle est ajoutée à `_collectable` pour émission de l'événement `warehouse.released` avec debounce de 50ms.

2. **`_purgeCollectable`** : Émet l'événement `warehouse.released` en batches de 50 entrées contenant les branches collectées et leur génération.

3. **Auto-release** : Les branches `goblin-orc@` sont supprimées de l'état immédiatement sans attendre un `acknowledge`.

#### Méthodes principales

- **`updateOwnership(state, immState, branch, parents, feeds, isCreating, creator)`** — Met à jour les relations de propriété pour une branche dans plusieurs feeds. Valide l'existence de tous les parents ; si un parent est manquant, la branche est immédiatement collectée. Gère le marqueur `new` pour les branches en cours de création.

- **`unsubscribeBranch(state, branch, feed, autoRelease)`** — Point d'entrée principal du GC. Lance une boucle de collecte qui propage les suppressions aux enfants orphelins.

- **`getOwnership(state, path)`** — Récupère ou initialise une structure d'ownership `{parents: {}, children: {}}`.

- **`inFeeds(state, branch)`** — Vérifie si une branche est présente dans au moins un feed.

- **`inFeed(state, feed, branch)`** — Vérifie si une branche est présente dans un feed spécifique.

- **`inPatchFeed(state, feed, branch)`** — Vérifie si une branche est dans un feed configuré pour les patches.

- **`extractFeeds(state, branch)`** — Retourne un mapping `{feed: {branch: true}}` pour tous les feeds contenant la branche.

- **`extractPatchFeeds(state, branch)`** — Retourne la liste des feeds patch contenant la branche.

### `lib/dotHelpers.js`

Utilitaires pour la génération de graphiques Graphviz (format DOT) via [xcraft-jsonviz].

**`generateGraph({type, layout}, state)`** — Génère un objet `JsonViz` représentant l'ensemble des feeds et leurs relations. Supporte deux modes de rendu : `'simple'` (nœuds circulaires compacts) et `'complexe'` (tableaux HTML détaillés avec métadonnées de génération et d'état).

La coloration sémantique des nœuds reflète le type d'acteur selon le suffixe du namespace : `-worker` (cyan), `-workitem` (magenta), `-feeder` (jaune), `-updater` (vert), `-dispatcher` (bleu), autres (gris).

### `widgets/warehouse-explorer/service.js`

Service Goblin (acteur instanciable, non singleton) dédié à l'interface d'exploration. Expose trois quêtes principales :

- **`create(desktopId)`** — Initialise l'explorateur en récupérant la liste des feeds actifs depuis le warehouse.
- **`explore(type, value)`** — Charge la structure d'un feed spécifique pour visualisation (branches, parents, enfants).
- **`check()`** — Lance les vérifications d'intégrité (`checkDangling`, `checkOrphan`) et stocke les résultats dans l'état.
- **`delete()`** — Destructeur de l'instance (vide).

### `widgets/warehouse-explorer/widget.js`

Composant React principal (`WarehouseExplorer`) intégrant une interface à deux panneaux :

**Panneau gauche** : liste cliquable des feeds actifs (boutons) et arbre hiérarchique (`SubscriptionTree`) affichant les branches du feed sélectionné via le composant `Tree` de goblin-gadgets.

**Panneau droit** : graphique interactif (`Graph` / `SubGraph`) utilisant [react-cytoscapejs] avec l'algorithme de layout `dagre` (orientation gauche-droite). Les nœuds représentent les branches, les arêtes les relations parent/enfant. Le composant `Graph` gère l'adaptation Immutable.js via les méthodes `getImm`, `toJsonImm` et `diffImm`.

Les deux sous-composants (`SubGraph`, `Tree1`, `WarehouseExplorer`) utilisent `Widget.connect` pour se connecter à l'état du backend warehouse-explorer.

**Exemple d'utilisation** :

```jsx
<Explorer id={workitemId} desktopId={desktopId} />
```

Props connectées via `Widget.connect` : `subs` (liste des feeds), `sub` (feed sélectionné), `orphan` (résultats de vérification), `dangling` (résultats de vérification).

### `widgets/warehouse-explorer/view.js`

Vue principale (`WarehouseExplorerView`) qui compose l'interface complète : un titre avec icône de base de données et le widget `Explorer`. Dérive de `View` fourni par goblin-laboratory.

### `widgets/warehouse-explorer/styles.js`

Définit le style `tree` pour le conteneur de l'arbre hiérarchique : `flexGrow: 1`, `display: flex`, `flexDirection: column`, permettant à l'arbre d'occuper tout l'espace disponible.

### `test/subscriptions.spec.js`

Suite de tests Mocha/Chai validant le comportement du warehouse via `Elf.Runner`. Les tests couvrent :

**Tests de base** : `upsertHas` (ajout et vérification), `collectSingle` (collecte d'une branche sans parent valide), `collectedBecauseNoSubscriber` (collecte immédiate si le feed parent n'existe pas dans les subscriptions).

**Tests de cascade** : `collectSimpleCascade` (suppression en cascade linéaire), `collectMultiCascade` (suppression en cascade arborescente multi-niveaux).

**Tests multi-feeds** : `subTwoFeeds` (partage de branche entre feeds avec suppression sélective), `subTwoDeepFeeds` (propriété multiple avec conservation inter-feeds), `subExtraDeepFeeds` (hiérarchies profondes avec détachement partiel), `subAndUnsubFeed` (cycle complet d'abonnement/désabonnement).

**Tests de greffage** : `graft topdown` (copie ascendante d'une branche vers un autre feed), `graft bottomup` (copie descendante avec `reverse: true`).

**Tests de relations** : `attachParents` (attachement dynamique à un parent supplémentaire).

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

---

[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-log]: https://github.com/Xcraft-Inc/xcraft-core-log
[xcraft-immutablediff]: https://github.com/Xcraft-Inc/immutable-js-diff
[xcraft-jsonviz]: https://github.com/Xcraft-Inc/jsonviz
[goblin-laboratory]: https://github.com/Xcraft-Inc/goblin-laboratory
[react-cytoscapejs]: https://github.com/plotly/react-cytoscapejs

_Ce contenu a été généré par IA_
