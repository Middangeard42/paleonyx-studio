import { useMemo, useState } from "react";
import { ChevronRight, File, Folder } from "lucide-react";
import clsx from "clsx";
import type { ProjectFile } from "@paleonyx/shared-types";

export interface FileTreeProps {
  files: ProjectFile[];
  selectedPath?: string;
  onSelect: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(files: ProjectFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), isFile: false };
  for (const file of files) {
    const segments = file.path.split("/");
    let node = root;
    let pathSoFar = "";
    segments.forEach((segment, index) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path: pathSoFar, children: new Map(), isFile };
        node.children.set(segment, child);
      }
      node = child;
    });
  }
  return root;
}

export function FileTree({ files, selectedPath, onSelect }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <div className="text-sm">
      {Array.from(tree.children.values()).map((node) => (
        <TreeRow key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.isFile) {
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        className={clsx(
          "flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left truncate",
          "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
          selectedPath === node.path ? "bg-accent-muted text-text-primary" : "text-text-secondary"
        )}
      >
        <File size={13} className="shrink-0 text-text-tertiary" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-text-secondary hover:bg-surface-2"
      >
        <ChevronRight size={12} className={clsx("shrink-0 transition-transform", open && "rotate-90")} />
        <Folder size={13} className="shrink-0 text-text-tertiary" />
        <span className="truncate">{node.name}</span>
      </button>
      {open &&
        Array.from(node.children.values()).map((child) => (
          <TreeRow key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
    </div>
  );
}
