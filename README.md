# 📘 Documentation du module goblin-warehouse

## Aperçu

Le module `goblin-warehouse` est un composant central de l'écosystème Xcraft qui fournit un système de stockage et de gestion d'état partagé entre les différents acteurs (Elf et Goblin). Il implémente un mécanisme sophistiqué de gestion des relations entre les entités (branches), avec un système de propriété (ownership) qui permet de suivre les dépendances entre les objets et d'effectuer un nettoyage automatique lorsque les objets ne sont plus référencés.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [API publique](#api-publique)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Explorateur de warehouse](#explorateur-de-warehouse)
- [Tests](#tests)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Détails des sources](#détails-des-sources)

## Structure du module

- **Service principal** : Le cœur du module est le service `lib/service.js` qui gère l'état global
- **Garbage Collector** : Un système de nettoyage automatique des entités non référencées (`lib/garbageCollector.js`)
- **Explorateur** : Un outil visuel (`warehouse-explorer`) pour visualiser et analyser l'état du warehouse
- **Utilitaires** : Des fonctions auxiliaires pour la génération de graphes (`lib/dotHelpers.js`) et la gestion des relations

## Fonctionnement global

Le warehouse fonctionne comme une base de données en mémoire qui stocke l'état des acteurs Goblin et Elf. Chaque entité stockée est appelée une "branche" et peut avoir des relations parent-enfant avec d'autres branches. Ces relations sont gérées dans des "feeds" (flux) qui permettent d'organiser et de regrouper les branches.

### Système de propriété (Ownership)

Le warehouse implémente un système de propriété où chaque branche peut avoir des parents et des enfants. Ce système permet de:

1. Suivre les dépendances entre les objets
2. Nettoyer automatiquement les branches qui ne sont plus référencées
3. Organiser les données en hiérarchies logiques

### Feeds et Subscriptions

Les "feeds" sont des canaux de données auxquels les clients peuvent s'abonner pour recevoir des mises à jour. Lorsqu'une branche est modifiée, tous les feeds qui contiennent cette branche sont notifiés. Le système utilise un mécanisme de diff pour n'envoyer que les changements nécessaires, optimisant ainsi les performances.

### Garbage Collection

Le garbage collector surveille les relations entre les branches et supprime automatiquement celles qui ne sont plus référencées par aucun parent. Ce mécanisme évite les fuites de mémoire et maintient la cohérence de l'état global. Le GC utilise un système de debounce pour regrouper les opérations de nettoyage et optimiser les performances.

### Système de génération

Chaque branche possède un numéro de génération qui est incrémenté à chaque modification. Ce système permet de suivre les changements et d'éviter les conflits lors des mises à jour concurrentes.

### Maintenance

Le warehouse dispose d'un mode de maintenance qui permet de restreindre les opérations pendant des périodes spécifiques, par exemple lors de mises à jour critiques du système.

## API publique

### Quêtes principales

#### `upsert(branch, data, parents, feeds, generation)`

Ajoute ou met à jour une branche dans le warehouse avec les données fournies, en établissant des relations avec les parents spécifiés et en l'attachant aux feeds indiqués.

**Paramètres :**

- `branch` : Identifiant unique de la branche
- `data` : Données à stocker
- `parents` : Parent(s) de la branche (string ou array)
- `feeds` : Feed(s) où attacher la branche (string ou array)
- `generation` : Numéro de génération (optionnel)

#### `get(path, view)`

Récupère les données à un chemin spécifique, avec une vue optionnelle pour filtrer les propriétés retournées.

**Paramètres :**

- `path` : Chemin vers les données
- `view` : Vue pour filtrer les propriétés (optionnel)

#### `query(feed, ids, type, filter, view)`

Effectue une requête sur le warehouse pour trouver des branches correspondant aux critères spécifiés.

**Paramètres :**

- `feed` : Feed à interroger (optionnel)
- `ids` : Liste d'IDs spécifiques (optionnel)
- `type` : Type de branche à rechercher (optionnel)
- `filter` : Conditions de filtrage (optionnel)
- `view` : Propriétés à retourner (optionnel)

#### `subscribe(feed, branches)`

Crée un abonnement à un feed pour recevoir les mises à jour des branches spécifiées.

#### `unsubscribe(feed)`

Supprime un abonnement à un feed et nettoie toutes les branches associées.

#### `attachToParents(branch, parents, feeds, view)`

Attache une branche à des parents spécifiés dans les feeds indiqués.

#### `detachFromParents(branch, parents, feed)`

Détache une branche de ses parents spécifiés dans un feed particulier.

#### `deleteBranch(branch)`

Supprime une branche du warehouse et met à jour toutes les relations.

#### `maintenance(enable, description, orcName)`

Active ou désactive le mode maintenance du warehouse.

#### `check()`

Vérifie l'intégrité du warehouse en recherchant les branches orphelines et pendantes.

#### `graph(output)`

Génère une représentation graphique de l'état du warehouse au format DOT.

## Exemples d'utilisation

### Création et abonnement à un feed

```javascript
// Créer un feed et s'y abonner
await this.quest.warehouse.subscribe({
  feed: 'myFeed',
  branches: ['myEntity@1', 'myEntity@2'],
});

// Ajouter une entité au warehouse et l'attacher à un feed
await this.quest.warehouse.upsert({
  branch: 'myEntity@3',
  data: {id: 'myEntity@3', value: 'some data'},
  feeds: 'myFeed',
  parents: 'myEntity@1',
});
```

### Requêtes sur le warehouse

```javascript
// Obtenir une valeur spécifique
const value = await this.quest.warehouse.get({
  path: 'myEntity@1.value',
});

// Effectuer une requête filtrée
const results = await this.quest.warehouse.query({
  feed: 'myFeed',
  type: 'myEntity',
  filter: {status: 'active'},
  view: ['id', 'value'],
});
```

### Gestion des relations

```javascript
// Attacher une branche à des parents
await this.quest.warehouse.attachToParents({
  branch: 'myEntity@3',
  parents: ['myEntity@1', 'myEntity@2'],
  feeds: 'myFeed',
});

// Détacher une branche de ses parents
await this.quest.warehouse.detachFromParents({
  branch: 'myEntity@3',
  parents: ['myEntity@1'],
  feed: 'myFeed',
});
```

### Vérification de l'intégrité

```javascript
// Vérifier les branches orphelines et pendantes
const orphans = await this.quest.warehouse.checkOrphan();
const dangling = await this.quest.warehouse.checkDangling();

// Générer une représentation graphique de l'état du warehouse
await this.quest.warehouse.graph({
  output: '/path/to/output',
});
```

## Explorateur de warehouse

Le module inclut un explorateur visuel (`warehouse-explorer`) qui permet de :

- Visualiser les feeds et leurs branches sous forme d'arbre
- Afficher un graphe interactif des relations entre les branches
- Détecter les branches orphelines ou pendantes
- Explorer l'état du warehouse en temps réel

L'explorateur utilise Cytoscape.js pour la visualisation graphique et l'algorithme de disposition "dagre" pour organiser les nœuds de manière hiérarchique.

## Tests

Le module inclut une suite de tests complète (`test/subscriptions.spec.js`) qui vérifie :

- La création et suppression de branches
- Les cascades de suppression multi-niveaux
- La gestion des relations entre branches dans différents feeds
- L'intégrité du système de propriété et de garbage collection

## Interactions avec d'autres modules

Le warehouse est un composant fondamental de l'architecture Xcraft et interagit avec de nombreux autres modules:

- **[xcraft-core-goblin]** : Utilise les mécanismes de base de Goblin pour la gestion des quêtes et des événements
- **[xcraft-core-utils]** : Utilise des utilitaires comme MapAggregator pour la gestion efficace des mises à jour
- **[xcraft-immutablediff]** : Calcule les différences entre les états pour optimiser les mises à jour
- **[goblin-laboratory]** : Fournit des données aux composants React via le système de feeds

## Détails des sources

### `warehouse.js` et `warehouse-explorer.js`

Points d'entrée qui exposent les commandes Xcraft du service warehouse et de l'explorateur via `exports.xcraftCommands`.

### `lib/service.js`

Service principal du warehouse qui définit :

- **État initial** (`logicState`) avec les structures pour les générations, souscriptions, et métadonnées
- **Gestionnaires de logique** (`logicHandlers`) pour les actions comme upsert, delete-branch, attach-to-parents
- **Quêtes exposées** pour l'interaction avec le warehouse
- **Mécanismes de notification** des changements aux abonnés via le système de diff

#### Structure de l'état

```javascript
const logicState = {
  _creators: {}, // Créateurs de chaque branche
  _generations: {}, // Numéros de génération et flags
  _subscriptions: {}, // Abonnements aux feeds avec relations
  _patchFeeds: {}, // Feeds configurés pour les patches
  _maintenance: {}, // Configuration du mode maintenance
  _lines: {}, // Gestion des lignes de mise à jour
  _linesNotifyPayload: true,
  _feedsAggregator: null, // Agrégateur pour les notifications
};
```

### `lib/garbageCollector.js`

Classe `GarbageCollector` qui implémente le nettoyage automatique :

- **`updateOwnership`** : Met à jour les relations parent-enfant
- **`unsubscribeBranch`** : Supprime une branche et nettoie les références
- **`_collect`** : Supprime une branche et met à jour les relations
- **`_purgeCollectable`** : Envoie des événements pour les branches supprimées

Le garbage collector utilise un mécanisme de debounce (50ms) pour regrouper les opérations et optimiser les performances.

### `lib/dotHelpers.js`

Fonctions pour la génération de graphiques :

- **`generateGraph`** : Crée un graphe représentant les relations entre branches
- **`buildFullLabel`**, **`buildSimpleLabel`** : Formatent les étiquettes des nœuds
- **`getBackgroundColor`** : Détermine la couleur selon le type (worker, workitem, feeder, etc.)

### `widgets/warehouse-explorer/`

Composants React pour l'interface d'exploration :

- **`widget.js`** : Composant principal avec arbre des feeds et graphe interactif
- **`service.js`** : Service Goblin qui alimente l'explorateur
- **`view.js`** : Vue principale de l'explorateur
- **`styles.js`** : Styles CSS pour l'interface

L'explorateur utilise Cytoscape.js avec l'algorithme "dagre" pour la visualisation graphique des relations entre branches.

---

_Cette documentation a été générée automatiquement à partir des sources du module goblin-warehouse._

[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-immutablediff]: https://github.com/Xcraft-Inc/immutable-js-diff
[goblin-laboratory]: https://github.com/Xcraft-Inc/goblin-laboratory
