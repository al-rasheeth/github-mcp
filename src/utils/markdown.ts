import { formatDate, formatNumber, truncate } from "./helpers.js";

export function formatRepo(repo: Record<string, unknown>): string {
  const lines: string[] = [
    `# ${repo.full_name}`,
    "",
  ];

  if (repo.description) lines.push(`> ${repo.description}`, "");

  lines.push("| Property | Value |", "| --- | --- |");
  lines.push(`| **Visibility** | ${repo.private ? "Private" : "Public"} |`);
  lines.push(`| **Default Branch** | \`${repo.default_branch}\` |`);
  lines.push(`| **Language** | ${repo.language ?? "N/A"} |`);
  lines.push(`| **Stars** | ${formatNumber(repo.stargazers_count as number)} |`);
  lines.push(`| **Forks** | ${formatNumber(repo.forks_count as number)} |`);
  lines.push(`| **Open Issues** | ${formatNumber(repo.open_issues_count as number)} |`);
  if (repo.license && (repo.license as Record<string, unknown>).spdx_id) {
    lines.push(`| **License** | ${(repo.license as Record<string, unknown>).spdx_id} |`);
  }
  lines.push(`| **Created** | ${formatDate(repo.created_at as string)} |`);
  lines.push(`| **Updated** | ${formatDate(repo.updated_at as string)} |`);
  lines.push(`| **URL** | ${repo.html_url} |`);

  if (Array.isArray(repo.topics) && repo.topics.length > 0) {
    lines.push("", `**Topics:** ${(repo.topics as string[]).map((t) => `\`${t}\``).join(", ")}`);
  }

  return lines.join("\n");
}

export function formatRepoList(repos: Record<string, unknown>[]): string {
  if (repos.length === 0) return "No repositories found.";
  const lines = ["| Repository | Stars | Language | Updated |", "| --- | --- | --- | --- |"];
  for (const r of repos) {
    lines.push(
      `| [${r.full_name}](${r.html_url}) | ${formatNumber(r.stargazers_count as number)} | ${r.language ?? "-"} | ${formatDate(r.updated_at as string)} |`
    );
  }
  return lines.join("\n");
}

export function formatIssue(issue: Record<string, unknown>): string {
  const labels = Array.isArray(issue.labels)
    ? (issue.labels as Array<Record<string, unknown>>).map((l) => `\`${l.name}\``).join(", ")
    : "";
  const assignees = Array.isArray(issue.assignees)
    ? (issue.assignees as Array<Record<string, unknown>>).map((a) => `@${a.login}`).join(", ")
    : "";

  const lines = [
    `# #${issue.number} ${issue.title}`,
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| **State** | ${issue.state} |`,
    `| **Author** | @${(issue.user as Record<string, unknown>)?.login ?? "unknown"} |`,
  ];
  if (labels) lines.push(`| **Labels** | ${labels} |`);
  if (assignees) lines.push(`| **Assignees** | ${assignees} |`);
  if (issue.milestone) {
    lines.push(`| **Milestone** | ${(issue.milestone as Record<string, unknown>).title} |`);
  }
  lines.push(`| **Created** | ${formatDate(issue.created_at as string)} |`);
  lines.push(`| **Updated** | ${formatDate(issue.updated_at as string)} |`);
  lines.push(`| **URL** | ${issue.html_url} |`);

  if (issue.body) {
    lines.push("", "---", "", issue.body as string);
  }

  return lines.join("\n");
}

export function formatIssueList(issues: Record<string, unknown>[]): string {
  if (issues.length === 0) return "No issues found.";
  const lines = ["| # | Title | State | Labels | Updated |", "| --- | --- | --- | --- | --- |"];
  for (const i of issues) {
    const labels = Array.isArray(i.labels)
      ? (i.labels as Array<Record<string, unknown>>).map((l) => `\`${l.name}\``).join(" ")
      : "";
    lines.push(
      `| #${i.number} | ${truncate(i.title as string, 60)} | ${i.state} | ${labels} | ${formatDate(i.updated_at as string)} |`
    );
  }
  return lines.join("\n");
}

export function formatPR(pr: Record<string, unknown>): string {
  const lines = [
    `# PR #${pr.number}: ${pr.title}`,
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| **State** | ${pr.state}${pr.merged ? " (merged)" : pr.draft ? " (draft)" : ""} |`,
    `| **Author** | @${(pr.user as Record<string, unknown>)?.login ?? "unknown"} |`,
    `| **Branch** | \`${pr.head && (pr.head as Record<string, unknown>).ref}\` → \`${pr.base && (pr.base as Record<string, unknown>).ref}\` |`,
  ];

  if (pr.mergeable !== null && pr.mergeable !== undefined) {
    lines.push(`| **Mergeable** | ${pr.mergeable ? "Yes" : "No"} |`);
  }
  lines.push(`| **Additions** | +${pr.additions ?? 0} |`);
  lines.push(`| **Deletions** | -${pr.deletions ?? 0} |`);
  lines.push(`| **Changed Files** | ${pr.changed_files ?? 0} |`);
  lines.push(`| **Created** | ${formatDate(pr.created_at as string)} |`);
  lines.push(`| **Updated** | ${formatDate(pr.updated_at as string)} |`);
  lines.push(`| **URL** | ${pr.html_url} |`);

  if (pr.body) {
    lines.push("", "---", "", pr.body as string);
  }

  return lines.join("\n");
}

export function formatPRList(prs: Record<string, unknown>[]): string {
  if (prs.length === 0) return "No pull requests found.";
  const lines = ["| # | Title | State | Author | Updated |", "| --- | --- | --- | --- | --- |"];
  for (const p of prs) {
    const state = p.draft ? "draft" : (p.state as string);
    lines.push(
      `| #${p.number} | ${truncate(p.title as string, 60)} | ${state} | @${(p.user as Record<string, unknown>)?.login ?? "?"} | ${formatDate(p.updated_at as string)} |`
    );
  }
  return lines.join("\n");
}

export function formatCommit(commit: Record<string, unknown>): string {
  const c = commit.commit as Record<string, unknown> | undefined;
  const author = c?.author as Record<string, unknown> | undefined;
  const stats = commit.stats as Record<string, unknown> | undefined;
  const sha = (commit.sha as string)?.slice(0, 7) ?? "";

  const lines = [
    `# Commit \`${sha}\``,
    "",
    `**Message:** ${c?.message ?? ""}`,
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| **Author** | ${author?.name ?? "unknown"} <${author?.email ?? ""}> |`,
    `| **Date** | ${formatDate(author?.date as string)} |`,
  ];

  if (stats) {
    lines.push(`| **Additions** | +${stats.additions} |`);
    lines.push(`| **Deletions** | -${stats.deletions} |`);
    lines.push(`| **Total** | ${stats.total} files |`);
  }

  lines.push(`| **URL** | ${commit.html_url} |`);

  if (Array.isArray(commit.files)) {
    lines.push("", "## Changed Files", "");
    lines.push("| File | Changes | Status |", "| --- | --- | --- |");
    for (const f of commit.files as Array<Record<string, unknown>>) {
      lines.push(`| \`${f.filename}\` | +${f.additions}/-${f.deletions} | ${f.status} |`);
    }
  }

  return lines.join("\n");
}

export function formatCommitList(commits: Record<string, unknown>[]): string {
  if (commits.length === 0) return "No commits found.";
  const lines = ["| SHA | Message | Author | Date |", "| --- | --- | --- | --- |"];
  for (const c of commits) {
    const inner = c.commit as Record<string, unknown> | undefined;
    const author = inner?.author as Record<string, unknown> | undefined;
    lines.push(
      `| \`${(c.sha as string)?.slice(0, 7)}\` | ${truncate((inner?.message as string)?.split("\n")[0] ?? "", 60)} | ${author?.name ?? "?"} | ${formatDate(author?.date as string)} |`
    );
  }
  return lines.join("\n");
}

export function formatRelease(release: Record<string, unknown>): string {
  const lines = [
    `# ${release.name || release.tag_name}`,
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| **Tag** | \`${release.tag_name}\` |`,
    `| **Prerelease** | ${release.prerelease ? "Yes" : "No"} |`,
    `| **Draft** | ${release.draft ? "Yes" : "No"} |`,
    `| **Author** | @${(release.author as Record<string, unknown>)?.login ?? "unknown"} |`,
    `| **Published** | ${formatDate(release.published_at as string)} |`,
    `| **URL** | ${release.html_url} |`,
  ];

  if (release.body) {
    lines.push("", "---", "", release.body as string);
  }

  const assets = release.assets as Array<Record<string, unknown>> | undefined;
  if (assets?.length) {
    lines.push("", "## Assets", "");
    lines.push("| Name | Size | Downloads |", "| --- | --- | --- |");
    for (const a of assets) {
      const sizeKb = Math.round((a.size as number) / 1024);
      lines.push(`| [${a.name}](${a.browser_download_url}) | ${sizeKb} KB | ${a.download_count} |`);
    }
  }

  return lines.join("\n");
}

export function formatBranch(branch: Record<string, unknown>): string {
  const commit = branch.commit as Record<string, unknown> | undefined;
  const lines = [
    `# Branch: \`${branch.name}\``,
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| **SHA** | \`${(commit?.sha as string)?.slice(0, 7) ?? ""}\` |`,
    `| **Protected** | ${branch.protected ? "Yes" : "No"} |`,
  ];
  return lines.join("\n");
}

export function formatBranchList(branches: Record<string, unknown>[]): string {
  if (branches.length === 0) return "No branches found.";
  const lines = ["| Branch | SHA | Protected |", "| --- | --- | --- |"];
  for (const b of branches) {
    const commit = b.commit as Record<string, unknown> | undefined;
    lines.push(
      `| \`${b.name}\` | \`${(commit?.sha as string)?.slice(0, 7) ?? ""}\` | ${b.protected ? "Yes" : "No"} |`
    );
  }
  return lines.join("\n");
}

export function formatComment(comment: Record<string, unknown>): string {
  return [
    `**@${(comment.user as Record<string, unknown>)?.login ?? "unknown"}** commented on ${formatDate(comment.created_at as string)}`,
    "",
    comment.body as string,
  ].join("\n");
}

export function formatCommentList(comments: Record<string, unknown>[]): string {
  if (comments.length === 0) return "No comments found.";
  return comments.map(formatComment).join("\n\n---\n\n");
}

export function formatUser(user: Record<string, unknown>): string {
  const lines = [
    `# ${user.name || user.login}`,
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| **Username** | @${user.login} |`,
    `| **Type** | ${user.type} |`,
  ];
  if (user.company) lines.push(`| **Company** | ${user.company} |`);
  if (user.location) lines.push(`| **Location** | ${user.location} |`);
  if (user.bio) lines.push(`| **Bio** | ${user.bio} |`);
  lines.push(`| **Public Repos** | ${user.public_repos} |`);
  lines.push(`| **Followers** | ${user.followers} |`);
  lines.push(`| **Following** | ${user.following} |`);
  lines.push(`| **Created** | ${formatDate(user.created_at as string)} |`);
  lines.push(`| **URL** | ${user.html_url} |`);
  return lines.join("\n");
}

export function formatWorkflowRun(run: Record<string, unknown>): string {
  const lines = [
    `# Workflow Run #${run.run_number}`,
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| **Workflow** | ${run.name} |`,
    `| **Status** | ${run.status} |`,
    `| **Conclusion** | ${run.conclusion ?? "pending"} |`,
    `| **Branch** | \`${run.head_branch}\` |`,
    `| **Event** | ${run.event} |`,
    `| **SHA** | \`${(run.head_sha as string)?.slice(0, 7)}\` |`,
    `| **Started** | ${formatDate(run.run_started_at as string)} |`,
    `| **Updated** | ${formatDate(run.updated_at as string)} |`,
    `| **URL** | ${run.html_url} |`,
  ];
  return lines.join("\n");
}

export function formatSearchResults(
  items: Record<string, unknown>[],
  type: "issues" | "repos" | "code" | "commits" | "users",
  totalCount: number
): string {
  const lines = [`**${totalCount} results found**`, ""];
  switch (type) {
    case "issues":
      return lines.join("\n") + "\n" + formatIssueList(items);
    case "repos":
      return lines.join("\n") + "\n" + formatRepoList(items);
    case "code": {
      if (items.length === 0) return "No code results found.";
      const codeLines = ["| File | Repository | Score |", "| --- | --- | --- |"];
      for (const item of items) {
        const repo = item.repository as Record<string, unknown> | undefined;
        codeLines.push(
          `| \`${item.path}\` | ${repo?.full_name ?? ""} | ${item.score ?? ""} |`
        );
      }
      return lines.join("\n") + "\n" + codeLines.join("\n");
    }
    case "commits":
      return lines.join("\n") + "\n" + formatCommitList(items);
    case "users": {
      if (items.length === 0) return "No users found.";
      const userLines = ["| User | Type | URL |", "| --- | --- | --- |"];
      for (const u of items) {
        userLines.push(`| @${u.login} | ${u.type} | ${u.html_url} |`);
      }
      return lines.join("\n") + "\n" + userLines.join("\n");
    }
  }
}

export function formatGist(gist: Record<string, unknown>): string {
  const files = gist.files as Record<string, Record<string, unknown>> | undefined;
  const lines = [
    `# Gist: ${gist.description || gist.id}`,
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| **ID** | ${gist.id} |`,
    `| **Public** | ${gist.public ? "Yes" : "No"} |`,
    `| **Owner** | @${(gist.owner as Record<string, unknown>)?.login ?? "unknown"} |`,
    `| **Created** | ${formatDate(gist.created_at as string)} |`,
    `| **Updated** | ${formatDate(gist.updated_at as string)} |`,
    `| **URL** | ${gist.html_url} |`,
  ];

  if (files) {
    lines.push("", "## Files", "");
    for (const [name, file] of Object.entries(files)) {
      lines.push(`### ${name}`, "");
      if (file.content) {
        const lang = file.language ? (file.language as string).toLowerCase() : "";
        lines.push(`\`\`\`${lang}`, file.content as string, "```", "");
      }
    }
  }

  return lines.join("\n");
}

export function formatGistList(gists: Record<string, unknown>[]): string {
  if (gists.length === 0) return "No gists found.";
  const lines = ["| ID | Description | Files | Updated |", "| --- | --- | --- | --- |"];
  for (const g of gists) {
    const files = g.files as Record<string, unknown> | undefined;
    const fileCount = files ? Object.keys(files).length : 0;
    lines.push(
      `| ${(g.id as string)?.slice(0, 8)} | ${truncate((g.description as string) || "(no description)", 50)} | ${fileCount} | ${formatDate(g.updated_at as string)} |`
    );
  }
  return lines.join("\n");
}

export function formatMilestoneList(milestones: Record<string, unknown>[]): string {
  if (milestones.length === 0) return "No milestones found.";
  const lines = ["| # | Title | State | Open | Closed | Due |", "| --- | --- | --- | --- | --- | --- |"];
  for (const m of milestones) {
    lines.push(
      `| #${m.number} | ${m.title} | ${m.state} | ${m.open_issues} | ${m.closed_issues} | ${formatDate(m.due_on as string)} |`
    );
  }
  return lines.join("\n");
}

export function formatTree(tree: Array<Record<string, unknown>>): string {
  if (tree.length === 0) return "Empty tree.";
  const lines = ["| Path | Type | Size |", "| --- | --- | --- |"];
  for (const item of tree) {
    const size = item.size ? `${Math.round((item.size as number) / 1024)} KB` : "-";
    lines.push(`| \`${item.path}\` | ${item.type} | ${size} |`);
  }
  return lines.join("\n");
}

export function formatNotification(n: Record<string, unknown>): string {
  const subject = n.subject as Record<string, unknown>;
  const repo = n.repository as Record<string, unknown>;
  return `- **[${repo?.full_name}]** ${subject?.type}: ${subject?.title} (${n.reason}${n.unread ? ", unread" : ""})`;
}

export function formatNotificationList(notifications: Record<string, unknown>[]): string {
  if (notifications.length === 0) return "No notifications.";
  return notifications.map(formatNotification).join("\n");
}
