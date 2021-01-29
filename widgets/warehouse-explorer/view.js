import React from 'react';
import Container from 'goblin-gadgets/widgets/container/widget.js';
import Label from 'goblin-gadgets/widgets/label/widget.js';
import View from 'goblin-laboratory/widgets/view';
import Explorer from './widget.js';

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
