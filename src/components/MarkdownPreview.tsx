import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  source: string | null;
  emptyHint?: string;
}

export function MarkdownPreview({ source, emptyHint }: Props) {
  if (!source) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        {emptyHint ?? "No README or CLAUDE.md found for this project."}
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <div className="px-6 py-5 prose-helm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeHighlight]}
          components={{
            a: ({ ...props }) => (
              <a
                {...props}
                target="_blank"
                rel="noreferrer noopener"
              />
            ),
            img: ({ src, alt }) => (
              <span className="block rounded border border-dashed border-border bg-muted/40 px-3 py-2 text-xs italic text-muted-foreground">
                image: {alt ?? src ?? "(no alt)"}
              </span>
            ),
          }}
        >
          {source}
        </ReactMarkdown>
      </div>
    </ScrollArea>
  );
}
