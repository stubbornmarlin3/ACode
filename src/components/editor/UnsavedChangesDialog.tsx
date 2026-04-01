import { useEffect, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import "./UnsavedChangesDialog.css";

export function UnsavedChangesDialog() {
  const confirmation = useEditorStore((s) => s.unsavedConfirmation);

  const dismiss = useCallback(() => {
    useEditorStore.getState().setUnsavedConfirmation(null);
  }, []);

  const handleDiscard = useCallback(() => {
    if (!confirmation) return;
    confirmation.onConfirm();
    useEditorStore.getState().setUnsavedConfirmation(null);
  }, [confirmation]);

  const handleSave = useCallback(async () => {
    if (!confirmation) return;
    const state = useEditorStore.getState();
    for (const path of confirmation.dirtyPaths) {
      const file = state.openFiles.find((f) => f.path === path);
      if (file) {
        await invoke("save_file", { path: file.path, content: file.content });
        useEditorStore.getState().markFileSaved(file.path);
      }
    }
    confirmation.onConfirm();
    useEditorStore.getState().setUnsavedConfirmation(null);
  }, [confirmation]);

  useEffect(() => {
    if (!confirmation) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      if (e.key === "Enter") handleSave();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmation, dismiss, handleSave]);

  if (!confirmation) return null;

  const fileNames = confirmation.dirtyPaths.map((p) => p.split(/[\\/]/).pop() ?? p);
  const multiple = fileNames.length > 1;

  return (
    <div className="clone-overlay" onMouseDown={dismiss}>
      <div className="unsaved-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="unsaved-dialog__header">
          <AlertTriangle size={16} />
          <span className="unsaved-dialog__title">Unsaved Changes</span>
        </div>
        <div className="unsaved-dialog__body">
          {multiple ? (
            <>
              <p>The following files have unsaved changes:</p>
              <ul className="unsaved-dialog__file-list">
                {fileNames.map((name, i) => (
                  <li key={confirmation.dirtyPaths[i]}>{name}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              <strong>{fileNames[0]}</strong> has unsaved changes.
            </p>
          )}
          <p>Do you want to save before closing?</p>
        </div>
        <div className="unsaved-dialog__footer">
          <button className="unsaved-dialog__btn unsaved-dialog__btn--cancel" onClick={dismiss}>
            Cancel
          </button>
          <button className="unsaved-dialog__btn unsaved-dialog__btn--discard" onClick={handleDiscard}>
            Discard
          </button>
          <button className="unsaved-dialog__btn unsaved-dialog__btn--save" onClick={handleSave} autoFocus>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
