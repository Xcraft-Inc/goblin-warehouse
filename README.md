# 📘 Documentation du module goblin-warehouse

## Aperçu

Le module `goblin-warehouse` est un composant central de l'écosystème Xcraft qui fournit un système de stockage et de gestion d'état partagé entre les différents acteurs (Elf et Goblin). Il implémente un mécanisme sophistiqué de gestion des relations entre les entités (branches), avec un système de propriété (ownership) qui permet de suivre les dépendances entre les objets et d'effectuer un nettoyage automatique lorsque les objets ne sont plus référencés.

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

## Interactions avec d'autres modules

Le warehouse est un composant fondamental de l'architecture Xcraft et interagit avec de nombreux autres modules:

- **[xcraft-core-goblin]** : Utilise les mécanismes de base de Goblin pour la gestion des quêtes et des événements
- **[xcraft-core-utils]** : Utilise des utilitaires comme MapAggregator pour la gestion efficace des mises à jour
- **[xcraft-immutablediff]** : Calcule les différences entre les états pour optimiser les mises à jour
- **[goblin-laboratory]** : Fournit des données aux composants React via le système de feeds

## Détails des sources

### `service.js`

Ce fichier contient le service principal du warehouse. Il définit:

- L'état initial du warehouse (`logicState`) avec les structures pour les générations, souscriptions, et autres métadonnées
- Les gestionnaires de logique pour les différentes actions (`logicHandlers`) comme upsert, delete-branch, attach-to-parents, etc.
- Les quêtes exposées par le service (create, upsert, get, query, etc.)
- Les mécanismes de notification des changements aux abonnés via le système de diff

Le service gère le cycle de vie complet des branches, depuis leur création jusqu'à leur suppression, en passant par la gestion de leurs relations et la notification des changements.

#### Méthodes publiques principales

**`upsert(branch, data, parents, feeds, generation)`** - Ajoute ou met à jour une branche dans le warehouse avec les données fournies, en établissant des relations avec les parents spécifiés et en l'attachant aux feeds indiqués.

**`get(path, view)`** - Récupère les données à un chemin spécifique, avec une vue optionnelle pour filtrer les propriétés retournées.

**`query(feed, ids, type, filter, view)`** - Effectue une requête sur le warehouse pour trouver des branches correspondant aux critères spécifiés.

**`subscribe(feed, branches)`** - Crée un abonnement à un feed pour recevoir les mises à jour des branches spécifiées.

**`unsubscribe(feed)`** - Supprime un abonnement à un feed.

**`attachToParents(branch, parents, feeds, view)`** - Attache une branche à des parents spécifiés dans les feeds indiqués.

**`detachFromParents(branch, parents, feed)`** - Détache une branche de ses parents spécifiés dans un feed particulier.

**`deleteBranch(branch)`** - Supprime une branche du warehouse et met à jour toutes les relations.

**`maintenance(enable, description, orcName)`** - Active ou désactive le mode maintenance du warehouse, limitant les opérations aux processus autorisés.

**`syncChanges(feed)`** - Force la synchronisation des changements pour un feed spécifique.

**`listFeeds()`** - Retourne la liste des feeds disponibles dans le warehouse.

**`check()`** - Vérifie l'intégrité du warehouse en recherchant les branches orphelines et pendantes.

**`graph(output)`** - Génère une représentation graphique de l'état du warehouse au format DOT.

### `garbageCollector.js`

Implémente le système de nettoyage automatique des branches non référencées. Principales fonctionnalités:

- `updateOwnership`: Met à jour les relations parent-enfant entre les branches
- `unsubscribeBranch`: Supprime une branche et met à jour les relations
- `_collect`: Supprime une branche et nettoie les références associées
- `_purgeCollectable`: Envoie des événements pour les branches supprimées

La classe `GarbageCollector` utilise un mécanisme de debounce pour regrouper les opérations de nettoyage et optimiser les performances.

#### Fonctionnement du Garbage Collector

Le garbage collector surveille les relations entre les branches et identifie celles qui ne sont plus référencées par aucun parent. Lorsqu'une branche devient orpheline, elle est marquée comme "collectable" et sera supprimée lors du prochain cycle de nettoyage.

Le processus de nettoyage est optimisé par un mécanisme de debounce qui regroupe les opérations de suppression pour éviter de surcharger le système avec de nombreuses petites opérations.

### `dotHelpers.js`

Fournit des fonctions pour générer des représentations graphiques de l'état du warehouse:

- `generateGraph`: Crée un graphe représentant les relations entre les branches
- `buildFullLabel`, `buildSimpleLabel`: Formatent les étiquettes des nœuds du graphe
- `getBackgroundColor`: Détermine la couleur d'un nœud en fonction de son type (worker, workitem, feeder, updater, dispatcher)

Ces fonctions utilisent la bibliothèque JsonViz pour générer des graphes au format DOT qui peuvent être convertis en SVG ou d'autres formats visuels.

### `warehouse-explorer/widget.js`

Composant React qui fournit une interface utilisateur pour explorer et visualiser l'état du warehouse:

- Affiche la liste des feeds disponibles
- Permet de visualiser les branches d'un feed sous forme d'arbre
- Affiche un graphe interactif des relations entre les branches en utilisant Cytoscape.js
- Permet de détecter les branches orphelines ou pendantes

Le composant utilise l'algorithme de disposition "dagre" pour organiser les nœuds du graphe de manière hiérarchique.

### `warehouse-explorer/service.js`

Service Goblin qui alimente l'explorateur du warehouse:

- `explore`: Récupère les informations sur un feed spécifique
- `check`: Vérifie les branches orphelines ou pendantes
- Construit les données pour la visualisation graphique en créant des nœuds et des liens entre eux

### `warehouse-explorer/view.js`

Composant React qui définit la vue principale de l'explorateur de warehouse. Il intègre:

- Un conteneur principal avec un titre
- Le composant Explorer qui affiche les données du warehouse

### `warehouse-explorer/styles.js`

Définit les styles CSS pour l'explorateur de warehouse, notamment:

- Le style de l'arbre de visualisation avec flexbox pour une mise en page adaptative
- Les dimensions et le padding des éléments

### `test/subscriptions.spec.js`

Contient des tests unitaires pour vérifier le bon fonctionnement du système de souscriptions du warehouse:

- Tests de création et suppression de branches
- Tests de cascade de suppression (lorsqu'un parent est supprimé)
- Tests de gestion des relations entre branches dans différents feeds
- Tests de vérification de l'intégrité des données

Ces tests garantissent que le système de propriété et de garbage collection fonctionne correctement dans différents scénarios.

_Cette documentation a été mise à jour automatiquement._

[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-immutablediff]: https://github.com/Xcraft-Inc/immutable-js-diff
[goblin-laboratory]: https://github.com/Xcraft-Inc/goblin-laboratory
