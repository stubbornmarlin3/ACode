import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useGitHubStore, type PrDetail, type PrFile, type PrComment } from "../../store/githubStore";

export function PrDetailView() {
  const owner = useGitHubStore((s) => s.owner);
  const repo = useGitHubStore((s) => s.repo);
  const prNumber = useGitHubStore((s) => s.selectedPrNumber);
  const navigateTo = useGitHubStore((s) => s.navigateTo);

  const [pr, setPr] = useState<PrDetail | null>(null);
  const [files, setFiles] = useState<PrFile[]>([]);
  const [comments, setComments] = useState<PrComment[]>([]);
  const [diff, setDiff] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [showMergeMenu, setShowMergeMenu] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!owner || !repo || !prNumber) return;
    setLoading(true);

    Promise.all([
      invoke<PrDetail>("github_get_pr", { owner, repo, number: prNumber }),
      invoke<PrFile[]>("github_pr_files", { owner, repo, number: prNumber }),
      invoke<PrComment[]>("github_pr_comments", { owner, repo, number: prNumber }),
    ])
      .then(([prData, filesData, commentsData]) => {
        setPr(prData);
        setFiles(filesData);
        setComments(commentsData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [owner, repo, prNumber]);

  const handleSelectFile = async (filename: string) => {
    setSelectedFile(filename);
    if (!owner || !repo || !prNumber) return;
    try {
      const d = await invoke<string>("github_pr_diff", {
        owner,
        repo,
        number: prNumber,
        path: filename,
      });
      setDiff(d);
    } catch {
      setDiff("Failed to load diff");
    }
  };

  const handlePostComment = async () => {
    if (!owner || !repo || !prNumber || !commentBody.trim()) return;
    await invoke("github_post_comment", {
      owner,
      repo,
      number: prNumber,
      body: commentBody.trim(),
    });
    setCommentBody("");
    // Refresh comments
    const updated = await invoke<PrComment[]>("github_pr_comments", {
      owner,
      repo,
      number: prNumber,
    });
    setComments(updated);
  };

  const handleReview = async (event: string) => {
    if (!owner || !repo || !prNumber) return;
    await invoke("github_post_review", {
      owner,
      repo,
      number: prNumber,
      body: commentBody.trim(),
      event,
    });
    setCommentBody("");
  };

  const handleMerge = async (method: string) => {
    if (!owner || !repo || !prNumber) return;
    setShowMergeMenu(false);
    await invoke("github_merge_pr", { owner, repo, number: prNumber, method });
    navigateTo("pr-list");
  };

  if (loading) {
    return <div className="github-loading">Loading PR #{prNumber}...</div>;
  }

  if (!pr) {
    return <div className="github-panel__empty">PR not found</div>;
  }

  return (
    <div className="github-pr-detail">
      <div className="github-pr-detail__header">
        <button
          className="github-pr-detail__back"
          onClick={() => navigateTo("pr-list")}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="github-pr-detail__title">
          #{pr.number} {pr.title}
        </span>
        <div className="github-merge-controls">
          <div className="github-merge-controls__dropdown">
            <button
              className="github-merge-controls__btn"
              onClick={() => setShowMergeMenu(!showMergeMenu)}
            >
              Merge <ChevronDown size={10} />
            </button>
            {showMergeMenu && (
              <div className="github-merge-controls__menu">
                <button
                  className="github-merge-controls__option"
                  onClick={() => handleMerge("merge")}
                >
                  Create merge commit
                </button>
                <button
                  className="github-merge-controls__option"
                  onClick={() => handleMerge("squash")}
                >
                  Squash and merge
                </button>
                <button
                  className="github-merge-controls__option"
                  onClick={() => handleMerge("rebase")}
                >
                  Rebase and merge
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="github-pr-detail__body">
        <div className="github-pr-detail__files">
          {files.map((f) => (
            <div
              key={f.filename}
              className={`github-pr-item${selectedFile === f.filename ? " github-pr-item--selected" : ""}`}
              onClick={() => handleSelectFile(f.filename)}
              style={{ padding: "6px 8px" }}
            >
              <span className="github-pr-item__title" style={{ fontSize: "11px" }}>
                {f.filename.split("/").pop()}
              </span>
              <span style={{ fontSize: "10px", color: "var(--accent-green)" }}>
                +{f.additions}
              </span>
              <span style={{ fontSize: "10px", color: "var(--accent-red)" }}>
                -{f.deletions}
              </span>
            </div>
          ))}
        </div>

        <div className="github-pr-detail__content">
          {selectedFile ? (
            <pre style={{ fontSize: "12px", fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>
              {diff}
            </pre>
          ) : (
            <div className="github-conversation">
              {pr.body && (
                <div className="github-conversation__comment">
                  <div className="github-conversation__meta">
                    <span className="github-conversation__author">{pr.author}</span>
                    <span>{pr.created_at}</span>
                  </div>
                  <div className="github-conversation__body">{pr.body}</div>
                </div>
              )}
              {comments.map((c) => (
                <div key={c.id} className="github-conversation__comment">
                  <div className="github-conversation__meta">
                    <span className="github-conversation__author">{c.author}</span>
                    <span>{c.created_at}</span>
                  </div>
                  <div className="github-conversation__body">{c.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="github-comment-form">
        <textarea
          className="github-comment-form__input"
          placeholder="Write a comment or review..."
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
        />
        <div className="github-comment-form__actions">
          <button
            className="github-comment-form__btn github-comment-form__btn--primary"
            onClick={handlePostComment}
            disabled={!commentBody.trim()}
          >
            Comment
          </button>
          <button
            className="github-comment-form__btn github-comment-form__btn--approve"
            onClick={() => handleReview("APPROVE")}
          >
            Approve
          </button>
          <button
            className="github-comment-form__btn github-comment-form__btn--reject"
            onClick={() => handleReview("REQUEST_CHANGES")}
          >
            Request Changes
          </button>
        </div>
      </div>
    </div>
  );
}
