import { type WorkflowGraph, type WorkflowRunSnapshot } from "./workflow-workflow-session-link.js";
import {
  type WorkflowSchedulerState,
  TERMINAL_DEPENDENCY_STATUSES,
} from "./workflow-workflow-graph-record-schema.js";

export * from "./script.js";

export function deriveWorkflowSchedulerState(graph: WorkflowGraph): WorkflowSchedulerState {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incomingById = new Map<string, string[]>();
  const outgoingById = new Map<string, string[]>();

  for (const node of graph.nodes) {
    incomingById.set(node.id, [...node.dependsOn]);
    outgoingById.set(node.id, []);
  }

  for (const edge of graph.edges) {
    incomingById.set(edge.to, [...(incomingById.get(edge.to) ?? []), edge.from]);
    outgoingById.set(edge.from, [...(outgoingById.get(edge.from) ?? []), edge.to]);
  }

  const collections = graph.collections ?? [];
  const collectionIdsByNodeId = new Map<string, string[]>();
  for (const collection of collections) {
    for (const nodeId of collection.nodeIds ?? []) {
      const collectionIds = collectionIdsByNodeId.get(nodeId) ?? [];
      collectionIds.push(collection.collectionId);
      collectionIdsByNodeId.set(nodeId, collectionIds);
    }
  }
  for (const node of graph.nodes) {
    if (!node.collectionId) continue;
    const collectionIds = collectionIdsByNodeId.get(node.id) ?? [];
    if (!collectionIds.includes(node.collectionId)) {
      collectionIds.push(node.collectionId);
      collectionIdsByNodeId.set(node.id, collectionIds);
    }
  }

  const nodes = graph.nodes.map((node) => {
    const incoming = [...new Set(incomingById.get(node.id) ?? [])];
    const blockedBy = incoming.filter((dependencyId) => {
      const dependency = nodesById.get(dependencyId);
      return !dependency || !TERMINAL_DEPENDENCY_STATUSES.has(dependency.status);
    });
    return {
      blockedBy,
      collectionIds: collectionIdsByNodeId.get(node.id) ?? [],
      incoming,
      node,
      outgoing: [...new Set(outgoingById.get(node.id) ?? [])],
      ready: node.status === "pending" && blockedBy.length === 0,
    };
  });

  const activeNodeIds = nodes
    .filter((entry) => entry.node.status === "active")
    .map((entry) => entry.node.id);
  const blockedNodes = nodes
    .filter((entry) => entry.node.status === "pending" && entry.blockedBy.length > 0)
    .map((entry) => ({ blockedBy: entry.blockedBy, nodeId: entry.node.id }));
  const readyNodeIds = nodes.filter((entry) => entry.ready).map((entry) => entry.node.id);
  const collectionStates = collections.map((collection) => {
    const nodeIds = [
      ...new Set([
        ...(collection.nodeIds ?? []),
        ...graph.nodes
          .filter((node) => node.collectionId === collection.collectionId)
          .map((node) => node.id),
      ]),
    ];
    const activeCollectionNodeIds = nodeIds.filter(
      (nodeId) => nodesById.get(nodeId)?.status === "active",
    );
    const pendingNodeIds = nodeIds.filter((nodeId) => nodesById.get(nodeId)?.status === "pending");
    const completedNodeIds = nodeIds.filter(
      (nodeId) => nodesById.get(nodeId)?.status === "completed",
    );
    const failedNodeIds = nodeIds.filter((nodeId) => nodesById.get(nodeId)?.status === "failed");
    const readyCollectionNodeIds = readyNodeIds.filter((nodeId) => nodeIds.includes(nodeId));
    return {
      activeNodeIds: activeCollectionNodeIds,
      collection,
      completedNodeIds,
      errorCount: collection.errorCount ?? 0,
      exhausted: collection.exhausted ?? false,
      failedNodeIds,
      frontier: activeCollectionNodeIds.length + pendingNodeIds.length,
      frontierTarget: collection.frontierTarget,
      pendingNodeIds,
      plannerRuns: collection.plannerRuns ?? 0,
      readyNodeIds: readyCollectionNodeIds,
      status: collection.status ?? "active",
    };
  });

  return {
    activeActivities: [],
    activeChildSessionIds: [],
    activeNodeIds,
    blockedNodes,
    counts: {
      active: activeNodeIds.length,
      blocked: blockedNodes.length,
      completed: nodes.filter((entry) => entry.node.status === "completed").length,
      failed: nodes.filter((entry) => entry.node.status === "failed").length,
      pending: nodes.filter((entry) => entry.node.status === "pending").length,
      ready: readyNodeIds.length,
      total: nodes.length,
    },
    collectionStates,
    nodes,
    readyNodeIds,
  };
}

export function deriveWorkflowRunSchedulerState(
  snapshot: WorkflowRunSnapshot,
): WorkflowSchedulerState {
  const state = deriveWorkflowSchedulerState(snapshot.graph);
  const activeActivities = snapshot.activities
    .filter((activity) => activity.status === "active")
    .map((activity) => ({
      activityId: activity.activityId,
      ...(activity.nodeId ? { nodeId: activity.nodeId } : {}),
      phase: activity.phase,
      ...(activity.sessionId ? { sessionId: activity.sessionId } : {}),
      ...(activity.traceId ? { traceId: activity.traceId } : {}),
      ...(activity.turnId ? { turnId: activity.turnId } : {}),
    }));

  return {
    ...state,
    activeActivities,
    activeChildSessionIds: activeActivities
      .map((activity) => activity.sessionId)
      .filter((sessionId): sessionId is string => sessionId !== undefined),
  };
}

export { WorkflowKindSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowKind } from "./workflow-workflow-kind-schema.js";
export { WorkflowPhaseIdSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowPhaseId } from "./workflow-workflow-kind-schema.js";
export { WorkflowRunStatusSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowRunStatus } from "./workflow-workflow-kind-schema.js";
export { WorkflowNodeStatusSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowNodeStatus } from "./workflow-workflow-kind-schema.js";
export { WorkflowGraphCollectionStatusSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowGraphCollectionStatus } from "./workflow-workflow-kind-schema.js";
export { ExpertWorkflowPhaseSchema } from "./workflow-workflow-kind-schema.js";
export type { ExpertWorkflowPhase } from "./workflow-workflow-kind-schema.js";
export { WorkflowStrategySchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowStrategy } from "./workflow-workflow-kind-schema.js";
export { ExpertWorkflowStrategySchema } from "./workflow-workflow-kind-schema.js";
export type { ExpertWorkflowStrategy } from "./workflow-workflow-kind-schema.js";
export { WorkflowPhaseBehaviorSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowPhaseBehavior } from "./workflow-workflow-kind-schema.js";
export { WorkflowGraphSeedSourceSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowGraphSeedSource } from "./workflow-workflow-kind-schema.js";
export { WorkflowPhaseDefinitionSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowPhaseDefinition } from "./workflow-workflow-kind-schema.js";
export { WorkflowDefinitionSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowDefinition } from "./workflow-workflow-kind-schema.js";
export { WorkflowArtifactSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowArtifact } from "./workflow-workflow-kind-schema.js";
export { WorkflowPhaseSnapshotSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowPhaseSnapshot } from "./workflow-workflow-kind-schema.js";
export { WorkflowActivityKindSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowActivityKind } from "./workflow-workflow-kind-schema.js";
export { WorkflowSessionLinkStatusSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowSessionLinkStatus } from "./workflow-workflow-kind-schema.js";
export { WorkflowFailureKindSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowFailureKind } from "./workflow-workflow-kind-schema.js";
export { WorkflowFailureSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowFailure } from "./workflow-workflow-kind-schema.js";
export { WorkflowRecoveryActionSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowRecoveryAction } from "./workflow-workflow-kind-schema.js";
export { WorkflowSessionLinkSchema } from "./workflow-workflow-kind-schema.js";
export type { WorkflowSessionLink } from "./workflow-workflow-session-link.js";
export { WorkflowActivitySnapshotSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowActivitySnapshot } from "./workflow-workflow-session-link.js";
export { WorkflowGraphNodeSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowGraphNode } from "./workflow-workflow-session-link.js";
export { WorkflowGraphEdgeSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowGraphEdge } from "./workflow-workflow-session-link.js";
export { WorkflowGraphCollectionSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowGraphCollection } from "./workflow-workflow-session-link.js";
export { WorkflowGraphSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowGraph } from "./workflow-workflow-session-link.js";
export { WorkflowGraphPlannerNodeSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowGraphPlannerNode } from "./workflow-workflow-session-link.js";
export { WorkflowGraphPlannerResultSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowGraphPlannerResult } from "./workflow-workflow-session-link.js";
export { WorkflowGraphSeedCollectionSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowGraphSeedCollection } from "./workflow-workflow-session-link.js";
export { WorkflowGraphSeedSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowGraphSeed } from "./workflow-workflow-session-link.js";
export { WorkflowNodePromptUpdateSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowNodePromptUpdate } from "./workflow-workflow-session-link.js";
export { WorkflowNodePromptUpdateSetSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowNodePromptUpdateSet } from "./workflow-workflow-session-link.js";
export { WorkflowCriticSeveritySchema } from "./workflow-workflow-session-link.js";
export type { WorkflowCriticSeverity } from "./workflow-workflow-session-link.js";
export { WorkflowCriticReopenProposalSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowCriticReopenProposal } from "./workflow-workflow-session-link.js";
export { WorkflowCriticResultSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowCriticResult } from "./workflow-workflow-session-link.js";
export { WorkflowRunSnapshotSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowRunSnapshot } from "./workflow-workflow-session-link.js";
export { ExpertWorkflowRunSnapshotSchema } from "./workflow-workflow-session-link.js";
export type { ExpertWorkflowRunSnapshot } from "./workflow-workflow-session-link.js";
export { WorkflowEventTypeSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowEventType } from "./workflow-workflow-session-link.js";
export { WorkflowEventSchema } from "./workflow-workflow-session-link.js";
export type { WorkflowEvent } from "./workflow-workflow-session-link.js";
export { WorkflowGraphRecordSchema } from "./workflow-workflow-graph-record-schema.js";
export type { WorkflowGraphRecord } from "./workflow-workflow-graph-record-schema.js";
export { WorkflowSchedulerDerivedNodeSchema } from "./workflow-workflow-graph-record-schema.js";
export type { WorkflowSchedulerDerivedNode } from "./workflow-workflow-graph-record-schema.js";
export { WorkflowSchedulerCollectionStateSchema } from "./workflow-workflow-graph-record-schema.js";
export type { WorkflowSchedulerCollectionState } from "./workflow-workflow-graph-record-schema.js";
export { WorkflowSchedulerActiveActivitySchema } from "./workflow-workflow-graph-record-schema.js";
export type { WorkflowSchedulerActiveActivity } from "./workflow-workflow-graph-record-schema.js";
export { WorkflowSchedulerStateSchema } from "./workflow-workflow-graph-record-schema.js";
export type { WorkflowSchedulerState } from "./workflow-workflow-graph-record-schema.js";
export { deriveWorkflowSessionLinks } from "./workflow-workflow-graph-record-schema.js";
export type { WorkflowRunListItem } from "./workflow-workflow-graph-record-schema.js";
export type { WorkflowStorePort } from "./workflow-workflow-graph-record-schema.js";
export type { WorkflowDefinitionStorePort } from "./workflow-workflow-graph-record-schema.js";
