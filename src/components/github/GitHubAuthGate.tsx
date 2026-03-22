import { useState, useEffect } from "react";
import { Github } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useGitHubStore } from "../../store/githubStore";
import { useGitStore } from "../../store/gitStore";
import { useEditorStore } from "../../store/editorStore";

export function GitHubAuthGate() {
  const setAuthenticated = useGitHubStore((s) => s.setAuthenticated);
  const setRepoContext = useGitHubStore((s) => s.setRepoContext);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const fetchRemoteInfo = useGitStore((s) => s.fetchRemoteInfo);

  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [token, setToken] = useState("");
  const [autoChecked, setAutoChecked] = useState(false);

  const handleCheckGhAuth = async () => {
    setChecking(true);
    setError("");
    try {
      const authStatus = await invoke<{ authenticated: boolean; user: string }>(
        "github_check_auth"
      );
      if (authStatus.authenticated) {
        setAuthenticated(true, authStatus.user);
        // Also fetch remote info if we have a workspace
        if (workspaceRoot) {
          await fetchRemoteInfo(workspaceRoot);
          const info = useGitStore.getState().remoteInfo;
          if (info?.owner && info?.repo) {
            setRepoContext(info.owner, info.repo);
          }
        }
      } else {
        setError("GitHub CLI is not authenticated. Run 'gh auth login' or enter a token below.");
        setShowTokenForm(true);
      }
    } catch (e) {
      setError("GitHub CLI not found. Install 'gh' and run 'gh auth login', or enter a token below.");
      setShowTokenForm(true);
    } finally {
      setChecking(false);
    }
  };

  const handleTokenSubmit = async () => {
    if (!token.trim()) return;
    setChecking(true);
    setError("");
    try {
      await invoke("github_set_token", { token: token.trim() });
      setAuthenticated(true);
      if (workspaceRoot) {
        await fetchRemoteInfo(workspaceRoot);
        const info = useGitStore.getState().remoteInfo;
        if (info?.owner && info?.repo) {
          setRepoContext(info.owner, info.repo);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };

  // Auto-check gh CLI auth on first render
  useEffect(() => {
    if (!autoChecked) {
      setAutoChecked(true);
      handleCheckGhAuth();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="github-auth-gate">
      <Github size={32} />
      <span className="github-auth-gate__title">Connect to GitHub</span>
      <p className="github-auth-gate__desc">
        Sign in with the GitHub CLI to view and manage pull requests and issues.
      </p>
      <button
        className="github-auth-gate__btn"
        onClick={handleCheckGhAuth}
        disabled={checking}
      >
        <Github size={14} />
        {checking ? "Checking..." : "Connect with gh CLI"}
      </button>

      {showTokenForm && (
        <div className="github-auth-gate__token-form">
          <p className="github-auth-gate__desc">Or enter a Personal Access Token:</p>
          <input
            className="github-auth-gate__input"
            type="password"
            placeholder="ghp_..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTokenSubmit()}
          />
          <button
            className="github-auth-gate__btn"
            onClick={handleTokenSubmit}
            disabled={checking || !token.trim()}
          >
            {checking ? "Authenticating..." : "Authenticate"}
          </button>
        </div>
      )}

      {error && <p className="github-auth-gate__error">{error}</p>}
    </div>
  );
}
