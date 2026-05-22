import { useEffect, useMemo, useRef, useState } from "react";
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
  /** Parent path (empty string for top-level). */
  parent: string;
  children: Map<string, Node>;
}

function buildTree(entries: TreeEntry[]): Node {
  const root: Node = {
    name: "",
    path: "",
    type: "tree",
    parent: "",
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
          parent: parts.slice(0, i).join("/"),
          children: new Map(),
        };
        cur.children.set(segment, child);
      }
      cur = child;
    }
  }
  return root;
}

function sortNodes(a: Node, b: Node): number {
  if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** Walks the tree honoring `expanded`; returns a flat ordered list. */
function flattenVisible(root: Node, expanded: Set<string>): Node[] {
  const out: Node[] = [];
  const visit = (n: Node) => {
    out.push(n);
    if (n.type === "tree" && expanded.has(n.path)) {
      for (const c of [...n.children.values()].sort(sortNodes)) visit(c);
    }
  };
  for (const top of [...root.children.values()].sort(sortNodes)) visit(top);
  return out;
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

  const visible = useMemo(() => flattenVisible(root, expanded), [root, expanded]);

  // Track focused path. Default to the first visible node when the tree
  // first loads.
  const [focusedPath, setFocusedPath] = useState<string | null>(
    () => visible[0]?.path ?? null,
  );
  // If the entries change wholesale, snap focus back to the top.
  useEffect(() => {
    if (!focusedPath || !visible.some((n) => n.path === focusedPath)) {
      setFocusedPath(visible[0]?.path ?? null);
    }
  }, [visible, focusedPath]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // Auto-scroll the focused row into view whenever it changes.
  useEffect(() => {
    if (focusedPath) {
      const el = rowRefs.current.get(focusedPath);
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [focusedPath]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (visible.length === 0) return;
    const idx = visible.findIndex((n) => n.path === focusedPath);
    const cur = idx >= 0 ? visible[idx] : visible[0];

    const move = (next: number) => {
      const clamped = Math.max(0, Math.min(visible.length - 1, next));
      setFocusedPath(visible[clamped].path);
    };

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(idx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(idx - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(visible.length - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (cur.type === "tree") {
          if (!expanded.has(cur.path)) {
            toggle(cur.path);
          } else if (cur.children.size > 0) {
            const firstChild = [...cur.children.values()].sort(sortNodes)[0];
            setFocusedPath(firstChild.path);
          }
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (cur.type === "tree" && expanded.has(cur.path)) {
          toggle(cur.path);
        } else if (cur.parent) {
          setFocusedPath(cur.parent);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (cur.type === "tree") toggle(cur.path);
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      aria-label="File tree"
    >
      <ul className="text-sm">
        {visible.map((node) => (
          <FlatRow
            key={node.path}
            node={node}
            depth={node.path.split("/").length - 1}
            isOpen={node.type === "tree" && expanded.has(node.path)}
            focused={node.path === focusedPath}
            onActivate={() => {
              setFocusedPath(node.path);
              if (node.type === "tree") toggle(node.path);
            }}
            onMouseEnter={() => setFocusedPath(node.path)}
            registerRef={(el) => {
              if (el) rowRefs.current.set(node.path, el);
              else rowRefs.current.delete(node.path);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function FlatRow({
  node,
  depth,
  isOpen,
  focused,
  onActivate,
  onMouseEnter,
  registerRef,
}: {
  node: Node;
  depth: number;
  isOpen: boolean;
  focused: boolean;
  onActivate: () => void;
  onMouseEnter: () => void;
  registerRef: (el: HTMLLIElement | null) => void;
}) {
  const indent = { paddingLeft: `${depth * 14 + 6}px` };
  const slug = node.type === "blob" ? extensionToSlug(node.name) : null;
  return (
    <li ref={registerRef} onMouseEnter={onMouseEnter}>
      <button
        type="button"
        onClick={onActivate}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent/60",
          focused && "bg-primary/15 ring-1 ring-primary/40",
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
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
