"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type DefaultEdgeOptions,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import { ExternalLink } from "lucide-react";
import { layoutGraph, type GraphIssue, type IssueNodeData } from "@/lib/graph-layout";
type IssueNode = Node<IssueNodeData, "issue">;
import { STATUS_META, PRIORITY_COLOR } from "@/lib/visual-tokens";

/**
 * The dependency-graph canvas. A client island: the server component at
 * /app/map/page.tsx reads the issue list and hands it in as a prop; this
 * component derives nodes/edges, runs dagre for a layered layout, and renders
 * the interactive surface.
 *
 * ReactFlow hard requirement (App Router): `nodeTypes` must be defined at
 * module scope, not inside the component, or React re-creates the map on every
 * render and warns. Same for `defaultEdgeOptions`.
 *
 * In SSR, ReactFlow renders nodes with `visibility:hidden` and computes edge
 * paths only after a DOM measurement pass that runs on the client. Mounting
 * client-only means ReactFlow initializes once, cleanly, against a real
 * measured container — so both nodes and edges render correctly.
 */

const nodeTypes = { issue: IssueNode };

const defaultEdgeOptions: DefaultEdgeOptions = {
  type: "smoothstep",
  // Arrowhead at the blocked (target) end — points from "do first" to "do next".
  markerEnd: { type: MarkerType.ArrowClosed, color: "#a3e635" },
  style: { stroke: "#a3e635", strokeOpacity: 0.5, strokeWidth: 1.5 },
};

export function GraphCanvas({ issues }: { issues: GraphIssue[] }) {
  const router = useRouter();

  const { nodes, edges } = useMemo(() => layoutGraph(issues), [issues]);

  const onNodeClick: NodeMouseHandler<IssueNode> = useCallback(
    (_e, node) => {
      router.push(`/issues/${node.data.identifier}`);
    },
    [router],
  );

  const frontierCount = useMemo(
    () => issues.filter((i) => i.ready).length,
    [issues],
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={onNodeClick}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        className="bg-transparent"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={26}
          size={1.5}
          color="rgba(140,170,220,0.18)"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => statusColorForNode(n.data)}
          nodeStrokeWidth={0}
          maskColor="rgba(4,6,12,0.72)"
          style={{
            background: "rgba(13,18,30,0.7)",
            border: "1px solid rgba(140,170,220,0.18)",
            borderRadius: 14,
            backdropFilter: "blur(12px)",
          }}
        />
        <Controls
          className="!border-[--border] !bg-[--surface]/80 !rounded-xl !shadow-lg !backdrop-blur [&_button]:!border-[--border] [&_button]:!bg-[--surface-2]/80 [&_button:hover]:!bg-[--surface-hover] [&_button>svg]:!fill-[--foreground-muted]"
          showInteractive={false}
        />
      </ReactFlow>

      <GraphToolbar
        nodeCount={nodes.length}
        edgeCount={edges.length}
        frontierCount={frontierCount}
      />
    </div>
  );
}

/**
 * Floating top-left overlay: title, counts, and a legend. Pure presentation;
 * kept in this file because it only makes sense next to the canvas.
 */
function GraphToolbar({
  nodeCount,
  edgeCount,
  frontierCount,
}: {
  nodeCount: number;
  edgeCount: number;
  frontierCount: number;
}) {
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-2">
      <div className="glass pointer-events-auto rounded-2xl px-3 py-2 text-xs">
        <div className="flex items-center gap-2 font-medium text-[--foreground]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[--accent] shadow-[0_0_8px_rgba(var(--glow),0.9)]" />
          Dependency graph
        </div>
        <div className="mt-1 flex items-center gap-3 text-[--foreground-muted]">
          <span>{nodeCount} issues</span>
          <span className="text-[--border-strong]">·</span>
          <span>{edgeCount} edges</span>
          <span className="text-[--border-strong]">·</span>
          <span className="text-[--success]">{frontierCount} ready</span>
        </div>
      </div>

      <div className="glass pointer-events-auto rounded-2xl px-3 py-2 text-[11px]">
        <div className="mb-1.5 font-medium text-[--foreground-muted]">Legend</div>
        <ul className="space-y-1">
          <li className="flex items-center gap-1.5 text-[--foreground]">
            <span className="graph-legend-pulse" />
            Frontier — ready to pick up
          </li>
          <li className="flex items-center gap-1.5 text-[--foreground-muted]">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-[--border-strong] bg-[--surface-2] opacity-50" />
            Blocked or waiting
          </li>
        </ul>
        <div className="mt-2 flex items-center gap-1 text-[--foreground-subtle]">
          <ExternalLink size={11} />
          Click a node to open
        </div>
      </div>
    </div>
  );
}

/**
 * A single issue node. Status drives the left border + status dot; priority
 * drives its dot. Frontier (ready) nodes get the animated glow via the
 * `.graph-node-frontier` class; everything not ready is dimmed so the eye
 * lands on actionable work.
 */
function IssueNode({ data }: { data: IssueNodeData }) {
  const status = STATUS_META[data.status];
  const priorityColor = PRIORITY_COLOR[data.priority];

  return (
    <div
      className={[
        "group graph-node",
        "w-[232px] rounded-2xl border bg-[--surface]/80 px-3 py-2.5 backdrop-blur-md transition-all duration-300",
        "border-[--border] hover:border-[--border-strong] hover:shadow-[0_18px_40px_-24px_rgba(var(--glow),0.6)] cursor-pointer",
        data.ready ? "graph-node-frontier" : "graph-node-dim",
      ].join(" ")}
      style={{ borderLeft: `3px solid ${status.color}` }}
    >
      {/* Read-only graph: handles exist only so edges can attach. They're
           invisible (no visible dot) but keep a real size so ReactFlow can
           compute connection points for edge paths. */}
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0 !top-0 !left-1/2 !-translate-x-1/2" />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-wide text-[--foreground-subtle]">
          {data.identifier}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: priorityColor }}
            title="Priority"
          />
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: status.color }}
            title={status.label}
          />
        </span>
      </div>
      <div className="mt-1 truncate text-[13px] font-medium text-[--foreground] group-hover:text-white">
        {data.title}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[--foreground-subtle]">
        {status.label}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0 !bottom-0 !left-1/2 !-translate-x-1/2" />
    </div>
  );
}

/** Read a status color for a minimap node from its data payload. */
function statusColorForNode(data: unknown): string {
  if (data && typeof data === "object" && "status" in data) {
    const s = (data as { status: keyof typeof STATUS_META }).status;
    return STATUS_META[s]?.color ?? "#6c6e76";
  }
  return "#6c6e76";
}
