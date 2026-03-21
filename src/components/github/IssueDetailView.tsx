import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useGitHubStore, type IssueDetail } from "../../store/githubStore";

export function IssueDetailView() {
  const owner = useGitHubStore((s) => s.owner);
  const repo = useGitHubStore((s) => s.repo);
  const issueNumber = useGitHubStore((s) => s.selectedIssueNumber);
  const navigateTo = useGitHubStore((s) => s.navigateTo);

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!owner || !repo || !issueNumber) return;
    setLoading(true);
    invoke<IssueDetail>("github_get_issue", { owner, repo, number: issueNumber })
      .then(setIssue)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [owner, repo, issueNumber]);

  const handlePostComment = async () => {
    if (!owner || !repo || !issueNumber || !commentBody.trim()) return;
    await invoke("github_post_issue_comment", {
      owner,
      repo,
      number: issueNumber,
      body: commentBody.trim(),
    });
    setCommentBody("");
    // Refresh
    const updated = await invoke<IssueDetail>("github_get_issue", {
      owner,
      repo,
      number: issueNumber,
    });
    setIssue(updated);
  };

  if (loading) {
    return <div className="github-loading">Loading issue #{issueNumber}...</div>;
  }

  if (!issue) {
    return <div className="github-panel__empty">Issue not found</div>;
  }

  return (
    <div className="github-pr-detail">
      <div className="github-pr-detail__header">
        <button
          className="github-pr-detail__back"
          onClick={() => navigateTo("issue-list")}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="github-pr-detail__title">
          #{issue.number} {issue.title}
        </span>
        {issue.labels.map((l) => (
          <span key={l} className="github-issue-item__label">{l}</span>
        ))}
      </div>

      <div className="github-pr-detail__content" style={{ flex: 1, overflow: "auto" }}>
        <div className="github-conversation">
          {issue.body && (
            <div className="github-conversation__comment">
              <div className="github-conversation__meta">
                <span className="github-conversation__author">{issue.author}</span>
                <span>{issue.created_at}</span>
              </div>
              <div className="github-conversation__body">{issue.body}</div>
            </div>
          )}
          {issue.comments.map((c) => (
            <div key={c.id} className="github-conversation__comment">
              <div className="github-conversation__meta">
                <span className="github-conversation__author">{c.author}</span>
                <span>{c.created_at}</span>
              </div>
              <div className="github-conversation__body">{c.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="github-comment-form">
        <textarea
          className="github-comment-form__input"
          placeholder="Write a comment..."
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
        </div>
      </div>
    </div>
  );
}
