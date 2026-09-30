import {
  type WorkflowGraphNode,
  type WorkflowNodePromptUpdate,
  WorkflowNodePromptUpdateSetSchema,
  type WorkflowRunSnapshot,
} from "@mycode/contracts";
import {
  type ApplyWorkflowNodePromptUpdatesOptions,
  type ApplyWorkflowNodePromptUpdatesResult,
} from "./lifecycle-workflow-graph-node-change.js";

export function applyWorkflowNodePromptUpdates<TSnapshot extends WorkflowRunSnapshot>(
  snapshot: TSnapshot,
  updates: readonly WorkflowNodePromptUpdate[],
  options: ApplyWorkflowNodePromptUpdatesOptions,
): ApplyWorkflowNodePromptUpdatesResult<TSnapshot> {
  const parsedUpdates = WorkflowNodePromptUpdateSetSchema.parse({ nodes: updates }).nodes;
  const updatesByNodeId = new Map<string, WorkflowNodePromptUpdate>();
  for (const update of parsedUpdates) {
    if (updatesByNodeId.has(update.id)) {
      throw new Error(`Workflow node prompt update returned duplicate node: ${update.id}`);
    }
    updatesByNodeId.set(update.id, update);
  }
  if (updatesByNodeId.size === 0) {
    return { changed: false, snapshot, updatedNodes: [] };
  }

  const nodeIds = new Set(snapshot.graph.nodes.map((node) => node.id));
  for (const nodeId of updatesByNodeId.keys()) {
    if (!nodeIds.has(nodeId)) {
      throw new Error(`Workflow node prompt update references unknown node: ${nodeId}`);
    }
  }

  const updatedNodes: WorkflowGraphNode[] = [];
  const nodes = snapshot.graph.nodes.map((node) => {
    const update = updatesByNodeId.get(node.id);
    if (!update) return node;
    if (node.phase !== undefined && node.phase !== options.phase) {
      throw new Error(
        `Workflow node prompt update for "${node.id}" targets phase "${options.phase}" but node belongs to "${node.phase}"`,
      );
    }

    const nextNode: WorkflowGraphNode = {
      ...node,
      description: update.description ?? node.description,
      prompt: update.prompt ?? node.prompt,
      title: update.title ?? node.title,
    };
    if (
      nextNode.description === node.description &&
      nextNode.prompt === node.prompt &&
      nextNode.title === node.title
    ) {
      return node;
    }
    updatedNodes.push(nextNode);
    return nextNode;
  });

  if (updatedNodes.length === 0) {
    return { changed: false, snapshot, updatedNodes: [] };
  }

  return {
    changed: true,
    snapshot: {
      ...snapshot,
      graph: {
        collections: snapshot.graph.collections,
        edges: snapshot.graph.edges,
        nodes,
      },
      updatedAt: options.timestamp,
    } as TSnapshot,
    updatedNodes,
  };
}
