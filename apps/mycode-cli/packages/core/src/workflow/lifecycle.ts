import {
  type WorkflowGraphCollection,
  type WorkflowGraphNode,
  type WorkflowGraphSeed,
  WorkflowGraphSeedSchema,
  type WorkflowRunSnapshot,
} from "@mycode/contracts";
import {
  type ApplyWorkflowGraphSeedOptions,
  type ApplyWorkflowGraphSeedResult,
} from "./lifecycle-workflow-graph-node-change.js";
import {
  uniqueStrings,
  normalizeSeedEdges,
  validateAddedEdges,
} from "./lifecycle-cancel-workflow-snapshot.js";

export function applyWorkflowGraphSeed<TSnapshot extends WorkflowRunSnapshot>(
  snapshot: TSnapshot,
  seed: WorkflowGraphSeed,
  options: ApplyWorkflowGraphSeedOptions,
): ApplyWorkflowGraphSeedResult<TSnapshot> {
  const parsedSeed = WorkflowGraphSeedSchema.parse(seed);
  const existingNodeIds = new Set(snapshot.graph.nodes.map((node) => node.id));
  const addedNodes: WorkflowGraphNode[] = [];
  const pendingNodeIds = new Set<string>();

  for (const node of parsedSeed.nodes) {
    if (existingNodeIds.has(node.id) || pendingNodeIds.has(node.id)) {
      throw new Error(`Workflow graph seed returned duplicate node: ${node.id}`);
    }
    pendingNodeIds.add(node.id);
    addedNodes.push({
      collectionId: node.collectionId,
      dependsOn: uniqueStrings(node.dependsOn ?? []),
      description: node.description,
      id: node.id,
      kind: node.kind ?? "task",
      phase: node.phase ?? options.phase,
      prompt: node.prompt,
      status: "pending",
      title: node.title,
    });
  }

  const addedEdges = normalizeSeedEdges(snapshot.graph.edges, addedNodes, parsedSeed.edges);
  validateAddedEdges(snapshot.graph.nodes, snapshot.graph.edges, addedNodes, addedEdges);

  const knownNodeIds = new Set([
    ...snapshot.graph.nodes.map((node) => node.id),
    ...addedNodes.map((node) => node.id),
  ]);
  const existingCollectionIds = new Set(
    (snapshot.graph.collections ?? []).map((collection) => collection.collectionId),
  );
  const addedCollections: WorkflowGraphCollection[] = [];
  const pendingCollectionIds = new Set<string>();
  for (const collection of parsedSeed.collections) {
    if (
      existingCollectionIds.has(collection.collectionId) ||
      pendingCollectionIds.has(collection.collectionId)
    ) {
      throw new Error(
        `Workflow graph seed returned duplicate collection: ${collection.collectionId}`,
      );
    }
    pendingCollectionIds.add(collection.collectionId);
    const implicitNodeIds = addedNodes
      .filter((node) => node.collectionId === collection.collectionId)
      .map((node) => node.id);
    const nodeIds = uniqueStrings([...(collection.nodeIds ?? []), ...implicitNodeIds]);
    for (const nodeId of nodeIds) {
      if (!knownNodeIds.has(nodeId)) {
        throw new Error(
          `Workflow graph seed collection "${collection.collectionId}" references unknown node: ${nodeId}`,
        );
      }
    }
    addedCollections.push({
      collectionId: collection.collectionId,
      explorable: collection.explorable,
      frontierTarget: collection.frontierTarget,
      goal: collection.goal,
      metric: collection.metric,
      nodeIds,
      phase: collection.phase ?? options.phase,
      title: collection.title,
    });
  }

  const changed = addedNodes.length > 0 || addedEdges.length > 0 || addedCollections.length > 0;
  return {
    addedCollections,
    addedEdges,
    addedNodes,
    changed,
    snapshot: changed
      ? ({
          ...snapshot,
          graph: {
            collections: [...(snapshot.graph.collections ?? []), ...addedCollections],
            edges: [...snapshot.graph.edges, ...addedEdges],
            nodes: [...snapshot.graph.nodes, ...addedNodes],
          },
          updatedAt: options.timestamp,
        } as TSnapshot)
      : snapshot,
  };
}

export type { WorkflowGraphNodeChange } from "./lifecycle-workflow-graph-node-change.js";
export type { WorkflowSnapshotLifecycleResult } from "./lifecycle-workflow-graph-node-change.js";
export type { ReconcileWorkflowSnapshotForResumeOptions } from "./lifecycle-workflow-graph-node-change.js";
export type { CancelWorkflowSnapshotOptions } from "./lifecycle-workflow-graph-node-change.js";
export type { ReopenWorkflowGraphNodeOptions } from "./lifecycle-workflow-graph-node-change.js";
export type { ReopenWorkflowGraphNodeResult } from "./lifecycle-workflow-graph-node-change.js";
export type { ApplyWorkflowGraphSeedOptions } from "./lifecycle-workflow-graph-node-change.js";
export type { ApplyWorkflowGraphSeedResult } from "./lifecycle-workflow-graph-node-change.js";
export type { ApplyWorkflowNodePromptUpdatesOptions } from "./lifecycle-workflow-graph-node-change.js";
export type { ApplyWorkflowNodePromptUpdatesResult } from "./lifecycle-workflow-graph-node-change.js";
export { reconcileWorkflowSnapshotForResume } from "./lifecycle-workflow-graph-node-change.js";
export { cancelWorkflowSnapshot } from "./lifecycle-cancel-workflow-snapshot.js";
export { reopenWorkflowGraphNode } from "./lifecycle-cancel-workflow-snapshot.js";
export { applyWorkflowNodePromptUpdates } from "./lifecycle-apply-workflow-node-prompt-updates.js";
