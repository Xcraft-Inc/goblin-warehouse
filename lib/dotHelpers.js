function getBackgroundColor(namespace) {
  let bgcolor = '#eeeeee';
  if (namespace.endsWith('-worker')) {
    bgcolor = '#ccffff';
  } else if (namespace.endsWith('-workitem')) {
    bgcolor = '#ffccff';
  } else if (namespace.endsWith('-feeder')) {
    bgcolor = '#ffffcc';
  } else if (namespace.endsWith('-updater')) {
    bgcolor = '#ccffcc';
  } else if (namespace.endsWith('-dispatcher')) {
    bgcolor = '#ccccff';
  }
  return bgcolor;
}

function buildFullLabel(state, branch, ownOwner, index) {
  const namespace = branch.split('@', 1)[0];
  const bgcolor = getBackgroundColor(namespace);

  const toRed = (value) => `<font color="#b01717">${value}</font>`;
  const hasState = () => (state.has(branch) ? 'true' : toRed('false'));
  const getGen = () =>
    state.has(`_generations.${branch}`)
      ? state.get(`_generations.${branch}.generation`)
      : toRed(state.get(`_generations.${branch}.generation`));
  const branchLabel = branch.match(/.{1,40}/g);

  let label =
    `"${branch}-${index}" [style="" label=<` +
    `<font color="#888888">` +
    `<table bgcolor="${bgcolor}" ` +
    `       color="${bgcolor}" ` +
    `       border="5" ` +
    `       style="rounded" ` +
    `       cellpadding="0" ` +
    `       cellborder="0">` +
    `  <tr>` +
    `    <td width="18" align="left">` +
    `${
      ownOwner //
        ? '<font point-size="12" color="#222222">↺</font>'
        : ''
    }` +
    `    </td>` +
    `    <td width="100" align="left">` +
    `      <font point-size="10" color="#222222">${namespace}</font>` +
    `    </td>` +
    `  </tr>` +
    `  <tr>` +
    `    <td align="right" valign="top"><b>&nbsp;</b>id:</td>` +
    `    <td align="left" valign="top">` +
    `      ${branchLabel.join("<br align='left'/>")}` +
    `      <b>&nbsp;</b><br align='left'/>` +
    `    </td>` +
    `  </tr>` +
    `  <tr>` +
    `    <td align="right" valign="top"><b>&nbsp;</b>meta:</td>` +
    `    <td width="100" align="left" valign="top">` +
    `      state=${hasState()}, gen=${getGen()}<b>&nbsp;</b>` +
    `    </td>` +
    `  </tr>` +
    `</table>` +
    `</font>` +
    `>]`;
  return label.replace(/>[ ]+/g, '>').replace(/[ ]{2,}/g, ' ');
}

function buildSimpleLabel(state, branch, ownOwner, index) {
  const namespace = branch.split('@', 1)[0];
  const bgcolor = getBackgroundColor(namespace);

  const fgcolor = bgcolor.replace(/#(.{2})(.{2})(.{2})/, (_, r, g, b) => {
    const rgb = [r, g, b];
    return (
      '#' +
      rgb
        .map((c) => (parseInt(c, 16) - 16).toString(16).padStart(2, '0'))
        .join('')
    );
  });

  const label =
    `"${branch}-${index}" [` +
    `  color="${fgcolor}"` +
    `  fillcolor="${bgcolor}" ` +
    `  label=""` +
    `  xlabel=<` +
    `    <table bgcolor="white"` +
    `           border="0"` +
    `           cellpadding="1"` +
    `           cellspacing="0"` +
    `           style="rounded">` +
    `      <tr><td>${namespace}</td></tr>"` +
    `    </table>` +
    `  >` +
    `]`;
  return label.replace(/>[ ]+/g, '>').replace(/[ ]{2,}/g, ' ');
}

function generateGraph({type, layout}, state) {
  const JsonViz = require('xcraft-jsonviz');
  const graphs = [];

  let index = 0;
  state.get('_subscriptions').forEach((_, sub) => {
    const graph = {
      type: 'subgraph',
      name: `cluster_${sub}`,
      graph: {
        label: sub,
        fontname: 'Helvetica',
      },
      node: {
        fontname: 'Helvetica',
        fontsize: '6',
        style: 'filled',
        fillcolor: '#ffcccc',
      },
      edge: {
        fontname: 'Helvetica',
        color: '#888888',
      },
      statements: [],
    };

    switch (type) {
      case 'simple': {
        graph.node.shape = 'circle';
        graph.node.width = 0.15;
        graph.node.height = 0.15;
        graph.node.fixedsize = true;
        graph.edge.arrowsize = '.2';
        graph.edge.penwidth = '.3';
        break;
      }
      default:
      case 'complexe': {
        graph.node.shape = 'plaintext';
        graph.edge.arrowsize = '.6';
        break;
      }
    }

    state.get(`_subscriptions.${sub}.branches`).forEach((ownership, branch) => {
      ownership = ownership.toJS();

      let ownOwner;

      const entry = (left, right) =>
        `"${left}-${index}" -> "${right}-${index}"`;

      Object.keys(ownership.children)
        .filter((child) => {
          const same = child === branch;
          if (same) {
            ownOwner = true;
            return false;
          }
          return !graph.statements.includes(entry(child, branch));
        })
        .forEach((child) => graph.statements.push(entry(child, branch)));

      Object.keys(ownership.parents)
        .filter((parent) => {
          const same = parent === branch;
          if (same) {
            ownOwner = true;
            return false;
          }
          return !graph.statements.includes(entry(branch, parent));
        })
        .forEach((parent) => graph.statements.push(entry(branch, parent)));

      const label =
        type === 'complexe'
          ? buildFullLabel(state, branch, ownOwner, index)
          : buildSimpleLabel(state, branch, ownOwner, index);

      if (!graph.statements.includes(label)) {
        graph.statements.push(label);
      }
    });
    graphs.push(new JsonViz(graph));
    ++index;
  });

  const graph = {
    name: 'Goblin Warehouse - Ownerships',
    graph: {
      rankdir: 'LR',
      splines: 'polyline',
      fontname: 'Helvetica',
      style: 'dashed',
      margin: '50',
      layout,
      dpi: '96',
      outputorder: 'edgesfirst',
    },
    statements: graphs,
  };

  if (type === 'simple') {
    graph.graph.overlap = 'scale';
  }

  return new JsonViz(graph);
}

module.exports = {
  generateGraph,
};
