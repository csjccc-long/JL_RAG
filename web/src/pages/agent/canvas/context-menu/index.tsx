import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';

import styles from './index.module.less';

export interface INodeContextMenu {
  id: string;
  top: number;
  left: number;
  right?: number;
  bottom?: number;
  [key: string]: unknown;
}

export function NodeContextMenu({
  id,
  top,
  left,
  right,
  bottom,
  ...props
}: INodeContextMenu) {
  const { getNode, setNodes, addNodes, setEdges } = useReactFlow();

  const duplicateNode = useCallback(() => {
    const node = getNode(id);
    if (!node) return;
    const position = {
      x: node?.position?.x || 0 + 50,
      y: node?.position?.y || 0 + 50,
    };

    addNodes({
      ...node,
      data: node?.data,
      selected: false,
      dragging: false,
      id: `${node?.id}-copy`,
      position,
    });
  }, [id, getNode, addNodes]);

  const deleteNode = useCallback(() => {
    setNodes((nodes) => nodes.filter((node) => node.id !== id));
    setEdges((edges) => edges.filter((edge) => edge.source !== id));
  }, [id, setNodes, setEdges]);

  return (
    <div
      style={{ top, left, right, bottom }}
      className={styles.contextMenu}
      {...props}
    >
      <p style={{ margin: '0.5em' }}>
        <small>node: {id}</small>
      </p>
      <button onClick={duplicateNode} type={'button'}>
        duplicate
      </button>
      <button onClick={deleteNode} type={'button'}>
        delete
      </button>
    </div>
  );
}
