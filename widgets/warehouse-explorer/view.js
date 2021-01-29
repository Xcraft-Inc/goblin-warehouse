import React from 'react';
import Widget from 'goblin-laboratory/widgets/widget';
import View from 'goblin-laboratory/widgets/view';
import Container from 'goblin-gadgets/widgets/container/widget.js';
import Label from 'goblin-gadgets/widgets/label/widget.js';
import Button from 'goblin-gadgets/widgets/button/widget.js';
import CytoscapeComponent from 'react-cytoscapejs';
import Cytoscape from 'cytoscape';
//import coseBilkent from 'cytoscape-cose-bilkent';
//Cytoscape.use(coseBilkent);
import dagre from 'cytoscape-dagre';
Cytoscape.use(dagre);

class Graph extends Widget {
  constructor() {
    super(...arguments);
    this.init = this.init.bind(this);
    this.getImm = this.getImm.bind(this);
    this.toJsonImm = this.toJsonImm.bind(this);
    this.diffImm = this.diffImm.bind(this);
  }

  init(cy) {
    this.cy = cy;
    this.cy.unbind('tap', 'node');
    this.cy.on('tap', 'node', this.props.onTap);
  }

  getImm(object, key) {
    if (object && object.get) {
      return object.get(key);
    } else {
      return object[key];
    }
  }

  toJsonImm(object) {
    if (object && object.toJS) {
      return object.toJS();
    } else {
      return object;
    }
  }

  diffImm(objectA, objectB) {
    if (objectA && objectA.equals) {
      return !objectA.equals(objectB);
    } else {
      return objectA !== objectB;
    }
  }

  render() {
    if (!this.props.elements) {
      return null;
    }

    return (
      <CytoscapeComponent
        elements={this.props.elements}
        get={this.getImm}
        diff={this.diffImm}
        toJson={this.toJsonImm}
        cy={this.init}
        layout={{
          name: 'dagre',
          // dagre algo options, uses default value on undefined
          nodeSep: undefined, // the separation between adjacent nodes in the same rank
          edgeSep: undefined, // the separation between adjacent edges in the same rank
          rankSep: undefined, // the separation between each rank in the layout
          rankDir: 'LR', // 'TB' for top to bottom flow, 'LR' for left to right,
          ranker: 'longest-path', // Type of algorithm to assign a rank to each node in the input graph. Possible values: 'network-simplex', 'tight-tree' or 'longest-path'
          minLen: function (edge) {
            return 1;
          }, // number of ranks to keep between the source and target of the edge
          edgeWeight: function (edge) {
            return 1;
          }, // higher weight edges are generally made shorter and straighter than lower weight edges

          // general layout options
          fit: true, // whether to fit to viewport
          padding: 30, // fit padding
          spacingFactor: 1, // Applies a multiplicative factor (>0) to expand or compress the overall area that the nodes take up
          nodeDimensionsIncludeLabels: true, // whether labels should be included in determining the space used by a node
          animate: false, // whether to transition the node positions
          animateFilter: function (node, i) {
            return true;
          }, // whether to animate specific nodes when animation is on; non-animated nodes immediately go to their final positions
          animationDuration: 500, // duration of animation in ms if enabled
          animationEasing: undefined, // easing of animation if enabled
          boundingBox: undefined, // constrain layout bounds; { x1, y1, x2, y2 } or { x1, y1, w, h }
          transform: function (node, pos) {
            return pos;
          }, // a function that applies a transform to the final node position
          ready: function () {}, // on layoutready
          stop: function () {}, // on layoutstop
        }}
        style={{width: '100%', height: '100%'}}
      />
    );
  }
}

const SubGraph = Widget.connect((state, props) => {
  const elements = state.get(`backend.${props.id}.elements`, null);
  if (elements) {
    return {
      elements,
    };
  } else {
    return {elements: null};
  }
})(Graph);

class Tree extends Widget {
  constructor() {
    super(...arguments);
  }

  render() {
    if (!this.props.tree) {
      return null;
    }
    if (this.props.tree.entries) {
      return (
        <div
          style={{
            paddingLeft: `${this.props.level * 10}px`,
          }}
        >
          {Array.from(this.props.tree.entries()).map((entry, key) => (
            <div key={key}>
              <Label text={`${this.props.level}: ${entry[0]}`} />
              <Tree tree={entry[1]} level={this.props.level + 1} />
            </div>
          ))}
        </div>
      );
    } else {
      return null;
    }
  }
}

const Tree1 = Widget.connect((state, props) => {
  return {tree: state.get(`backend.${props.id}.tree1`), level: 1};
})(Tree);

class WarehouseExplorer extends Widget {
  constructor() {
    super(...arguments);
    this.explore = this.explore.bind(this);
    this.check = this.check.bind(this);
  }

  explore(type, value) {
    this.doFor(this.props.id, 'explore', {type, value});
  }

  check() {
    this.doFor(this.props.id, 'check');
  }

  render() {
    return (
      <Container kind="row" grow="1" width="100%">
        <Container kind="column" height="100%" width="25%">
          <Label kind="title" text="Feeds" />
          {this.props.subs
            ? this.props.subs.map((sub, key) => {
                const explore = () => this.explore('sub', sub);
                return (
                  <Button
                    key={key}
                    text={sub}
                    justify="start"
                    border="none"
                    onClick={explore}
                    active={this.props.sub === sub}
                  />
                );
              })
            : null}
          <Container kind="column" grow="1">
            <Label kind="title" text="Subscriptions" />
            <div style={{height: '60vh', overflowY: 'scroll'}}>
              <Tree1 id={this.props.id} />
            </div>
          </Container>
        </Container>
        <Container kind="column" height="100%" grow="1">
          <Label kind="title" text="Graph" />
          <SubGraph id={this.props.id} />
        </Container>
      </Container>
    );
  }
}

const Explorer = Widget.connect((state, props) => {
  return {
    subs: state.get(`backend.${props.id}.subs`),
    sub: state.get(`backend.${props.id}.sub`),
    orphan: state.get(`backend.${props.id}.orphan`),
    dangling: state.get(`backend.${props.id}.dangling`),
  };
})(WarehouseExplorer);

class WarehouseExplorerView extends View {
  render() {
    const {workitemId, desktopId} = this.props;
    return (
      <Container kind="view" width="100%">
        <Label
          fontStyle="italic"
          grow="1"
          fontWeight="bold"
          wrap="yes"
          glyph="solid/database"
          text="WAREHOUSE EXPLORER"
          glyphSize="100%"
          glyphSpin={false}
          fontSize="200%"
          justify="center"
          textColor="#fbce89"
        />
        <Explorer id={workitemId} desktopId={desktopId} />
      </Container>
    );
  }
}

export default WarehouseExplorerView;
