# 📘 Documentation du module goblin-warehouse

## Aperçu

Le module `goblin-warehouse` est un composant central de l'écosystème Xcraft qui fournit un système de stockage et de gestion d'état partagé entre les différents acteurs (Elf et Goblin). Il implémente un mécanisme sophistiqué de gestion des relations entre les entités (branches), avec un système de propriété (ownership) qui permet de suivre les dépendances entre les objets et d'effectuer un nettoyage automatique lorsque les objets ne sont plus référencés.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est organisé autour de plusieurs composants clés :

- **Service principal** (`lib/service.js`) : Le cœur du module qui gère l'état global du warehouse
- **Garbage Collector** (`lib/garbageCollector.js`) : Système de nettoyage automatique des entités non référencées
- **Explorateur visuel** (`widgets/warehouse-explorer/`) : Interface graphique pour visualiser et analyser l'état
- **Utilitaires graphiques** (`lib/dotHelpers.js`) : Génération de représentations visuelles des relations
- **Tests complets** (`test/subscriptions.spec.js`) : Suite de tests pour valider le comportement

## Fonctionnement global

Le warehouse fonctionne comme une base de données en mémoire qui stocke l'état des acteurs Goblin et Elf. Chaque entité stockée est appelée une "branche" (branch) et peut avoir des relations parent-enfant avec d'autres branches.

### Architecture des données

```
Warehouse State
├── _creators: {}           # Créateurs de chaque branche
├── _generations: {}        # Numéros de génération et flags
├── _subscriptions: {}      # Abonnements aux feeds avec relations
├── _patchFeeds: {}        # Feeds configurés pour les patches
├── _maintenance: {}       # Configuration du mode maintenance
├── _lines: {}             # Gestion des lignes de mise à jour
└── [branches]: {}         # Données des branches elles-mêmes
```

### Système de propriété (Ownership)

Le warehouse implémente un système de propriété sophistiqué où :

1. **Branches** : Entités stockées avec un identifiant unique
2. **Parents/Enfants** : Relations hiérarchiques entre branches
3. **Feeds** : Canaux de données qui regroupent des branches
4. **Générations** : Versioning pour le suivi des changements

### Feeds et Subscriptions

Les "feeds" sont des canaux de données auxquels les clients peuvent s'abonner :

- **Subscription** : Abonnement à un feed pour recevoir les mises à jour
- **Patch system** : Envoi optimisé des changements via des diffs
- **Aggregation** : Regroupement des notifications pour optimiser les performances

### Garbage Collection automatique

Le garbage collector surveille les relations et supprime automatiquement :

- Les branches sans parents (orphelines)
- Les branches non référencées dans aucun feed
- Les cascades de suppression lors de la suppression d'un parent

### Système de génération et versioning

- Chaque branche possède un numéro de génération incrémenté à chaque modification
- Permet d'éviter les conflits lors des mises à jour concurrentes
- Support des acknowledgments pour confirmer la réception des changements

## Exemples d'utilisation

### Gestion basique des branches

```javascript
// Créer et abonner un feed
await this.quest.warehouse.subscribe({
  feed: 'myFeed',
  branches: ['entity@1', 'entity@2'],
});

// Ajouter une entité avec relations
await this.quest.warehouse.upsert({
  branch: 'entity@3',
  data: {id: 'entity@3', name: 'My Entity', status: 'active'},
  feeds: 'myFeed',
  parents: 'entity@1',
  generation: 1,
});

// Récupérer des données
const entity = await this.quest.warehouse.get({
  path: 'entity@3',
});

// Récupérer une propriété spécifique
const name = await this.quest.warehouse.get({
  path: 'entity@3.name',
});
```

### Requêtes avancées

```javascript
// Recherche par type avec filtres
const activeEntities = await this.quest.warehouse.query({
  feed: 'myFeed',
  type: 'entity',
  filter: {status: 'active'},
  view: ['id', 'name', 'status'],
});

// Recherche par IDs spécifiques
const specificEntities = await this.quest.warehouse.query({
  ids: ['entity@1', 'entity@3', 'entity@5'],
  view: ['id', 'name'],
});
```

### Gestion des relations hiérarchiques

```javascript
// Attacher une branche à plusieurs parents
await this.quest.warehouse.attachToParents({
  branch: 'child@1',
  parents: ['parent@1', 'parent@2'],
  feeds: 'myFeed',
  generation: 2,
});

// Détacher d'un parent spécifique
await this.quest.warehouse.detachFromParents({
  branch: 'child@1',
  parents: ['parent@1'],
  feed: 'myFeed',
});

// Vérifier les abonnements d'une branche
const feeds = await this.quest.warehouse.getBranchSubscriptions({
  branch: 'child@1',
  filters: ['system'], // Exclure les feeds système
});
```

### Opérations par lot

```javascript
// Mise à jour en lot
await this.quest.warehouse.upsertInBatch({
  branches: {
    'item@1': {id: 'item@1', value: 100},
    'item@2': {id: 'item@2', value: 200},
    'item@3': {id: 'item@3', value: 300},
  },
  parents: 'container@1',
  feeds: 'itemsFeed',
});

// Suppression en lot
await this.quest.warehouse.removeBatch({
  branches: ['item@1', 'item@2', 'item@3'],
});
```

### Greffage entre feeds

```javascript
// Copier une branche et ses dépendances vers un autre feed
await this.quest.warehouse.graft({
  branch: 'complexEntity@1',
  fromFeed: 'sourceFeed',
  toFeed: 'targetFeed',
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

// Vérifier l'intégrité
await this.quest.warehouse.check();

// Obtenir des métriques
const feeds = await this.quest.warehouse.listFeeds();
const hasSpecificFeed = await this.quest.warehouse.hasFeed({
  feedName: 'myFeed',
});

// Forcer la synchronisation
await this.quest.warehouse.syncChanges({feed: 'myFeed'});

// Générer un graphique de l'état
await this.quest.warehouse.graph({
  output: '/tmp/warehouse-graphs',
});
```

## Interactions avec d'autres modules

Le warehouse est un composant fondamental qui interagit avec l'ensemble de l'écosystème Xcraft :

- **[xcraft-core-goblin]** : Utilise les mécanismes de base pour les quêtes et événements
- **[xcraft-core-utils]** : MapAggregator pour l'agrégation efficace des mises à jour
- **[xcraft-immutablediff]** : Calcul optimisé des différences entre états
- **[goblin-laboratory]** : Alimentation des composants React via les feeds
- **[xcraft-core-busclient]** : Communication événementielle sur le bus Xcraft
- **[xcraft-jsonviz]** : Génération de visualisations graphiques au format DOT

## Détails des sources

### `warehouse.js` et `warehouse-explorer.js`

Points d'entrée qui exposent les commandes Xcraft via `exports.xcraftCommands`, redirigeant vers les services respectifs.

### `lib/service.js`

Service principal implémentant un acteur Goblin singleton qui gère :

#### État et modèle de données

L'état du warehouse est structuré autour de plusieurs collections :

- **`_creators`** : Mapping branch → créateur pour traçabilité
- **`_generations`** : Versioning avec numéros de génération et flags de dispatch
- **`_subscriptions`** : Structure hiérarchique des feeds et leurs branches
- **`_patchFeeds`** : Configuration des feeds supportant les patches
- **`_maintenance`** : État du mode maintenance
- **`_lines`** : Gestion des notifications de lignes
- **`_feedsAggregator`** : Agrégateur pour optimiser les notifications

#### Méthodes publiques

- **`upsert(branch, data, parents, feeds, generation)`** — Ajoute ou met à jour une branche avec gestion complète des relations et notifications aux feeds abonnés.
- **`get(path, view)`** — Récupère des données à un chemin spécifique avec support des vues pour filtrer les propriétés retournées.
- **`query(feed, ids, type, filter, view)`** — Effectue des requêtes complexes avec support des filtres AND et des vues personnalisées.
- **`subscribe(feed, branches)`** — Crée un abonnement à un feed pour recevoir les mises à jour en temps réel.
- **`unsubscribe(feed)`** — Supprime un abonnement et déclenche le nettoyage automatique des branches orphelines.
- **`attachToParents(branch, parents, feeds, view)`** — Établit des relations parent-enfant avec validation de l'existence des parents.
- **`detachFromParents(branch, parents, feed)`** — Supprime des relations avec nettoyage automatique si la branche devient orpheline.
- **`deleteBranch(branch)`** — Supprime une branche et déclenche les cascades de nettoyage appropriées.
- **`maintenance(enable, description, orcName)`** — Contrôle le mode maintenance pour restreindre les opérations pendant les mises à jour critiques.
- **`check()`** — Vérifie l'intégrité en détectant les branches orphelines et pendantes.
- **`graph(output)`** — Génère des représentations visuelles au format DOT pour l'analyse et le débogage.
- **`syncChanges(feed)`** — Force la synchronisation immédiate des changements pour un feed spécifique.
- **`listFeeds()`** — Retourne la liste des feeds actifs (excluant les feeds système).
- **`graft(branch, fromFeed, toFeed)`** — Copie une branche et ses dépendances entre feeds pour la réorganisation des données.

### `lib/garbageCollector.js`

Classe spécialisée dans la gestion automatique du cycle de vie des branches :

#### Fonctionnement du garbage collection

Le garbage collector implémente un algorithme sophistiqué de nettoyage :

1. **Détection des orphelins** : Identification des branches sans parents valides
2. **Cascade de suppression** : Propagation automatique des suppressions
3. **Optimisation par lot** : Regroupement des opérations pour les performances
4. **Debouncing** : Délai de 50ms pour éviter les suppressions prématurées

#### Méthodes principales

- **`updateOwnership(state, branch, parents, feeds, isCreating, creator)`** — Met à jour les relations de propriété avec validation des parents et gestion des créateurs.
- **`unsubscribeBranch(state, branch, feed, autoRelease)`** — Supprime une branche d'un ou tous les feeds avec nettoyage en cascade.
- **`extractFeeds(state, branch)`** — Identifie tous les feeds contenant une branche spécifique.
- **`extractPatchFeeds(state, branch)`** — Filtre les feeds configurés pour les patches contenant la branche.

### `lib/dotHelpers.js`

Utilitaires pour la génération de graphiques de visualisation :

#### Fonctionnalités de visualisation

- **Types de graphiques** : Support des modes simple (circulaire) et complexe (détaillé)
- **Coloration sémantique** : Couleurs différentes selon le type d'acteur (worker, workitem, feeder, etc.)
- **Layouts multiples** : Support des algorithmes fdp et dot pour différents types d'analyse
- **Métadonnées** : Affichage des informations de génération et d'état

#### Méthodes principales

- **`generateGraph({type, layout}, state)`** — Génère un graphique complet avec tous les feeds et leurs relations.
- **`buildFullLabel(state, branch, ownOwner, index)`** — Crée des étiquettes détaillées avec métadonnées complètes.
- **`buildSimpleLabel(state, branch, ownOwner, index)`** — Génère des étiquettes simplifiées pour les vues d'ensemble.

### `widgets/warehouse-explorer/`

Interface graphique complète pour l'exploration et l'analyse du warehouse :

#### `service.js`

Service Goblin dédié à l'explorateur qui fournit :

- **Navigation par feeds** : Exploration hiérarchique des structures de données
- **Détection d'anomalies** : Identification automatique des problèmes d'intégrité
- **Génération de graphiques** : Conversion des données en format compatible Cytoscape

#### `widget.js`

Composant React principal intégrant :

- **Interface à deux panneaux** : Liste des feeds et visualisation graphique
- **Arbre hiérarchique** : Navigation dans la structure des branches
- **Graphique interactif** : Visualisation Cytoscape avec algorithme dagre
- **Gestion d'état** : Connexion au backend via le système Widget.connect

#### `view.js`

Vue principale de l'explorateur avec interface utilisateur complète et navigation intuitive.

#### `styles.js`

Définition des styles CSS pour l'interface, optimisés pour la visualisation de données complexes.

### `test/subscriptions.spec.js`

Suite de tests complète validant tous les aspects du warehouse :

#### Tests de base

- **`upsertHas`** : Validation de l'ajout et de la vérification de présence
- **`collectSingle`** : Test du garbage collection pour les branches isolées

#### Tests de cascade

- **`collectSimpleCascade`** : Validation des suppressions en cascade simples
- **`collectMultiCascade`** : Test des cascades complexes multi-niveaux
- **`subExtraDeepFeeds`** : Validation des hiérarchies profondes avec multiple feeds

#### Tests multi-feeds

- **`subTwoFeeds`** : Gestion des branches partagées entre feeds
- **`subTwoDeepFeeds`** : Relations complexes avec propriété multiple
- **`graft`** : Validation du greffage entre feeds

#### Tests d'intégrité

- **`attachParents`** : Validation de l'attachement dynamique
- **`subAndUnsubFeed`** : Cycle complet d'abonnement/désabonnement

---

_Cette documentation a été mise à jour automatiquement à partir des sources du module goblin-warehouse._

[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-immutablediff]: https://github.com/Xcraft-Inc/immutable-js-diff
[goblin-laboratory]: https://github.com/Xcraft-Inc/goblin-laboratory
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-jsonviz]: https://github.com/Xcraft-Inc/jsonviz