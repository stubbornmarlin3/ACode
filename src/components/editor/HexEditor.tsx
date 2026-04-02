import React, { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import "./HexEditor.css";

const BYTES_PER_ROW = 16;

function formatOffset(offset: number): string {
  return offset.toString(16).toUpperCase().padStart(8, "0");
}

function byteClass(b: number): string {
  if (b === 0) return "hex-editor__byte--null";
  if (b >= 0x20 && b <= 0x7e) return "hex-editor__byte--printable";
  if (b > 0x7f) return "hex-editor__byte--high";
  return "hex-editor__byte--control";
}

function toAscii(b: number): { char: string; cls: string } {
  if (b >= 0x20 && b <= 0x7e) return { char: String.fromCharCode(b), cls: "" };
  return { char: ".", cls: "hex-editor__ascii--dot" };
}

function bytesToHexContent(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    parts.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return parts.join("");
}

export function HexEditor() {
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bytesRef = useRef<Uint8Array | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editingIndexRef = useRef<number | null>(null);
  const editValueRef = useRef("");

  // Maps byte index → hex span and ascii span for direct DOM manipulation
  const hexSpanMap = useRef<Map<number, HTMLSpanElement>>(new Map());
  const asciiSpanMap = useRef<Map<number, HTMLSpanElement>>(new Map());
  // Suppresses blur when clicking a byte (mousedown on span blurs the input before startEdit runs)
  const suppressBlurRef = useRef(false);
  // Undo stack: each entry is { index, oldValue } before the edit was applied
  const undoStackRef = useRef<{ index: number; oldValue: number }[]>([]);

  useEffect(() => {
    if (!activeFilePath) {
      setBytes(null);
      bytesRef.current = null;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    clearEditing();
    undoStackRef.current = [];

    const store = useEditorStore.getState();
    const file = store.openFiles.find((f) => f.path === activeFilePath);
    const isHex = !!store.hexModes[activeFilePath];
    const hasHexContent = isHex && file && file.isDirty && /^[0-9a-f]*$/i.test(file.content) && file.content.length % 2 === 0 && file.content.length > 0;

    if (hasHexContent) {
      const hex = file!.content;
      const arr = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      bytesRef.current = arr;
      setBytes(arr);
      setLoading(false);
      return;
    }

    invoke<number[]>("read_file_bytes", { path: activeFilePath })
      .then((data) => {
        if (!cancelled) {
          const arr = new Uint8Array(data);
          bytesRef.current = arr;
          setBytes(arr);
          const hexContent = bytesToHexContent(arr);
          useEditorStore.setState((s) => ({
            openFiles: s.openFiles.map((f) =>
              f.path === activeFilePath ? { ...f, content: hexContent, baseContent: hexContent, isDirty: false } : f
            ),
          }));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [activeFilePath]);

  // ── All editing logic uses refs + direct DOM, no React state re-renders ──

  const positionInput = useCallback((index: number) => {
    const span = hexSpanMap.current.get(index);
    const input = inputRef.current;
    const container = containerRef.current;
    if (!span || !input || !container) return;
    const cr = container.getBoundingClientRect();
    const sr = span.getBoundingClientRect();
    input.style.top = `${sr.top - cr.top + container.scrollTop}px`;
    input.style.left = `${sr.left - cr.left + container.scrollLeft}px`;
  }, []);

  const setHighlight = useCallback((index: number | null, on: boolean) => {
    if (index === null) return;
    const hexSpan = hexSpanMap.current.get(index);
    const asciiSpan = asciiSpanMap.current.get(index);
    if (hexSpan) hexSpan.classList.toggle("hex-editor__byte--editing", on);
    if (asciiSpan) asciiSpan.classList.toggle("hex-editor__ascii--editing", on);
  }, []);

  const hideInput = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.style.top = "-9999px";
      input.style.left = "-9999px";
      input.value = "";
    }
  }, []);

  const clearEditing = useCallback(() => {
    setHighlight(editingIndexRef.current, false);
    editingIndexRef.current = null;
    editValueRef.current = "";
    hideInput();
  }, [setHighlight, hideInput]);

  const updateSpanDOM = useCallback((index: number, val: number) => {
    const hexSpan = hexSpanMap.current.get(index);
    const hex = val.toString(16).toUpperCase().padStart(2, "0");
    if (hexSpan) hexSpan.textContent = hex;
    const asciiSpan = asciiSpanMap.current.get(index);
    if (asciiSpan) {
      const a = toAscii(val);
      asciiSpan.textContent = a.char;
      asciiSpan.className = a.cls + (asciiSpan.classList.contains("hex-editor__ascii--editing") ? " hex-editor__ascii--editing" : "");
    }
  }, []);

  const syncToStore = useCallback((newBytes: Uint8Array) => {
    if (!activeFilePath) return;
    queueMicrotask(() => {
      useEditorStore.getState().updateFileContent(activeFilePath, bytesToHexContent(newBytes));
    });
    setBytes(newBytes);
  }, [activeFilePath]);

  const undo = useCallback(() => {
    if (!bytesRef.current || !activeFilePath) return;
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    const newBytes = new Uint8Array(bytesRef.current);
    newBytes[entry.index] = entry.oldValue;
    bytesRef.current = newBytes;
    updateSpanDOM(entry.index, entry.oldValue);
    syncToStore(newBytes);
    // If we're editing the byte that was undone, update the input value
    if (editingIndexRef.current === entry.index) {
      const hex = entry.oldValue.toString(16).toUpperCase().padStart(2, "0");
      editValueRef.current = hex;
      if (inputRef.current) inputRef.current.value = hex;
    }
  }, [activeFilePath, updateSpanDOM, syncToStore]);

  // Global Ctrl+Z listener so undo works even when the edit input isn't focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && undoStackRef.current.length > 0) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo]);

  const applyEdit = useCallback((index: number, hexStr: string) => {
    const val = parseInt(hexStr, 16);
    if (isNaN(val) || val < 0 || val > 0xff || !bytesRef.current || !activeFilePath) return;
    if (bytesRef.current[index] === val) return;
    undoStackRef.current.push({ index, oldValue: bytesRef.current[index] });
    const newBytes = new Uint8Array(bytesRef.current);
    newBytes[index] = val;
    bytesRef.current = newBytes;
    updateSpanDOM(index, val);
    syncToStore(newBytes);
  }, [activeFilePath, updateSpanDOM, syncToStore]);

  const startEdit = useCallback((index: number) => {
    if (!bytesRef.current) return;
    suppressBlurRef.current = true;
    // Commit previous edit if any
    const prev = editingIndexRef.current;
    if (prev !== null) {
      applyEdit(prev, editValueRef.current);
    }
    // Clear previous highlight
    setHighlight(prev, false);
    // Set new
    editingIndexRef.current = index;
    editValueRef.current = bytesRef.current[index].toString(16).toUpperCase().padStart(2, "0");
    setHighlight(index, true);
    positionInput(index);
    const input = inputRef.current;
    if (input) {
      input.value = editValueRef.current;
      input.focus();
      input.select();
    }
    requestAnimationFrame(() => { suppressBlurRef.current = false; });
  }, [setHighlight, positionInput, applyEdit]);

  const commitAndMove = useCallback((nextIndex: number | null) => {
    const idx = editingIndexRef.current;
    if (idx !== null && bytesRef.current) {
      applyEdit(idx, editValueRef.current);
    }
    if (nextIndex !== null && bytesRef.current) {
      const clamped = Math.max(0, Math.min(bytesRef.current.length - 1, nextIndex));
      startEdit(clamped);
    } else {
      clearEditing();
    }
  }, [applyEdit, startEdit, clearEditing]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    const idx = editingIndexRef.current;

    if (raw.length > 2 && idx !== null) {
      // Third char typed — commit first 2 to current byte, advance with overflow
      const commit = raw.slice(0, 2);
      const overflow = raw.slice(2);
      applyEdit(idx, commit);

      if (bytesRef.current && idx < bytesRef.current.length - 1) {
        startEdit(idx + 1);
        const v = overflow.slice(0, 2);
        editValueRef.current = v;
        if (inputRef.current) inputRef.current.value = v;
      } else {
        editValueRef.current = commit;
        e.target.value = commit;
      }
    } else {
      const v = raw.slice(0, 2);
      editValueRef.current = v;
      e.target.value = v;
    }
  }, [applyEdit, startEdit]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl+Z undo — works even when not actively editing a byte
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      undo();
      return;
    }
    const idx = editingIndexRef.current;
    if (idx === null) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitAndMove(null); // commit in place, stop editing
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearEditing();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitAndMove(e.shiftKey ? idx - 1 : idx + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      commitAndMove(idx - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      commitAndMove(idx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      commitAndMove(idx - BYTES_PER_ROW);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      commitAndMove(idx + BYTES_PER_ROW);
    }
  }, [commitAndMove, clearEditing, undo]);

  const handleInputBlur = useCallback(() => {
    if (suppressBlurRef.current) return;
    const idx = editingIndexRef.current;
    if (idx !== null && bytesRef.current) {
      applyEdit(idx, editValueRef.current);
    }
    clearEditing();
  }, [applyEdit, clearEditing]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    // If clicking outside a byte span while editing, commit
    if (editingIndexRef.current !== null && !(e.target as HTMLElement).closest(".hex-editor__byte") && !(e.target as HTMLElement).closest(".hex-editor__edit-input")) {
      handleInputBlur();
    }
  }, [handleInputBlur]);

  const rows = useMemo(() => {
    if (!bytes) return [];
    const result: { offset: number; cells: { hex: string; cls: string; idx: number }[]; ascii: { char: string; cls: string; idx: number }[] }[] = [];
    for (let i = 0; i < bytes.length; i += BYTES_PER_ROW) {
      const slice = bytes.subarray(i, i + BYTES_PER_ROW);
      const cells: { hex: string; cls: string; idx: number }[] = [];
      const ascii: { char: string; cls: string; idx: number }[] = [];
      for (let j = 0; j < BYTES_PER_ROW; j++) {
        if (j < slice.length) {
          const b = slice[j];
          cells.push({ hex: b.toString(16).toUpperCase().padStart(2, "0"), cls: byteClass(b), idx: i + j });
          const a = toAscii(b);
          ascii.push({ char: a.char, cls: a.cls, idx: i + j });
        } else {
          cells.push({ hex: "  ", cls: "", idx: -1 });
          ascii.push({ char: " ", cls: "", idx: -1 });
        }
      }
      result.push({ offset: i, cells, ascii });
    }
    return result;
  }, [bytes]);

  if (!activeFilePath) return null;
  if (loading) return <div className="hex-editor__loading">Loading bytes...</div>;
  if (error) return <div className="hex-editor__loading">Error: {error}</div>;
  if (!bytes) return null;

  const fileSize = bytes.length;
  const sizeLabel = fileSize < 1024 ? `${fileSize} B`
    : fileSize < 1024 * 1024 ? `${(fileSize / 1024).toFixed(1)} KB`
    : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className="hex-editor" ref={containerRef} onClick={handleContainerClick}>
      <input
        ref={inputRef}
        className="hex-editor__edit-input"
        style={{ top: -9999, left: -9999 }}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onBlur={handleInputBlur}
        spellCheck={false}
        tabIndex={-1}
      />

      <div className="hex-editor__table" onMouseDown={(e) => {
        if (editingIndexRef.current !== null && e.target !== inputRef.current) {
          e.preventDefault();
        }
      }}>
        <div className="hex-editor__col-header hex-editor__col-header--offset">Offset</div>
        <div className="hex-editor__col-header hex-editor__col-header--hex">
          {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
            <React.Fragment key={i}>
              <span>{i.toString(16).toUpperCase().padStart(2, "0")}</span>
              {i < BYTES_PER_ROW - 1 ? " " : ""}
            </React.Fragment>
          ))}
        </div>
        <div className="hex-editor__col-header hex-editor__col-header--ascii">
          <span>ASCII</span>
          <span className="hex-editor__size-label">{sizeLabel} ({fileSize.toLocaleString()} bytes)</span>
        </div>
        {rows.map((row) => (
          <React.Fragment key={row.offset}>
            <div className="hex-editor__row-offset">{formatOffset(row.offset)}</div>
            <div className="hex-editor__row-hex">
              {row.cells.map((cell, j) => (
                <React.Fragment key={j}>
                  <span
                    ref={(el) => { if (cell.idx >= 0 && el) hexSpanMap.current.set(cell.idx, el); }}
                    className={`hex-editor__byte${cell.cls ? " " + cell.cls : ""}`}
                    onClick={cell.idx >= 0 ? () => startEdit(cell.idx) : undefined}
                  >
                    {cell.hex}
                  </span>
                  {j < BYTES_PER_ROW - 1 ? " " : ""}
                </React.Fragment>
              ))}
            </div>
            <div className="hex-editor__row-ascii">
              {row.ascii.map((cell, j) => (
                <span
                  key={j}
                  ref={(el) => { if (cell.idx >= 0 && el) asciiSpanMap.current.set(cell.idx, el); }}
                  className={cell.cls}
                >
                  {cell.char}
                </span>
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
