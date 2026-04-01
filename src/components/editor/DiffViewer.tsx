import { useMemo, useRef, useCallback, useState } from "react";
import { useGitStore } from "../../store/gitStore";
import "./DiffViewer.css";

const CONTEXT_LINES = 4;
const EXPAND_STEP = 10;

/* ── Diff parsing ── */

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: { type: "add" | "remove" | "context"; content: string }[];
}

function parseHunks(raw: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of raw.split("\n")) {
    const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      current = {
        oldStart: parseInt(m[1], 10),
        oldCount: parseInt(m[2] ?? "1", 10),
        newStart: parseInt(m[3], 10),
        newCount: parseInt(m[4] ?? "1", 10),
        lines: [],
      };
      hunks.push(current);
    } else if (current) {
      if (line.startsWith("+")) current.lines.push({ type: "add", content: line.slice(1) });
      else if (line.startsWith("-")) current.lines.push({ type: "remove", content: line.slice(1) });
      else if (line.startsWith(" ")) current.lines.push({ type: "context", content: line.slice(1) });
    }
  }
  return hunks;
}

/* ── Row types ── */

type CellType = "context" | "remove" | "add" | "empty";

interface Cell {
  num: number | null;
  content: string;
  type: CellType;
}

interface ContentRow {
  kind: "content";
  left: Cell;
  right: Cell;
}

interface FoldRow {
  kind: "fold";
  foldId: number;
  hidden: number;
}

type SbsRow = ContentRow | FoldRow;

/* ── Build rows ── */

function buildRows(
  oldContent: string,
  newContent: string,
  hunks: DiffHunk[],
  expandedFolds: Record<number, number>,
): SbsRow[] {
  const oldLines = oldContent ? oldContent.replace(/\r\n/g, "\n").split("\n") : [];
  const newLines = newContent ? newContent.replace(/\r\n/g, "\n").split("\n") : [];
  const rows: SbsRow[] = [];
  let foldId = 0;

  let oldIdx = 1;
  let newIdx = 1;

  function pushContext(oi: number, ni: number) {
    rows.push({
      kind: "content",
      left: { num: oi, content: oldLines[oi - 1] ?? "", type: "context" },
      right: { num: ni, content: newLines[ni - 1] ?? "", type: "context" },
    });
  }

  function pushGap(oStart: number, count: number, nStart: number, fromBottom = false) {
    if (count <= 0) return;

    const id = foldId++;
    const revealed = Math.min(expandedFolds[id] ?? 0, count);

    if (revealed >= count) {
      for (let j = 0; j < count; j++) pushContext(oStart + j, nStart + j);
      return;
    }

    if (fromBottom) {
      // Reveal from the bottom (fold stays at top, lines appear before the hunk)
      const hidden = count - revealed;
      rows.push({ kind: "fold", foldId: id, hidden });
      for (let j = count - revealed; j < count; j++) pushContext(oStart + j, nStart + j);
    } else {
      // Reveal from the top (fold stays at bottom, lines appear after the hunk)
      for (let j = 0; j < revealed; j++) pushContext(oStart + j, nStart + j);
      const hidden = count - revealed;
      rows.push({ kind: "fold", foldId: id, hidden });
    }
  }

  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h];
    const gapOld = hunk.oldStart - oldIdx;

    if (gapOld > 0) {
      const showTop = h === 0 ? 0 : CONTEXT_LINES;
      const showBot = CONTEXT_LINES;
      const totalCtx = showTop + showBot;

      if (gapOld <= totalCtx + 2) {
        for (let j = 0; j < gapOld; j++) pushContext(oldIdx + j, newIdx + j);
      } else {
        for (let j = 0; j < showTop; j++) pushContext(oldIdx + j, newIdx + j);
        pushGap(oldIdx + showTop, gapOld - totalCtx, newIdx + showTop, h === 0);
        for (let j = gapOld - showBot; j < gapOld; j++) pushContext(oldIdx + j, newIdx + j);
      }
      oldIdx += gapOld;
      newIdx += gapOld;
    }

    // Process hunk lines
    let i = 0;
    while (i < hunk.lines.length) {
      const line = hunk.lines[i];

      if (line.type === "context") {
        pushContext(oldIdx, newIdx);
        oldIdx++; newIdx++; i++;
        continue;
      }

      // Collect consecutive remove/add block
      const removes: string[] = [];
      const adds: string[] = [];
      while (i < hunk.lines.length && hunk.lines[i].type === "remove") {
        removes.push(hunk.lines[i].content); i++;
      }
      while (i < hunk.lines.length && hunk.lines[i].type === "add") {
        adds.push(hunk.lines[i].content); i++;
      }

      const maxLen = Math.max(removes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          kind: "content",
          left: j < removes.length
            ? { num: oldIdx + j, content: removes[j], type: "remove" }
            : { num: null, content: "", type: "empty" },
          right: j < adds.length
            ? { num: newIdx + j, content: adds[j], type: "add" }
            : { num: null, content: "", type: "empty" },
        });
      }
      oldIdx += removes.length;
      newIdx += adds.length;
    }
  }

  // Trailing unchanged lines
  const remain = Math.min(oldLines.length - oldIdx + 1, newLines.length - newIdx + 1);
  if (remain > 0) {
    const showTop = Math.min(CONTEXT_LINES, remain);
    for (let j = 0; j < showTop; j++) pushContext(oldIdx + j, newIdx + j);
    if (remain > showTop) pushGap(oldIdx + showTop, remain - showTop, newIdx + showTop);
  }

  return rows;
}

/* ── Component ── */

export function DiffViewer() {
  const diff = useGitStore((s) => s.diff);
  const oldContent = useGitStore((s) => s.oldContent);
  const newContent = useGitStore((s) => s.newContent);
  const selectedFile = useGitStore((s) => s.selectedFile);
  const [expandedFolds, setExpandedFolds] = useState<Record<number, number>>({});

  const prevFileRef = useRef(selectedFile);
  if (prevFileRef.current !== selectedFile) {
    prevFileRef.current = selectedFile;
    if (Object.keys(expandedFolds).length > 0) setExpandedFolds({});
  }

  const rows = useMemo(
    () => buildRows(oldContent, newContent, parseHunks(diff), expandedFolds),
    [diff, oldContent, newContent, expandedFolds],
  );

  const handleExpand = useCallback((id: number) => {
    setExpandedFolds((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + EXPAND_STEP }));
  }, []);

  if (!selectedFile) return null;

  if (rows.length === 0) {
    return (
      <div className="diff-viewer">
        <p className="diff-viewer__empty">No changes</p>
      </div>
    );
  }

  return (
    <div className="diff-viewer">
      <div className="diff-sbs">
        <table className="diff-sbs__table">
          <tbody>
            {rows.map((row, i) =>
              row.kind === "fold" ? (
                <tr key={i} className="diff-sbs__row diff-sbs__row--fold" onClick={() => handleExpand(row.foldId)}>
                  <td className="diff-sbs__gutter" />
                  <td className="diff-sbs__fold-label">
                    {row.hidden} lines hidden — click to expand
                  </td>
                  <td className="diff-sbs__gutter" />
                  <td className="diff-sbs__fold-label" />
                </tr>
              ) : (
                <tr key={i} className="diff-sbs__row">
                  <td className={`diff-sbs__gutter diff-sbs__gutter--${row.left.type}`}>
                    {row.left.num ?? ""}
                  </td>
                  <td className={`diff-sbs__code diff-sbs__cell--${row.left.type}`}>
                    <pre>{row.left.content}</pre>
                  </td>
                  <td className={`diff-sbs__gutter diff-sbs__gutter--${row.right.type}`}>
                    {row.right.num ?? ""}
                  </td>
                  <td className={`diff-sbs__code diff-sbs__cell--${row.right.type}`}>
                    <pre>{row.right.content}</pre>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
