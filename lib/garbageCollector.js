const debounce = require('lodash/debounce');

class GarbageCollector {
  constructor(feedDispose) {
    const busClient = require('xcraft-core-busclient').getGlobal();
    this._resp = busClient.newResponse('warehouse', 'token');
    this._collectable = new Map();
    this._purge = debounce(this._purgeCollectable.bind(this), 50);
    this._purgeBatchSize = 50;
    this._feedDispose = feedDispose;
  }

  _collect(state, feed, branch, list, autoRelease = false) {
    if (!list[feed]) {
      list[feed] = {};
    }

    const ownership = state.get(['_subscriptions', feed, 'branches', branch]);

    /* Update parents 'children' property */
    for (const parent of ownership.get('parents').keySeq()) {
      state = state.del([
        '_subscriptions',
        feed,
        'branches',
        parent,
        'children',
        branch,
      ]);
    }
    /* Update children 'parents' property */
    for (const child of ownership.get('children').keySeq()) {
      state = state.del([
        '_subscriptions',
        feed,
        'branches',
        child,
        'parents',
        branch,
      ]);
      if (
        state.get(['_subscriptions', feed, 'branches', child, 'parents'])
          .size === 0 &&
        branch !== child
      ) {
        list[feed][child] = true;
      }
    }

    /* Remove itself */
    state = state
      .del(['_subscriptions', feed, 'branches', branch])
      .del(['_subscriptions', feed, 'views', branch]);
    delete list[feed][branch];

    /* Remove empty feed */
    if (state.get(['_subscriptions', feed, 'branches']).size === 0) {
      state = state.del(['_subscriptions', feed]).del(['_patchFeeds', feed]);
      if (this._feedDispose) {
        this._feedDispose(feed);
      }
    }

    /* Skip purge stuff with singletons (cannot be deleted) */
    if (branch.indexOf('@') === -1) {
      return state;
    }

    /* Remove the branch only when we are sure that no more feed is using it */
    const isOwn = state
      .get(`_subscriptions`)
      .some((_, feed) =>
        state.has(['_subscriptions', feed, 'branches', branch])
      );
    if (!isOwn) {
      const generation = state.get(['_generations', branch]);
      if (!generation) {
        console.warn(
          `Generation is missing, it must not happend: ${branch}\n` +
            `... maybe you are using desktopId as quest parameter instead of sessionDesktopId with a singleton?`
        );
      }

      this._collectable.set(branch, generation);
      this._purge();

      /* When the auto release is required, the collectable event is sent
       * as usual...
       */
      if (autoRelease) {
        state = state.del(branch).del(['_generations', branch]);
      }
    }

    return state;
  }

  _purgeCollectable() {
    const size = this._collectable.size;
    const entries = Array.from(this._collectable);
    for (let i = 0; i < size; i += this._purgeBatchSize) {
      let last = i + this._purgeBatchSize;
      if (last > size) {
        last = size;
      }
      const slice = entries.slice(i, last);
      this._resp.events.send(`warehouse.released`, Object.fromEntries(slice));
    }
    this._collectable.clear();
  }

  getOwnership(state, path) {
    let ownership = state.get(path, {parents: {}, children: {}});
    if (!ownership.has('children')) {
      ownership = ownership.set('children', {});
    }
    if (!ownership.has('parents')) {
      ownership = ownership.set('parents', {});
    }
    return ownership;
  }

  updateOwnership(
    state,
    immState,
    branch,
    parents,
    feeds,
    isCreating,
    creator
  ) {
    /* Handle ownership for the feed */
    let skip = 0;
    for (const feed of feeds) {
      for (const parent of parents) {
        let ownership = this.getOwnership(state, [
          '_subscriptions',
          feed,
          'branches',
          branch,
        ]);
        if (isCreating === true) {
          ownership = ownership.set(['parents', 'new'], true);
          if (!creator) {
            throw new Error(`updateOwnership: missing creator for ${branch}`);
          }
          state = state.set(['_creators', branch], creator);
        } else if (isCreating === false) {
          ownership = ownership.delete('parents.new');
          state = state.delete(`_creators.${branch}`);
        }

        if (
          branch !== parent &&
          !ownership.get('parents').size &&
          !state.has(['_subscriptions', feed, 'branches', parent])
        ) {
          ++skip;
          continue;
        }

        if (parent) {
          /* Set the child where appropriate */
          if (branch === parent) {
            /* Own child and parent */
            ownership = ownership.set(['children', branch], true);
          } else if (!ownership.has(['parents', parent])) {
            if (!state.has(['_subscriptions', feed, 'branches', parent])) {
              console.warn(
                `Missing parent ${parent} for branch ${branch} in the feed ${feed}`
              );
              this.unsubscribeBranch(immState, branch);
              return {
                state: immState,
                collected: true,
              };
            }
            /* Other parent */
            let _ownership = this.getOwnership(state, [
              '_subscriptions',
              feed,
              'branches',
              parent,
            ]);
            _ownership = _ownership.set(['children', branch], true);
            state = state.set(
              ['_subscriptions', feed, 'branches', parent],
              _ownership
            );
          }
          ownership = ownership.set(['parents', parent], true);
        } else if (!ownership.get('parents').size) {
          throw new Error(
            `Orphan branch detected: ${branch}, please fix the code because a parent can not be null or undefined`
          );
        }
        state = state.set(
          ['_subscriptions', feed, 'branches', branch],
          ownership
        );
      }
    }

    if (skip > 0 && skip === parents.length * feeds.length) {
      console.warn(
        `${branch} immediatly collected because all possible parents are unknown`
      );
      this.unsubscribeBranch(state, branch);
      return {
        state: immState,
        collected: true,
      };
    }
    return {state: state, collected: false};
  }

  unsubscribeBranch(state, branch, feed = null, autoRelease = false) {
    let list;

    if (!feed) {
      list = this.extractFeeds(state, branch);
    } else {
      list = {
        [feed]: {
          [branch]: true,
        },
      };
    }

    let loop = true;
    while (loop) {
      loop = false;
      for (const feed in list) {
        for (const branch in list[feed]) {
          state = this._collect(state, feed, branch, list, autoRelease);
        }
        if (Object.keys(list[feed]).length > 0) {
          loop = true;
        }
      }
    }

    return state;
  }

  inFeeds(state, branch) {
    return state
      .get(`_subscriptions`)
      .some((s) => s.hasIn(['branches', branch]));
  }

  inFeed(state, feed, branch) {
    return state.has(['_subscriptions', feed, 'branches', branch]);
  }

  extractFeeds(state, branch) {
    const list = {};

    /* Extract all feeds where a specific branch is available */
    state
      .get(`_subscriptions`)
      .filter((s) => s.hasIn(['branches', branch]))
      .forEach((_, feed) => {
        if (!list[feed]) {
          list[feed] = {};
        }
        list[feed][branch] = true;
      });

    return list;
  }
}

module.exports = GarbageCollector;
