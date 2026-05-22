import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  Code2,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Save,
  Undo2,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { CmEditor } from "@/components/CmEditor";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { ipc } from "@/lib/ipc";
import { basename } from "@/lib/path";
import { cn } from "@/lib/utils";
import type { FileReadResult } from "@/types";

interface QuickViewProps {
  /** Absolute path. null = closed. */
  path: string | null;
  /** Initial mode. The user can flip from view → edit inside the
   * dialog via the toolbar button. */
  initialMode: "view" | "edit";
  onClose: () => void;
}

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
]);

function extOf(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const name = (slash < 0 ? p : p.slice(slash + 1)).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function QuickView({ path, initialMode, onClose }: QuickViewProps) {
  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [readResult, setReadResult] = useState<FileReadResult | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Mirror of the initialMode so a re-open with a different mode picks
  // it up. (initialMode by itself in props doesn't reset state.)
  const [lastInitialMode, setLastInitialMode] = useState(initialMode);

  const ext = path ? extOf(path) : "";
  const isImage = IMAGE_EXTS.has(ext);
  const isMarkdown = ext === "md" || ext === "markdown";

  // Load file content whenever the dialog opens with a new path.
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveError(null);
    setReadResult(null);
    setEditValue("");
    if (initialMode !== lastInitialMode) {
      setMode(initialMode);
      setLastInitialMode(initialMode);
    } else {
      setMode(initialMode);
    }
    if (isImage) {
      setLoading(false);
      return;
    }
    ipc
      .readText(path)
      .then((r) => {
        if (cancelled) return;
        setReadResult(r);
        setEditValue(r.content);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const isDirty = useMemo(() => {
    if (!readResult) return false;
    return editValue !== readResult.content;
  }, [editValue, readResult]);

  const filename = path ? basename(path) : "";

  const handleSave = useCallback(async () => {
    if (!path) return;
    if (!isDirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await ipc.writeText(path, editValue);
      // Re-baseline the read result so dirty flips false.
      setReadResult((prev) =>
        prev
          ? { ...prev, content: editValue, total_bytes: editValue.length }
          : prev,
      );
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [path, editValue, isDirty]);

  const handleDiscard = useCallback(() => {
    if (!readResult) return;
    setEditValue(readResult.content);
  }, [readResult]);

  const handleOpenInEditor = useCallback(async () => {
    if (!path) return;
    try {
      await ipc.openPathInEditor(path);
    } catch (e) {
      setSaveError(String(e));
    }
  }, [path]);

  const requestClose = useCallback(() => {
    if (mode === "edit" && isDirty) {
      const ok = window.confirm(
        `You have unsaved changes in "${filename}". Discard them?`,
      );
      if (!ok) return;
    }
    onClose();
  }, [mode, isDirty, filename, onClose]);

  const open = !!path;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent
        className="flex h-[85vh] max-h-[900px] max-w-5xl flex-col gap-0 p-0"
        onEscapeKeyDown={(e) => {
          // Defer to our dirty-state confirm.
          e.preventDefault();
          requestClose();
        }}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-semibold">
              {filename || "—"}
            </DialogTitle>
            <DialogDescription className="truncate font-mono text-[11px]">
              {path ?? ""}
            </DialogDescription>
          </div>
          <ModeBadge mode={mode} dirty={isDirty} />
          {readResult?.truncated && (
            <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-medium text-yellow-400">
              Truncated · {formatBytes(readResult.total_bytes)} total
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <QuickViewBody
            path={path}
            loading={loading}
            error={error}
            readResult={readResult}
            mode={mode}
            isImage={isImage}
            isMarkdown={isMarkdown}
            editValue={editValue}
            onEditValueChange={setEditValue}
            onSave={handleSave}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-card/40 px-4 py-2.5">
          {saveError && (
            <span className="mr-2 flex items-center gap-1.5 text-[11px] text-destructive">
              <AlertCircle className="h-3 w-3" />
              {saveError}
            </span>
          )}
          <div className="flex-1" />
          {mode === "edit" && !isImage && !readResult?.binary && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDiscard}
                disabled={!isDirty || saving}
              >
                <Undo2 /> Discard
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={!isDirty || saving}
              >
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                Save
              </Button>
            </>
          )}
          {mode === "view" && !isImage && !readResult?.binary && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMode("edit")}
            >
              <Edit3 /> Edit
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleOpenInEditor}>
            <Code2 /> Open in VS Code
          </Button>
          <Button variant="ghost" size="sm" onClick={requestClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModeBadge({
  mode,
  dirty,
}: {
  mode: "view" | "edit";
  dirty: boolean;
}) {
  if (mode === "view") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Eye className="h-2.5 w-2.5" /> View
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        dirty
          ? "bg-primary/20 text-primary"
          : "bg-emerald-500/15 text-emerald-400",
      )}
    >
      <Edit3 className="h-2.5 w-2.5" />
      {dirty ? "Modified" : "Edit"}
    </span>
  );
}

function QuickViewBody({
  path,
  loading,
  error,
  readResult,
  mode,
  isImage,
  isMarkdown,
  editValue,
  onEditValueChange,
  onSave,
}: {
  path: string | null;
  loading: boolean;
  error: string | null;
  readResult: FileReadResult | null;
  mode: "view" | "edit";
  isImage: boolean;
  isMarkdown: boolean;
  editValue: string;
  onEditValueChange: (next: string) => void;
  onSave: () => void;
}) {
  if (!path) return null;

  if (isImage) {
    return (
      <ScrollArea className="h-full">
        <div className="grid h-full place-items-center bg-black/30 p-6">
          <img
            src={convertFileSrc(path)}
            alt={basename(path)}
            className="max-h-full max-w-full rounded border border-border shadow-lg"
          />
        </div>
      </ScrollArea>
    );
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-md space-y-2">
          <AlertCircle className="mx-auto h-6 w-6 text-destructive" />
          <p className="text-sm font-medium text-destructive">
            Failed to read file
          </p>
          <p className="font-mono text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!readResult) return null;

  if (readResult.binary) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-md space-y-3">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">Binary file</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(readResult.total_bytes)} · not safe to render as
            text. Use the system default app to view it.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => ipc.openPathExternal(path).catch(() => {})}
          >
            <ExternalLink /> Open externally
          </Button>
        </div>
      </div>
    );
  }

  // Markdown gets tabs for Raw + Rendered. Editing always uses the
  // Raw tab (you edit source, not the rendered output).
  if (isMarkdown) {
    return (
      <Tabs defaultValue={mode === "edit" ? "raw" : "rendered"} className="flex h-full flex-col">
        <TabsList className="mx-4 mt-2 w-fit shrink-0">
          <TabsTrigger value="rendered">Rendered</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>
        <TabsContent value="rendered" className="m-0 min-h-0 flex-1 overflow-hidden">
          <MarkdownPreview source={editValue} />
        </TabsContent>
        <TabsContent value="raw" className="m-0 min-h-0 flex-1 overflow-hidden">
          <CmEditor
            value={editValue}
            onChange={onEditValueChange}
            filepath={path}
            readOnly={mode === "view"}
            onSave={onSave}
            className="h-full"
          />
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <CmEditor
      value={editValue}
      onChange={onEditValueChange}
      filepath={path}
      readOnly={mode === "view"}
      onSave={onSave}
      className="h-full"
    />
  );
}
