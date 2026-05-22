import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { LanguageIcon } from "@/components/LanguageIcon";
import { extensionToSlug } from "@/lib/devicon-map";
import { cn } from "@/lib/utils";
import type { TreeEntry } from "@/lib/github";

interface Props {
  entries: TreeEntry[];
  className?: string;
  /** When true, top-level dirs start expanded. */
  defaultExpandTop?: boolean;
}

interface Node {
  name: string;
  path: string;
  type: "tree" | "blob";
  size?: number;
  children: Map<string, Node>;
}

function buildTree(entries: TreeEntry[]): Node {
  const root: Node = {
    name: "",
    path: "",
    type: "tree",
    children: new Map(),
  };
  for (const e of entries) {
    if (e.type === "commit") continue; // skip submodules for v1
    const parts = e.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const isLast = i === parts.length - 1;
      let child = cur.children.get(segment);
      if (!child) {
        child = {
          name: segment,
          path: parts.slice(0, i + 1).join("/"),
          type: isLast ? e.type : "tree",
          size: isLast ? e.size : undefined,
          children: new Map(),
        };
        cur.children.set(segment, child);
      }
      cur = child;
    }
  }
  return root;
}

export function FileTree({ entries, className, defaultExpandTop = true }: Props) {
  const root = useMemo(() => buildTree(entries), [entries]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (defaultExpandTop) {
      for (const child of root.children.values()) {
        if (child.type === "tree") s.add(child.path);
      }
    }
    return s;
  });

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <ul className={cn("text-sm", className)}>
      {[...root.children.values()]
        .sort(sortNodes)
        .map((c) => (
          <NodeRow
            key={c.path}
            node={c}
            depth={0}
            expanded={expanded}
            toggle={toggle}
          />
        ))}
    </ul>
  );
}

function sortNodes(a: Node, b: Node): number {
  if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function NodeRow({
  node,
  depth,
  expanded,
  toggle,
}: {
  node: Node;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
}) {
  const isOpen = node.type === "tree" && expanded.has(node.path);
  const indent = { paddingLeft: `${depth * 14 + 6}px` };
  const slug = node.type === "blob" ? extensionToSlug(node.name) : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => node.type === "tree" && toggle(node.path)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent/60",
          node.type === "blob" && "cursor-default",
        )}
        style={indent}
        title={node.path}
      >
        {node.type === "tree" ? (
          isOpen ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {node.type === "tree" ? (
          <Folder className="h-3.5 w-3.5 shrink-0 text-primary/80" />
        ) : slug ? (
          <LanguageIcon slug={slug} size={14} className="shrink-0" />
        ) : (
          <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-[12px]">{node.name}</span>
        {node.type === "blob" && typeof node.size === "number" && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {formatBytes(node.size)}
          </span>
        )}
      </button>
      {isOpen && node.children.size > 0 && (
        <ul>
          {[...node.children.values()]
            .sort(sortNodes)
            .map((c) => (
              <NodeRow
                key={c.path}
                node={c}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
              />
            ))}
        </ul>
      )}
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
