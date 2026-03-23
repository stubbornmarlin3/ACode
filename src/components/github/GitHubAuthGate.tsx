import { useState, useEffect, useRef } from "react";
import { Github, Copy, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useGitHubStore } from "../../store/githubStore";
import { useGitStore } from "../../store/gitStore";
import { useEditorStore } from "../../store/editorStore";

interface DeviceFlowResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

interface DevicePollResult {
  status: string;
  user: string | null;
  error: string | null;
}

export function GitHubAuthGate() {
  const setAuthenticated = useGitHubStore((s) => s.setAuthenticated);
  const setRepoContext = useGitHubStore((s) => s.setRepoContext);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const fetchRemoteInfo = useGitStore((s) => s.fetchRemoteInfo);

  const [phase, setPhase] = useState<"idle" | "polling" | "error">("idle");
  const [error, setError] = useState("");
  const [userCode, setUserCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [autoChecked, setAutoChecked] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const completeAuth = async (user?: string) => {
    setAuthenticated(true, user);
    if (workspaceRoot) {
      await fetchRemoteInfo(workspaceRoot);
      const info = useGitStore.getState().remoteInfo;
      if (info?.owner && info?.repo) {
        setRepoContext(info.owner, info.repo);
      }
    }
  };

  // Auto-check for existing stored token on mount
  useEffect(() => {
    if (autoChecked) return;
    setAutoChecked(true);
    invoke<{ authenticated: boolean; user: string }>("github_check_auth").then(
      (status) => {
        if (status.authenticated) completeAuth(status.user);
      }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleConnect = async () => {
    setError("");
    setPhase("polling");
    setCopied(false);

    try {
      const flow = await invoke<DeviceFlowResponse>("github_start_device_flow");
      setUserCode(flow.user_code);

      // Copy code to clipboard and open browser
      await navigator.clipboard.writeText(flow.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      await openUrl(flow.verification_uri);

      // Poll for authorization
      const interval = (flow.interval + 1) * 1000; // add 1s buffer
      pollRef.current = setInterval(async () => {
        try {
          const result = await invoke<DevicePollResult>(
            "github_poll_device_flow",
            { deviceCode: flow.device_code }
          );

          if (result.status === "success") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            await completeAuth(result.user ?? undefined);
          } else if (result.status === "expired" || result.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setPhase("error");
            setError(result.error ?? "Authorization failed.");
          }
          // "pending" and "slow_down" — keep polling
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPhase("error");
          setError("Failed to check authorization status.");
        }
      }, interval);
    } catch (e) {
      setPhase("error");
      setError(String(e));
    }
  };

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTokenSubmit = async () => {
    if (!token.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await invoke("github_set_token", { token: token.trim() });
      await completeAuth();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Device flow polling phase
  if (phase === "polling") {
    return (
      <div className="github-auth-gate">
        <Github size={32} />
        <span className="github-auth-gate__title">Enter code on GitHub</span>
        <p className="github-auth-gate__desc">
          A browser window has opened. Enter this code to connect your account:
        </p>
        <div className="github-auth-gate__code-box">
          <span className="github-auth-gate__code">{userCode}</span>
          <button
            className="github-auth-gate__copy-btn"
            onClick={handleCopyCode}
            title="Copy code"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <p className="github-auth-gate__desc github-auth-gate__waiting">
          Waiting for authorization...
        </p>
      </div>
    );
  }

  // Default / error state
  return (
    <div className="github-auth-gate">
      <Github size={32} />
      <span className="github-auth-gate__title">Connect to GitHub</span>
      <p className="github-auth-gate__desc">
        Sign in to view and manage pull requests and issues.
      </p>
      <button
        className="github-auth-gate__btn"
        onClick={handleConnect}
      >
        <Github size={14} />
        Connect to GitHub
      </button>

      <button
        className="github-auth-gate__link"
        onClick={() => setShowTokenForm(!showTokenForm)}
      >
        Or enter a token manually
      </button>

      {showTokenForm && (
        <div className="github-auth-gate__token-form">
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
            disabled={submitting || !token.trim()}
          >
            {submitting ? "Authenticating..." : "Authenticate"}
          </button>
        </div>
      )}

      {error && <p className="github-auth-gate__error">{error}</p>}
    </div>
  );
}
