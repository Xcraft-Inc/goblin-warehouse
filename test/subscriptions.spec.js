// @ts-check
'use strict';

const {expect} = require('chai');
const {Elf} = require('xcraft-core-goblin/lib/test.js');

describe('goblin.warehouse', function () {
  let runner;

  this.beforeAll(function () {
    runner = new Elf.Runner();
    runner.init();
  });

  this.afterAll(function () {
    runner.dispose();
  });

  describe('subscriptions', function () {
    this.afterEach(async function () {
      await runner.it(async function () {
        const feeds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `tests${i}`);
        for (const feed of feeds) {
          if (
            await this.quest.warehouse.has({path: `_subscriptions.${feed}`})
          ) {
            await this.quest.warehouse.unsubscribe({feed});
          }
        }
        const branches = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
          (i) => `tests@${i}`
        );
        await this.quest.warehouse.removeBatch({branches});
      });
    });

    it('upsertHas', async function () {
      this.timeout(30000);
      await runner.it(async function () {
        expect(await this.quest.warehouse.has({path: 'tests@stay'})).is.equals(
          false
        );
        await this.quest.warehouse.upsert({
          branch: 'tests@0',
          data: {},
          parents: 'tests@0',
          feeds: 'tests0',
        });
        expect(await this.quest.warehouse.has({path: 'tests@0'})).is.equals(
          true
        );
      });
    });

    it('collectSingle', async function () {
      this.timeout(30000);
      await runner.it(async function () {
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          false
        );
        await this.quest.warehouse.upsert({
          branch: 'tests@1',
          data: {},
          parents: '?',
          feeds: 'tests1',
        });
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          false
        );
      });
    });

    /* |- tests@1
     *   |- tests@2
     */
    it('collectSimpleCascade', async function () {
      this.timeout(30000);
      await runner.it(async function collectSimpleCascade() {
        expect(await this.quest.warehouse.has({path: 'tests@0'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          false
        );
        await this.quest.warehouse.upsert({
          branch: 'tests@0',
          data: {},
          parents: 'tests@0',
          feeds: 'tests1',
          generation: 1,
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@1',
          data: {},
          parents: 'tests@0',
          feeds: 'tests1',
          generation: 1,
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@2',
          data: {},
          parents: 'tests@1',
          feeds: 'tests1',
          generation: 1,
        });
        expect(await this.quest.warehouse.has({path: 'tests@0'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          true
        );
        await this.quest.warehouse.deleteBranch({branch: 'tests@0'});
        await this.quest.warehouse.acknowledge({
          branch: 'tests@0',
          generation: 1,
        });
        await this.quest.warehouse.acknowledge({
          branch: 'tests@1',
          generation: 1,
        });
        await this.quest.warehouse.acknowledge({
          branch: 'tests@2',
          generation: 1,
        });
        expect(await this.quest.warehouse.has({path: 'tests@0'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          false
        );
      });
    });

    /* |- tests@1
     *   |- tests@2
     *   | |- tests@4
     *   |- tests@3
     *     |- tests@5
     */
    it('collectMultiCascade', async function () {
      this.timeout(30000);
      await runner.it(async function (quest) {
        expect(await this.quest.warehouse.has({path: 'tests@0'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@3'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@4'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@5'})).is.equals(
          false
        );
        await this.quest.warehouse.upsert({
          branch: 'tests@0',
          data: {},
          parents: 'tests@0',
          feeds: 'tests1',
          generation: 1,
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@1',
          data: {},
          parents: 'tests@0',
          feeds: 'tests1',
          generation: 1,
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@2',
          data: {},
          parents: 'tests@1',
          feeds: 'tests1',
          generation: 1,
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@4',
          data: {},
          parents: 'tests@2',
          feeds: 'tests1',
          generation: 1,
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@3',
          data: {},
          parents: 'tests@1',
          feeds: 'tests1',
          generation: 1,
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@5',
          data: {},
          parents: 'tests@3',
          feeds: 'tests1',
          generation: 1,
        });
        expect(await this.quest.warehouse.has({path: 'tests@0'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@3'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@4'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@5'})).is.equals(
          true
        );
        await this.quest.warehouse.deleteBranch({branch: 'tests@0'});
        await this.quest.warehouse.acknowledge({
          branch: 'tests@0',
          generation: 1,
        });
        await this.quest.warehouse.acknowledge({
          branch: 'tests@1',
          generation: 1,
        });
        await this.quest.warehouse.acknowledge({
          branch: 'tests@2',
          generation: 1,
        });
        await this.quest.warehouse.acknowledge({
          branch: 'tests@3',
          generation: 1,
        });
        await this.quest.warehouse.acknowledge({
          branch: 'tests@4',
          generation: 1,
        });
        await this.quest.warehouse.acknowledge({
          branch: 'tests@5',
          generation: 1,
        });
        expect(await this.quest.warehouse.has({path: 'tests@0'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@3'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@4'})).is.equals(
          false
        );
        expect(await this.quest.warehouse.has({path: 'tests@5'})).is.equals(
          false
        );
      });
    });

    it('collectedBecauseNoSubscriber', async function () {
      this.timeout(30000);
      await runner.it(async function () {
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          false
        );
        await this.quest.warehouse.upsert({
          branch: 'tests@1',
          data: {},
          parents: 'tests',
          feeds: 'tests1',
        });
        /* tests1 exists but in the feed */
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          false
        );
      });
    });

    it('subAndUnsubFeed', async function () {
      this.timeout(30000);
      await runner.it(async function () {
        const basePath = '_subscriptions.tests1.branches.';
        expect(
          await this.quest.warehouse.has({path: `${basePath}tests@1`})
        ).is.equals(false);
        expect(
          await this.quest.warehouse.has({path: `${basePath}tests@2`})
        ).is.equals(false);
        await this.quest.warehouse.subscribe({
          feed: 'tests1',
          branches: ['tests@1', 'tests@2'],
        });
        expect(
          await this.quest.warehouse.has({path: `${basePath}tests@1`})
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({path: `${basePath}tests@2`})
        ).is.equals(true);
        await this.quest.warehouse.unsubscribe({feed: 'tests1'});
        expect(
          await this.quest.warehouse.has({path: `_subscriptions.tests1`})
        ).is.equals(false);
      });
    });

    it('subTwoFeeds', async function () {
      this.timeout(30000);
      await runner.it(async function () {
        const basePath = '_subscriptions.tests';

        /* Subscribe with two different feeds */
        await this.quest.warehouse.subscribe({
          feed: 'tests1',
          branches: ['tests@1', 'tests@2'],
        });
        await this.quest.warehouse.subscribe({
          feed: 'tests2',
          branches: ['tests@2'],
        });

        /* Add two branches */
        await this.quest.warehouse.upsert({
          branch: 'tests@1',
          data: {id: 'tests@1'},
          generation: 1,
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@2',
          data: {id: 'tests@2'},
          feeds: 'tests1',
          parents: 'tests@1',
          generation: 1,
        });

        /* Check */
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          true
        );
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@1`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@2`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@1`,
          })
        ).is.equals(false);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@2`,
          })
        ).is.equals(true);

        /* Remove own ownership of tests@2, then it stays alive only because there
         * is at least one other parent in a feed.
         */
        await this.quest.kill('tests@2', 'tests@2');
        await this.quest.warehouse.acknowledge({
          branch: 'tests@2',
          generation: 1,
        });

        /* Remove tests@1 ownership of tests@2 */
        await this.quest.kill('tests@2', 'tests@1');

        /* Check that tests@2 is deleted and the subscriptions too */
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          false
        );
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@1`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@2`,
          })
        ).is.equals(false);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@1`,
          })
        ).is.equals(false);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@2`,
          })
        ).is.equals(false);
      });
    });

    /* |- tests@1
     * | |- tests@3
     * |- tests@2
     *   |- tests@3
     */
    it('subTwoDeepFeeds', async function () {
      this.timeout(30000);
      await runner.it(async function () {
        const basePath = '_subscriptions.tests';

        /* Subscribe with two different feeds */
        await this.quest.warehouse.subscribe({
          feed: 'tests1',
          branches: ['tests@1', 'tests@3'],
        });
        await this.quest.warehouse.subscribe({
          feed: 'tests2',
          branches: ['tests@2', 'tests@3'],
        });

        /* Add three branches with two owners on tests@3 */
        await this.quest.warehouse.upsert({
          branch: 'tests@3',
          data: {id: 'tests@3'},
          feeds: 'tests1',
          parents: 'tests@1',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@3',
          data: {id: 'tests@3'},
          feeds: 'tests2',
          parents: 'tests@2',
        });

        /* Remove own ownership of tests@3, then it stays alive only because there
         * is at least one other parent in a feed.
         */
        await this.quest.kill('tests@3', 'tests@3');

        /* Check */
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@3'})).is.equals(
          true
        );
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@1`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@2`,
          })
        ).is.equals(false);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@3`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@1`,
          })
        ).is.equals(false);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@2`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@3`,
          })
        ).is.equals(true);

        /* Remove tests@1 ownership of tests@3 */
        await this.quest.kill('tests@3', 'tests@1');

        /* Check that nothing is deleted exepted one subscription */
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@3'})).is.equals(
          true
        );
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@1`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@3`,
          })
        ).is.equals(false);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@2`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@3`,
          })
        ).is.equals(true);
      });
    });

    /* |- tests@1             |- tests@1
     * | |- tests@3           | |
     * | | |- tests@4         | |
     * | |   |- tests@5       | |
     * | |- tests@5       =>  | |- tests@5
     * |- tests@2             |- tests@2
     *   |- tests@3             |- tests@3
     *   |- tests@4             |- tests@4
     *     |- tests@5             |- tests@5
     *
     * BEFORE
     *  feed: tests1
     *    subscriptions: tests@1, tests@3, tests@4, tests@5
     *  feed: tests2
     *    subscriptions: tests@2, tests@3, tests@4, tests@5
     *
     * AFTER
     *  feed: tests1
     *    subscriptions: tests@1, tests@5
     *  feed: tests2
     *    subscriptions: tests@2, tests@3, tests@4, tests@5
     */
    it('subExtraDeepFeeds', async function () {
      this.timeout(30000);
      await runner.it(async function () {
        const basePath = '_subscriptions.tests';

        /* Subscribe with two different feeds */
        await this.quest.warehouse.subscribe({
          feed: 'tests1',
          branches: ['tests@1', 'tests@3', 'tests@4', 'tests@5'],
        });
        await this.quest.warehouse.subscribe({
          feed: 'tests2',
          branches: ['tests@2', 'tests@3', 'tests@4', 'tests@5'],
        });

        /* Add three branches with two owners on tests@3 and tests@4 */
        await this.quest.warehouse.upsert({
          branch: 'tests@3',
          data: {id: 'tests@3'},
          feeds: 'tests1',
          parents: 'tests@1',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@3',
          data: {id: 'tests@3'},
          feeds: 'tests2',
          parents: 'tests@2',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@4',
          data: {id: 'tests@4'},
          feeds: 'tests2',
          parents: 'tests@2',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@4',
          data: {id: 'tests@4'},
          feeds: 'tests1',
          parents: 'tests@3',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@5',
          data: {id: 'tests@5'},
          feeds: 'tests1',
          parents: 'tests@1',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@5',
          data: {id: 'tests@5'},
          feeds: ['tests1', 'tests2'],
          parents: 'tests@4',
        });

        /* Remove own ownership of tests@*, then it stays alive only because there
         * is at least one other parent in a feed.
         */
        await this.quest.kill('tests@3', 'tests@3');
        await this.quest.kill('tests@4', 'tests@4');
        await this.quest.kill('tests@5', 'tests@5');

        /* Check */
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@3'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@4'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@5'})).is.equals(
          true
        );
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@1`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@3`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@4`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@5`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@2`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@3`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@4`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@5`,
          })
        ).is.equals(true);

        /* Remove tests@1 ownership of tests@3 */
        await this.quest.kill('tests@3', 'tests@1');

        /* Check that nothing is deleted exepted two subscriptions */
        expect(await this.quest.warehouse.has({path: 'tests@1'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@2'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@3'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@4'})).is.equals(
          true
        );
        expect(await this.quest.warehouse.has({path: 'tests@5'})).is.equals(
          true
        );
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@1`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@3`,
          })
        ).is.equals(false);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@4`,
          })
        ).is.equals(false);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@5`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@2`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@3`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@4`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}2.branches.tests@5`,
          })
        ).is.equals(true);
      });
    });

    it('attachParents', async function () {
      this.timeout(30000);
      await runner.it(async function () {
        const basePath = '_subscriptions.tests';

        await this.quest.warehouse.upsert({
          branch: 'tests@1',
          data: {id: 'tests@1'},
          feeds: 'tests1',
          parents: 'tests@1',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@2',
          data: {id: 'tests@2'},
          feeds: 'tests1',
          parents: 'tests@2',
        });

        await this.quest.warehouse.attachToParents({
          branch: 'tests@1',
          parents: 'tests@2',
        });

        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@1.parents.tests@1`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@1.parents.tests@2`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@2.children.tests@1`,
          })
        ).is.equals(true);
        expect(
          await this.quest.warehouse.has({
            path: `${basePath}1.branches.tests@2.children.tests@2`,
          })
        ).is.equals(true);
      });
    });
  });

  describe('copy branches', function () {
    /* FEED A
     * |- tests@1
     * | |- tests@3
     * | | |- tests@4
     * | |   |- tests@5
     * | |- tests@5
     * |- tests@2
     *   |- tests@3
     *   |- tests@4
     *     |- tests@5
     *
     * GRAFT tests@4 from A to B
     *
     * FEED B                 FEED B
     * |- tests@6             |- tests@6
     *                        |- tests@1
     *                    =>  | |- tests@3
     *                        |   |- tests@4
     *                        |- tests@2
     *                        |  |- tests@3
     *                           |- tests@4
     */
    it('graft topdown', async function () {
      this.timeout(10000);
      await runner.it(async function () {
        await this.quest.warehouse.subscribe({
          feed: 'feedA',
          branches: ['tests@1', 'tests@2'],
        });
        await this.quest.warehouse.subscribe({
          feed: 'feedB',
          branches: ['tests@6'],
        });

        await this.quest.warehouse.upsert({
          branch: 'tests@3',
          data: {id: 'tests@3'},
          feeds: 'feedA',
          parents: 'tests@1',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@3',
          data: {id: 'tests@3'},
          feeds: 'feedA',
          parents: 'tests@2',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@4',
          data: {id: 'tests@4'},
          feeds: 'feedA',
          parents: 'tests@2',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@4',
          data: {id: 'tests@4'},
          feeds: 'feedA',
          parents: 'tests@3',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@5',
          data: {id: 'tests@5'},
          feeds: 'feedA',
          parents: 'tests@1',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@5',
          data: {id: 'tests@5'},
          feeds: 'feedA',
          parents: 'tests@4',
        });

        let state;
        state = await this.quest.getState('warehouse');
        state = state.toJS();
        expect(state._subscriptions.feedA.branches).to.be.eql({
          ['tests@1']: {
            parents: {
              ['tests@1']: true,
            },
            children: {
              ['tests@1']: true,
              ['tests@3']: true,
              ['tests@5']: true,
            },
          },
          ['tests@2']: {
            parents: {
              ['tests@2']: true,
            },
            children: {
              ['tests@2']: true,
              ['tests@3']: true,
              ['tests@4']: true,
            },
          },
          ['tests@3']: {
            parents: {
              ['tests@1']: true,
              ['tests@2']: true,
            },
            children: {
              ['tests@4']: true,
            },
          },
          ['tests@4']: {
            parents: {
              ['tests@2']: true,
              ['tests@3']: true,
            },
            children: {
              ['tests@5']: true,
            },
          },
          ['tests@5']: {
            parents: {
              ['tests@1']: true,
              ['tests@4']: true,
            },
            children: {},
          },
        });

        expect(state._subscriptions.feedB.branches).to.be.eql({
          ['tests@6']: {
            parents: {
              ['tests@6']: true,
            },
            children: {
              ['tests@6']: true,
            },
          },
        });

        await this.quest.warehouse.graft({
          branch: 'tests@4',
          fromFeed: 'feedA',
          toFeed: 'feedB',
        });

        state = await this.quest.getState('warehouse');
        state = state.toJS();

        expect(state._subscriptions.feedB.branches).to.be.eql({
          ['tests@1']: {
            parents: {
              ['tests@1']: true,
            },
            children: {
              ['tests@1']: true,
              ['tests@3']: true,
            },
          },
          ['tests@2']: {
            parents: {
              ['tests@2']: true,
            },
            children: {
              ['tests@2']: true,
              ['tests@3']: true,
              ['tests@4']: true,
            },
          },
          ['tests@3']: {
            parents: {
              ['tests@1']: true,
              ['tests@2']: true,
            },
            children: {
              ['tests@4']: true,
            },
          },
          ['tests@4']: {
            parents: {
              ['tests@2']: true,
              ['tests@3']: true,
            },
            children: {},
          },
          ['tests@6']: {
            parents: {
              ['tests@6']: true,
            },
            children: {
              ['tests@6']: true,
            },
          },
        });
      });
    });

    /* FEED A
     * |- tests@1
     * | |- tests@3
     * | | |- tests@4
     * | |   |- tests@5
     * | |- tests@5
     * |   |- tests@7
     * |- tests@2
     *   |- tests@3
     *   |- tests@4
     *     |- tests@6
     *
     * reverse GRAFT tests@4 from A to B
     *
     * FEED B                 FEED B
     * |- tests@6             |- tests@6
     *                        |- tests@4
     *                    =>    |- tests@5
     *                            |- tests@7
     *                          |- tests@6
     */
    it('graft bottomup', async function () {
      this.timeout(10000);
      await runner.it(async function () {
        await this.quest.warehouse.subscribe({
          feed: 'feedA',
          branches: ['tests@1', 'tests@2'],
        });
        await this.quest.warehouse.subscribe({
          feed: 'feedB',
          branches: ['tests@6'],
        });

        await this.quest.warehouse.upsert({
          branch: 'tests@3',
          data: {id: 'tests@3'},
          feeds: 'feedA',
          parents: 'tests@1',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@3',
          data: {id: 'tests@3'},
          feeds: 'feedA',
          parents: 'tests@2',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@4',
          data: {id: 'tests@4'},
          feeds: 'feedA',
          parents: 'tests@2',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@4',
          data: {id: 'tests@4'},
          feeds: 'feedA',
          parents: 'tests@3',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@5',
          data: {id: 'tests@5'},
          feeds: 'feedA',
          parents: 'tests@1',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@5',
          data: {id: 'tests@5'},
          feeds: 'feedA',
          parents: 'tests@4',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@6',
          data: {id: 'tests@6'},
          feeds: 'feedA',
          parents: 'tests@4',
        });
        await this.quest.warehouse.upsert({
          branch: 'tests@7',
          data: {id: 'tests@7'},
          feeds: 'feedA',
          parents: 'tests@5',
        });

        let state;
        state = await this.quest.getState('warehouse');
        state = state.toJS();
        expect(state._subscriptions.feedA.branches).to.be.eql({
          ['tests@1']: {
            parents: {
              ['tests@1']: true,
            },
            children: {
              ['tests@1']: true,
              ['tests@3']: true,
              ['tests@5']: true,
            },
          },
          ['tests@2']: {
            parents: {
              ['tests@2']: true,
            },
            children: {
              ['tests@2']: true,
              ['tests@3']: true,
              ['tests@4']: true,
            },
          },
          ['tests@3']: {
            parents: {
              ['tests@1']: true,
              ['tests@2']: true,
            },
            children: {
              ['tests@4']: true,
            },
          },
          ['tests@4']: {
            parents: {
              ['tests@2']: true,
              ['tests@3']: true,
            },
            children: {
              ['tests@5']: true,
              ['tests@6']: true,
            },
          },
          ['tests@5']: {
            parents: {
              ['tests@1']: true,
              ['tests@4']: true,
            },
            children: {
              ['tests@7']: true,
            },
          },
          ['tests@6']: {
            parents: {
              ['tests@4']: true,
            },
            children: {},
          },
          ['tests@7']: {
            parents: {
              ['tests@5']: true,
            },
            children: {},
          },
        });

        expect(state._subscriptions.feedB.branches).to.be.eql({
          ['tests@6']: {
            parents: {
              ['tests@6']: true,
            },
            children: {
              ['tests@6']: true,
            },
          },
        });

        await this.quest.warehouse.graft({
          branch: 'tests@4',
          fromFeed: 'feedA',
          toFeed: 'feedB',
          reverse: true,
        });

        state = await this.quest.getState('warehouse');
        state = state.toJS();

        expect(state._subscriptions.feedB.branches).to.be.eql({
          ['tests@4']: {
            parents: {},
            children: {
              ['tests@5']: true,
              ['tests@6']: true,
            },
          },
          ['tests@5']: {
            parents: {
              ['tests@4']: true,
            },
            children: {
              ['tests@7']: true,
            },
          },
          ['tests@6']: {
            parents: {
              ['tests@4']: true,
              ['tests@6']: true,
            },
            children: {
              ['tests@6']: true,
            },
          },
          ['tests@7']: {
            parents: {
              ['tests@5']: true,
            },
            children: {},
          },
        });
      });
    });
  });
});
