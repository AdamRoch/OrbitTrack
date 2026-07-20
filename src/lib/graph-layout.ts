import type { Edge, Node, XYPosition } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type { IssueStatus, Priority } from "@/lib/db/schema";

/**
 * Pure transforms for the dependency-graph canvas. No React, no DOM, no DB —
 * just turning an issue list into ReactFlow nodes + edges. This lives outside
 * the client component so it is trivially testable and so the canvas can stay
 * a thin presentation layer.
 *
 * Convention reminder: a row `(blocker=A, blocked=B)` reads "A blocks B".
 * Each issue carries the ids of its blockers as `blockerIssueIds`. So an edge
 * flows **blocker → blocked**, which under a top→bottom layout reads naturally
 * as "do the top thing first, then the thing below it."
 */

/** The lean, JSON-safe view of an issue the canvas needs. */
export interface GraphIssue {
  id: number;
  identifier: string;
  title: string;
  status: IssueStatus;
  priority: Priority;
  /** True when `todo` and every blocker is `done` — the frontier. */
  ready: boolean;
  /** Ids of issues that must reach `done` before this one is ready. */
  blockerIssueIds: number[];
}

/** Data payload attached to every ReactFlow node. */
export interface IssueNodeData extends Record<string, unknown> {
  identifier: string;
  title: string;
  status: IssueStatus;
  priority: Priority;
  ready: boolean;
}

export type IssueNode = Node<IssueNodeData, "issue">;

/**
 * Fixed node dimensions, shared by dagre (for layout) and the ReactFlow node
 * object (so ReactFlow never needs to DOM-measure — v12 keeps nodes
 * `visibility:hidden` until measured, and explicitly setting width/height on
 * the node object satisfies that without a measurement pass; see
 * https://github.com/xyflow/xyflow/issues/3270).
 */
export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 68;

/** Build a unique, stable edge id from its endpoints. */
function edgeId(source: number, target: number): string {
  return `e${source}-${target}`;
}

/**
 * Build nodes + edges (without positions) from an issue list.
 *
 * - Every issue becomes a node. Nodes are keyed by stringified id so ReactFlow
 *   and dagre share one stable identity.
 * - For each issue, every `blockerId` in `blockerIssueIds` becomes an edge
 *   `blocker → blocked`. Edges pointing at missing issues (a blocker that was
 *   deleted) are dropped — the cascade already removed the row, but this keeps
 *   the view robust if the payload is ever stale.
 */
function buildGraph(
  issues: GraphIssue[],
): { nodes: IssueNode[]; edges: Edge[] } {
  const ids = new Set(issues.map((i) => i.id));

  const nodes: IssueNode[] = issues.map((issue) => ({
    id: String(issue.id),
    type: "issue",
    position: { x: 0, y: 0 }, // dagre assigns real positions downstream.
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
    data: {
      identifier: issue.identifier,
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      ready: issue.ready,
    },
  }));

  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    for (const blockerId of issue.blockerIssueIds) {
      if (!ids.has(blockerId)) continue; // stale reference; skip.
      const id = edgeId(blockerId, issue.id);
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({
        id,
        source: String(blockerId),
        target: String(issue.id),
        type: "smoothstep",
      });
    }
  }

  return { nodes, edges };
}

/**
 * Assign node positions via dagre's layered layout.
 *
 * Returns a new nodes array with `position` filled in. Edges are passed
 * through unchanged (dagre only needs them for ranking). Nodes with no edges
 * still get a position — dagre stacks them in a column.
 */
function layoutWithDagre(
  nodes: IssueNode[],
  edges: Edge[],
): IssueNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 56, marginx: 32, marginy: 32 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id) as (XYPosition & { width: number; height: number }) | undefined;
    if (!pos) return node;
    // dagre gives a center point; ReactFlow positions from the top-left.
    return {
      ...node,
      position: {
        x: pos.x - pos.width / 2,
        y: pos.y - pos.height / 2,
      },
    };
  });
}

/** Convenience: build + lay out in one call. */
export function layoutGraph(issues: GraphIssue[]): {
  nodes: IssueNode[];
  edges: Edge[];
} {
  const { nodes, edges } = buildGraph(issues);
  return { nodes: layoutWithDagre(nodes, edges), edges };
}
