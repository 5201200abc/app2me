import {
  deriveWorkflowSessionLinks,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
  type WorkflowRunSnapshot,
} from "@mycode/contracts";
import {
  type CancelWorkflowSnapshotOptions,
  type WorkflowSnapshotLifecycleResult,
  DEFAULT_CANCEL_REASON,
  type WorkflowGraphNodeChange,
  CANCELLABLE_STATUSES,
  nodeChange,
  closePhase,
  closeActivity,
  type ReopenWorkflowGraphNodeOptions,
  type ReopenWorkflowGraphNodeResult,
  REOPENABLE_STATUSES,
  DEFAULT_REOPEN_REASON,
} from "./lifecycle-workflow-graph-node-change.js";

export function cancelWorkflowSnapshot<TSnapshot extends WorkflowRunSnapshot>(
  snapshot: TSnapshot,
  options: CancelWorkflowSnapshotOptions,
): WorkflowSnapshotLifecycleResult<TSnapshot> {
  const reason = options.reason ?? DEFAULT_CANCEL_REASON;
  const nodeChanges: WorkflowGraphNodeChange[] = [];

  const nodes = snapshot.graph.nodes.map((node) => {
    if (!CANCELLABLE_STATUSES.has(node.status)) {
      return node;
    }
    nodeChanges.push(nodeChange(node, "cancelled"));
    return {
      ...node,
      error: reason,
      status: "cancelled" as const,
    };
  });

  const phaseIds: string[] = [];
  const phases = snapshot.phases.map((phase) => {
    if (!CANCELLABLE_STATUSES.has(phase.status)) {
      return phase;
    }
    phaseIds.push(phase.phase);
    return closePhase(phase, "cancelled", options.timestamp, reason);
  });

  const activityIds: string[] = [];
  const activities = snapshot.activities.map((activity) => {
    if (!CANCELLABLE_STATUSES.has(activity.status)) {
      return activity;
    }
    activityIds.push(activity.activityId);
    return closeActivity(activity, "cancelled", options.timestamp, reason);
  });

  const changed =
    snapshot.status !== "cancelled" ||
    snapshot.completedAt !== options.timestamp ||
    nodeChanges.length > 0 ||
    phaseIds.length > 0 ||
    activityIds.length > 0;

  return {
    activityIds,
    changed,
    nodeChanges,
    phaseIds,
    snapshot: changed
      ? ({
          ...snapshot,
          activities,
          completedAt: options.timestamp,
          graph: {
            collections: snapshot.graph.collections,
            edges: snapshot.graph.edges,
            nodes,
          },
          phases,
          sessionLinks: deriveWorkflowSessionLinks({ activities, runId: snapshot.runId }),
          status: "cancelled",
          updatedAt: options.timestamp,
        } as TSnapshot)
      : snapshot,
  };
}

export function reopenWorkflowGraphNode<TSnapshot extends WorkflowRunSnapshot>(
  snapshot: TSnapshot,
  options: ReopenWorkflowGraphNodeOptions,
): ReopenWorkflowGraphNodeResult<TSnapshot> {
  const node = snapshot.graph.nodes.find((item) => item.id === options.nodeId);
  if (!node) {
    throw new Error(`Workflow graph node not found: ${options.nodeId}`);
  }
  if (!REOPENABLE_STATUSES.has(node.status)) {
    throw new Error(
      `Cannot reopen workflow node "${options.nodeId}": status is "${node.status}", expected completed, failed, or skipped`,
    );
  }

  const maxReopens = options.maxReopens ?? 2;
  const reopenAttempts = node.reopenAttempts ?? 0;
  if (reopenAttempts >= maxReopens) {
    throw new Error(
      `Workflow node "${options.nodeId}" already reopened ${reopenAttempts}x (max=${maxReopens})`,
    );
  }

  const nextAttempts = reopenAttempts + 1;
  const reason = options.reason ?? DEFAULT_REOPEN_REASON;
  const nodes = snapshot.graph.nodes.map((item) =>
    item.id === options.nodeId
      ? {
          ...item,
          error: reason,
          reopenAttempts: nextAttempts,
          status: "pending" as const,
        }
      : item,
  );

  return {
    changed: true,
    nodeChange: nodeChange(node, "pending"),
    reopenAttempts: nextAttempts,
    snapshot: {
      ...snapshot,
      graph: {
        collections: snapshot.graph.collections,
        edges: snapshot.graph.edges,
        nodes,
      },
      updatedAt: options.timestamp,
    } as TSnapshot,
  };
}

export function normalizeSeedEdges(
  existingEdges: readonly WorkflowGraphEdge[],
  addedNodes: readonly WorkflowGraphNode[],
  seedEdges: readonly WorkflowGraphEdge[],
): WorkflowGraphEdge[] {
  const edges = seedEdges.map((edge) => ({ from: edge.from, to: edge.to }));
  const knownEdgeIds = new Set([...existingEdges, ...edges].map(edgeId));
  for (const node of addedNodes) {
    for (const dependencyId of node.dependsOn) {
      const edge = { from: dependencyId, to: node.id };
      const id = edgeId(edge);
      if (knownEdgeIds.has(id)) continue;
      edges.push(edge);
      knownEdgeIds.add(id);
    }
  }
  return edges;
}

export function validateAddedEdges(
  existingNodes: readonly WorkflowGraphNode[],
  existingEdges: readonly WorkflowGraphEdge[],
  addedNodes: readonly WorkflowGraphNode[],
  addedEdges: readonly WorkflowGraphEdge[],
): void {
  const nodeIds = new Set([...existingNodes, ...addedNodes].map((node) => node.id));
  const seenEdgeIds = new Set(existingEdges.map(edgeId));
  const pendingEdges = [...existingEdges];
  for (const edge of addedEdges) {
    if (edge.from === edge.to) {
      throw new Error(`Workflow graph seed returned a self-loop edge: ${edge.from} -> ${edge.to}`);
    }
    if (!nodeIds.has(edge.from)) {
      throw new Error(
        `Workflow graph seed returned an edge with unknown source node: ${edge.from}`,
      );
    }
    if (!nodeIds.has(edge.to)) {
      throw new Error(`Workflow graph seed returned an edge with unknown target node: ${edge.to}`);
    }
    const id = edgeId(edge);
    if (seenEdgeIds.has(id)) {
      throw new Error(`Workflow graph seed returned duplicate edge: ${id}`);
    }
    if (wouldFormCycle(pendingEdges, edge)) {
      throw new Error(`Workflow graph seed returned an edge that would create a cycle: ${id}`);
    }
    seenEdgeIds.add(id);
    pendingEdges.push(edge);
  }
}

export function wouldFormCycle(
  edges: readonly WorkflowGraphEdge[],
  newEdge: WorkflowGraphEdge,
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  const visited = new Set<string>();
  const queue = [newEdge.to];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === newEdge.from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

export function edgeId(edge: WorkflowGraphEdge): string {
  return `${edge.from}->${edge.to}`;
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
