import { useMemo, useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pencil } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEditorStore, isMarkdownFile } from "../../store/editorStore";
import { editorViewRef } from "./EditorPane";
import "./MarkdownPreview.css";

/* ── rehype plugin: stamp data-line on block elements ── */

const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "table", "tr", "hr", "div",
]);

function rehypeSourceLines() {
  return (tree: any) => {
    stampLines(tree);
  };
  function stampLines(node: any) {
    if (node.type === "element" && BLOCK_TAGS.has(node.tagName) && node.position) {
      node.properties = node.properties || {};
      node.properties["data-line"] = node.position.start.line;
    }
    if (node.children) {
      for (const child of node.children) stampLines(child);
    }
  }
}

/* ── Scroll-mapping helpers ──
 *
 * Both directions use the same approach: build anchor pairs from [data-line]
 * elements, find which two anchors the current scroll position falls between,
 * then linearly interpolate to compute the target scroll position.
 */

interface Anchor {
  line: number;
  previewOffset: number; // offsetTop relative to panel
  editorOffset: number;  // block.top from CodeMirror
}

/** Build a sorted list of anchors mapping source lines to both panes' offsets */
function buildAnchorMap(panel: HTMLElement): Anchor[] {
  const view = editorViewRef.current;
  if (!view) return [];
  const els = panel.querySelectorAll<HTMLElement>("[data-line]");
  const anchors: Anchor[] = [];
  const seen = new Set<number>();

  for (const el of els) {
    const line = parseInt(el.dataset.line!, 10);
    if (isNaN(line) || seen.has(line)) continue;
    seen.add(line);
    const clampedLine = Math.min(line, view.state.doc.lines);
    const lineInfo = view.state.doc.line(clampedLine);
    const block = view.lineBlockAt(lineInfo.from);
    anchors.push({
      line,
      previewOffset: el.offsetTop,
      editorOffset: block.top,
    });
  }
  return anchors;
}

/** Interpolate: given a scroll position in one pane, compute the target in the other */
function interpolate(
  scrollTop: number,
  anchors: Anchor[],
  fromKey: "previewOffset" | "editorOffset",
  toKey: "previewOffset" | "editorOffset"
): number {
  if (anchors.length === 0) return 0;
  if (anchors.length === 1) return anchors[0][toKey];

  // Before first anchor
  if (scrollTop <= anchors[0][fromKey]) return anchors[0][toKey];

  // Between anchors — find pair and interpolate
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (scrollTop >= a[fromKey] && scrollTop <= b[fromKey]) {
      const range = b[fromKey] - a[fromKey];
      if (range === 0) return a[toKey];
      const t = (scrollTop - a[fromKey]) / range;
      return a[toKey] + t * (b[toKey] - a[toKey]);
    }
  }

  // After last anchor
  return anchors[anchors.length - 1][toKey];
}

/** Find the nearest [data-line] element to a click y-position */
function lineAtClick(container: HTMLElement, clientY: number): number {
  const els = container.querySelectorAll<HTMLElement>("[data-line]");
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const dist = Math.abs(mid - clientY);
    if (dist < bestDist) { bestDist = dist; best = el; }
  }
  return best ? parseInt(best.dataset.line!, 10) || 1 : 1;
}

/**
 * Estimate a source column from a click position.
 * Uses caretRangeFromPoint to find the clicked text node, then searches
 * for that text in the source line to map the offset correctly.
 */
function colAtClick(clientX: number, clientY: number, sourceLine: string): number {
  if (!document.caretRangeFromPoint) return 0;
  const range = document.caretRangeFromPoint(clientX, clientY);
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return 0;

  const textNode = range.startContainer as Text;
  const renderedText = textNode.textContent || "";
  const offsetInRendered = range.startOffset;

  const idx = sourceLine.indexOf(renderedText);
  if (idx === -1) {
    const before = renderedText.slice(Math.max(0, offsetInRendered - 8), offsetInRendered);
    const after = renderedText.slice(offsetInRendered, offsetInRendered + 8);
    const snippet = before + after;
    if (snippet.length > 2) {
      const snippetIdx = sourceLine.indexOf(snippet);
      if (snippetIdx !== -1) return snippetIdx + before.length;
    }
    return 0;
  }
  return idx + offsetInRendered;
}

export function MarkdownPreview({ variant }: { variant: "full" | "panel" }) {
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const openFiles = useEditorStore((s) => s.openFiles);
  const markdownModes = useEditorStore((s) => s.markdownModes);
  const setMarkdownMode = useEditorStore((s) => s.setMarkdownMode);
  const containerRef = useRef<HTMLDivElement>(null);
  const activePaneRef = useRef<"editor" | "preview" | null>(null);
  const isSyncingRef = useRef(false);

  const activeFile = useMemo(
    () => openFiles.find((f) => f.path === activeFilePath) ?? null,
    [openFiles, activeFilePath]
  );

  const mode = activeFilePath ? markdownModes[activeFilePath] : undefined;
  const isActive =
    activeFile &&
    isMarkdownFile(activeFile.name) &&
    ((variant === "full" && mode === "preview") ||
      (variant === "panel" && mode === "split"));

  // ── Scroll sync for side-by-side mode ──
  useEffect(() => {
    if (variant !== "panel" || !isActive) return;
    const panel = containerRef.current;
    if (!panel) return;
    const editorPane = document.querySelector(".editor-pane--split") as HTMLElement | null;
    const editorScroller = editorPane?.querySelector(".cm-scroller") as HTMLElement | null;
    if (!editorPane || !editorScroller) return;

    const onEditorEnter = () => { activePaneRef.current = "editor"; };
    const onPanelEnter = () => { activePaneRef.current = "preview"; };

    const onEditorScroll = () => {
      if (activePaneRef.current !== "editor" || isSyncingRef.current) return;
      isSyncingRef.current = true;
      const anchors = buildAnchorMap(panel);
      const target = interpolate(editorScroller.scrollTop, anchors, "editorOffset", "previewOffset");
      panel.scrollTop = target;
      requestAnimationFrame(() => { requestAnimationFrame(() => { isSyncingRef.current = false; }); });
    };

    const onPanelScroll = () => {
      if (activePaneRef.current !== "preview" || isSyncingRef.current) return;
      isSyncingRef.current = true;
      const anchors = buildAnchorMap(panel);
      const target = interpolate(panel.scrollTop, anchors, "previewOffset", "editorOffset");
      editorScroller.scrollTop = target;
      requestAnimationFrame(() => { requestAnimationFrame(() => { isSyncingRef.current = false; }); });
    };

    editorPane.addEventListener("mouseenter", onEditorEnter);
    panel.addEventListener("mouseenter", onPanelEnter);
    editorScroller.addEventListener("scroll", onEditorScroll, { passive: true });
    panel.addEventListener("scroll", onPanelScroll, { passive: true });

    return () => {
      editorPane.removeEventListener("mouseenter", onEditorEnter);
      panel.removeEventListener("mouseenter", onPanelEnter);
      editorScroller.removeEventListener("scroll", onEditorScroll);
      panel.removeEventListener("scroll", onPanelScroll);
    };
  }, [variant, isActive]);

  const handlePreviewClick = useCallback(
    (e: React.MouseEvent) => {
      if (variant !== "full" || !activeFilePath || !activeFile) return;
      const el = containerRef.current;
      if (!el) return;

      const sourceLine = lineAtClick(el, e.clientY);
      const lines = activeFile.content.split("\n");
      const sourceText = lines[sourceLine - 1] || "";
      const col = colAtClick(e.clientX, e.clientY, sourceText);

      setMarkdownMode(activeFilePath, "off");
      useEditorStore.setState((s) => ({
        markdownAutoRestore: new Set(s.markdownAutoRestore).add(activeFilePath),
      }));

      // Place cursor and center it on screen
      requestAnimationFrame(() => {
        const view = editorViewRef.current;
        if (!view) return;
        const clampedLine = Math.min(Math.max(1, sourceLine), view.state.doc.lines);
        const lineInfo = view.state.doc.line(clampedLine);
        const clampedCol = Math.min(col, lineInfo.length);
        const pos = lineInfo.from + clampedCol;
        view.dispatch({ selection: { anchor: pos } });
        // Scroll so the cursor line is in the middle of the viewport
        const block = view.lineBlockAt(pos);
        const viewportHeight = view.scrollDOM.clientHeight;
        view.scrollDOM.scrollTop = block.top - viewportHeight / 2 + block.height / 2;
        view.focus();
      });
    },
    [variant, activeFilePath, activeFile, setMarkdownMode]
  );

  const handleEditButton = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!activeFilePath) return;
      setMarkdownMode(activeFilePath, "off");
      useEditorStore.setState((s) => ({
        markdownAutoRestore: new Set(s.markdownAutoRestore).add(activeFilePath),
      }));
      requestAnimationFrame(() => {
        editorViewRef.current?.focus();
      });
    },
    [activeFilePath, setMarkdownMode]
  );

  const rehypePlugins = useMemo(() => [rehypeSourceLines], []);

  const rendered = useMemo(() => {
    if (!activeFile || !isActive) return null;
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                {...props}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (href) openUrl(href);
                }}
              >
                {children}
              </a>
            );
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match && !className;
            if (isInline) {
              return (
                <code className="md-preview__inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <div className="md-preview__code-block">
                {match && (
                  <span className="md-preview__code-lang">{match[1]}</span>
                )}
                <pre>
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
        }}
      >
        {activeFile.content}
      </ReactMarkdown>
    );
  }, [activeFile?.content, isActive, rehypePlugins]);

  if (!isActive) return null;

  return (
    <div
      className={`md-preview md-preview--${variant}`}
      ref={containerRef}
      onClick={variant === "full" ? handlePreviewClick : undefined}
    >
      <div className="md-preview__content">{rendered}</div>
      {variant === "full" && (
        <button
          className="md-preview__edit-btn"
          onClick={handleEditButton}
          title="Edit (click anywhere)"
        >
          <Pencil size={13} />
          Edit
        </button>
      )}
    </div>
  );
}
