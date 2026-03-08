import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubClient } from "./github/client.js";
import type { Config } from "./config.js";
import { withDefaults, decodeBase64 } from "./utils/helpers.js";

export function registerPrompts(server: McpServer, client: GitHubClient, config: Config): void {

  server.prompt(
    "pr-review",
    "Perform a thorough code review of a pull request with inline suggestions",
    {
      owner: z.string().optional().describe("Repository owner"),
      repo: z.string().optional().describe("Repository name"),
      pr_number: z.string().describe("Pull request number"),
    },
    async (params) => {
      const { owner, repo } = withDefaults({ owner: params.owner, repo: params.repo }, config);
      const prNum = parseInt(params.pr_number, 10);

      const [prResp, filesResp, diffResp, reviewsResp] = await Promise.all([
        client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/pulls/${prNum}`),
        client.paginate<Record<string, unknown>>(`/repos/${owner}/${repo}/pulls/${prNum}/files?per_page=100`, undefined, 5),
        client.getRaw(`/repos/${owner}/${repo}/pulls/${prNum}`, { headers: { Accept: "application/vnd.github.v3.diff" } }),
        client.paginate<Record<string, unknown>>(`/repos/${owner}/${repo}/pulls/${prNum}/reviews`, undefined, 3),
      ]);

      const pr = prResp.data;
      const diff = await diffResp.text();
      const fileList = filesResp.map((f) => `- \`${f.filename}\` (${f.status}, +${f.additions}/-${f.deletions})`).join("\n");
      const existingReviews = reviewsResp.map((r) =>
        `- @${(r.user as Record<string, unknown>)?.login}: ${r.state}${r.body ? ` — "${r.body}"` : ""}`
      ).join("\n") || "None yet";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `# Code Review: PR #${prNum} — ${pr.title}`,
                "",
                `**Author:** @${(pr.user as Record<string, unknown>)?.login}`,
                `**Branch:** \`${(pr.head as Record<string, unknown>)?.ref}\` → \`${(pr.base as Record<string, unknown>)?.ref}\``,
                `**Description:**\n${pr.body || "No description provided."}`,
                "",
                `## Changed Files`,
                fileList,
                "",
                `## Existing Reviews`,
                existingReviews,
                "",
                `## Full Diff`,
                "```diff",
                diff,
                "```",
                "",
                "---",
                "",
                "Please review this pull request thoroughly. For each issue found:",
                "1. Identify the file and line number",
                "2. Explain the problem",
                "3. Suggest a specific fix",
                "",
                "Focus on: correctness, security, performance, maintainability, and adherence to project conventions.",
                "If the PR looks good, say so and highlight any particularly well-done aspects.",
              ].join("\n"),
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "repo-health",
    "Assess the health and status of a repository",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);

      const [repoResp, issuesResp, prsResp, commitsResp] = await Promise.all([
        client.get<Record<string, unknown>>(`/repos/${owner}/${repo}`),
        client.get<Array<Record<string, unknown>>>(`/repos/${owner}/${repo}/issues?state=open&per_page=5`),
        client.get<Array<Record<string, unknown>>>(`/repos/${owner}/${repo}/pulls?state=open&per_page=5`),
        client.get<Array<Record<string, unknown>>>(`/repos/${owner}/${repo}/commits?per_page=10`),
      ]);

      const r = repoResp.data;
      const recentCommits = commitsResp.data.map((c) => {
        const inner = c.commit as Record<string, unknown>;
        const author = inner?.author as Record<string, unknown>;
        return `- \`${(c.sha as string)?.slice(0, 7)}\` ${(inner?.message as string)?.split("\n")[0]} (${author?.name})`;
      }).join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `# Repository Health Check: ${owner}/${repo}`,
                "",
                `**Description:** ${r.description || "N/A"}`,
                `**Stars:** ${r.stargazers_count} | **Forks:** ${r.forks_count} | **Open Issues:** ${r.open_issues_count}`,
                `**Default Branch:** \`${r.default_branch}\``,
                `**Last Push:** ${r.pushed_at}`,
                `**Language:** ${r.language || "N/A"}`,
                "",
                `## Recent Commits`,
                recentCommits,
                "",
                `## Open Issues (sample)`,
                issuesResp.data.map((i) => `- #${i.number}: ${i.title}`).join("\n") || "None",
                "",
                `## Open PRs (sample)`,
                prsResp.data.map((p) => `- #${p.number}: ${p.title}`).join("\n") || "None",
                "",
                "---",
                "",
                "Please assess the health of this repository. Consider:",
                "- Activity level and momentum",
                "- Issue/PR management (are things getting addressed?)",
                "- Code maintenance signals",
                "- Recommendations for improvement",
              ].join("\n"),
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "release-notes",
    "Generate formatted release notes from commits/PRs between two refs",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      base: z.string().describe("Base tag/ref"),
      head: z.string().optional().describe("Head tag/ref (defaults to HEAD)"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const head = params.head || "HEAD";

      const compareResp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/compare/${params.base}...${head}`);
      const data = compareResp.data;
      const commits = (data.commits as Array<Record<string, unknown>>)?.map((c) => {
        const inner = c.commit as Record<string, unknown>;
        return `- ${(inner?.message as string)?.split("\n")[0]} (\`${(c.sha as string)?.slice(0, 7)}\`)`;
      }).join("\n") || "No commits found";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `# Generate Release Notes: ${params.base} → ${head}`,
                "",
                `**Repository:** ${owner}/${repo}`,
                `**Total commits:** ${data.total_commits}`,
                `**Ahead by:** ${data.ahead_by} | **Behind by:** ${data.behind_by}`,
                "",
                `## Commits`,
                commits,
                "",
                "---",
                "",
                "Please generate well-formatted release notes from these commits. Group them into:",
                "- **Features** (new functionality)",
                "- **Bug Fixes**",
                "- **Improvements** (refactors, performance)",
                "- **Breaking Changes** (if any)",
                "- **Other**",
                "",
                "Write in a user-friendly style suitable for a CHANGELOG or GitHub release.",
              ].join("\n"),
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "issue-analysis",
    "Analyze an issue with comments and linked PRs for root cause or implementation plan",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      issue_number: z.string().describe("Issue number"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const num = parseInt(params.issue_number, 10);

      const [issueResp, commentsResp] = await Promise.all([
        client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/issues/${num}`),
        client.paginate<Record<string, unknown>>(`/repos/${owner}/${repo}/issues/${num}/comments?per_page=100`, undefined, 5),
      ]);

      const issue = issueResp.data;
      const labels = Array.isArray(issue.labels)
        ? (issue.labels as Array<Record<string, unknown>>).map((l) => l.name).join(", ")
        : "";
      const comments = commentsResp.map((c) =>
        `**@${(c.user as Record<string, unknown>)?.login}:**\n${c.body}\n`
      ).join("\n---\n\n") || "No comments";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `# Issue Analysis: #${num} — ${issue.title}`,
                "",
                `**State:** ${issue.state} | **Labels:** ${labels || "none"}`,
                `**Author:** @${(issue.user as Record<string, unknown>)?.login}`,
                `**Created:** ${issue.created_at}`,
                "",
                `## Description`,
                issue.body || "No description",
                "",
                `## Discussion (${commentsResp.length} comments)`,
                comments,
                "",
                "---",
                "",
                "Please analyze this issue and provide:",
                "1. **Root Cause Analysis** — What's the underlying problem?",
                "2. **Implementation Plan** — Step-by-step approach to resolve it",
                "3. **Risks & Considerations** — Edge cases, backward compatibility, testing needs",
                "4. **Estimated Complexity** — Simple / Medium / Complex",
              ].join("\n"),
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "action-failure-diagnosis",
    "Diagnose a failed GitHub Actions workflow run",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.string().describe("Workflow run ID"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const runId = parseInt(params.run_id, 10);

      const [runResp, jobsResp] = await Promise.all([
        client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/actions/runs/${runId}`),
        client.get<{ total_count: number; jobs: Array<Record<string, unknown>> }>(
          `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?filter=latest`
        ),
      ]);

      const run = runResp.data;
      const failedJobs = jobsResp.data.jobs.filter((j) => j.conclusion === "failure");
      const jobDetails = failedJobs.map((job) => {
        const steps = (job.steps as Array<Record<string, unknown>> | undefined) ?? [];
        const failedSteps = steps.filter((s) => s.conclusion === "failure");
        return [
          `### ${job.name} (${job.conclusion})`,
          "",
          failedSteps.map((s) => `- Step ${s.number}: **${s.name}** — FAILED`).join("\n") || "No specific step failures identified",
          "",
        ].join("\n");
      }).join("\n") || "No failed jobs identified.";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `# Workflow Failure Diagnosis`,
                "",
                `**Workflow:** ${run.name}`,
                `**Run #:** ${run.run_number} (ID: ${runId})`,
                `**Status:** ${run.status} | **Conclusion:** ${run.conclusion}`,
                `**Branch:** \`${run.head_branch}\` | **Event:** ${run.event}`,
                `**Commit:** \`${(run.head_sha as string)?.slice(0, 7)}\``,
                "",
                `## Failed Jobs`,
                jobDetails,
                "",
                "---",
                "",
                "Please diagnose this workflow failure:",
                "1. Identify the root cause from the failed steps",
                "2. Suggest specific fixes",
                "3. Indicate if this is a flaky test, config issue, code bug, or environment problem",
              ].join("\n"),
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "dependency-review",
    "Review dependency changes in a pull request for security and compatibility",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pr_number: z.string().describe("Pull request number"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const prNum = parseInt(params.pr_number, 10);

      const files = await client.paginate<Record<string, unknown>>(
        `/repos/${owner}/${repo}/pulls/${prNum}/files?per_page=100`, undefined, 5
      );

      const depPatterns = [
        "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
        "requirements.txt", "Pipfile", "Pipfile.lock", "pyproject.toml", "poetry.lock",
        "Cargo.toml", "Cargo.lock",
        "go.mod", "go.sum",
        "Gemfile", "Gemfile.lock",
        "build.gradle", "pom.xml",
      ];

      const depFiles = files.filter((f) => {
        const name = f.filename as string;
        return depPatterns.some((p) => name.endsWith(p));
      });

      const depContents = depFiles.map((f) => {
        return [
          `### \`${f.filename}\` (${f.status})`,
          "",
          f.patch ? `\`\`\`diff\n${f.patch}\n\`\`\`` : "(no diff available)",
          "",
        ].join("\n");
      }).join("\n") || "No dependency files changed.";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `# Dependency Review: PR #${prNum}`,
                "",
                `**Repository:** ${owner}/${repo}`,
                `**Dependency files changed:** ${depFiles.length}`,
                "",
                depContents,
                "",
                "---",
                "",
                "Please review these dependency changes:",
                "1. **New dependencies** — Are they well-maintained? Any known vulnerabilities?",
                "2. **Version changes** — Are there breaking changes in major bumps?",
                "3. **Removed dependencies** — Is removal safe? Anything still importing them?",
                "4. **Lock file consistency** — Do lock file changes match manifest changes?",
                "5. **Security concerns** — Any dependencies with known CVEs?",
              ].join("\n"),
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "codebase-overview",
    "Generate an architectural overview of a repository for onboarding",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);

      const [repoResp, languagesResp, commitsResp] = await Promise.all([
        client.get<Record<string, unknown>>(`/repos/${owner}/${repo}`),
        client.get<Record<string, number>>(`/repos/${owner}/${repo}/languages`),
        client.get<Array<Record<string, unknown>>>(`/repos/${owner}/${repo}/commits?per_page=10`),
      ]);

      let readme = "README not found.";
      try {
        const readmeResp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/readme`);
        readme = decodeBase64(readmeResp.data.content as string);
      } catch { /* no readme */ }

      let tree = "File tree unavailable.";
      try {
        const r = repoResp.data;
        const treeResp = await client.get<{ tree: Array<Record<string, unknown>> }>(
          `/repos/${owner}/${repo}/git/trees/${r.default_branch}?recursive=1`
        );
        tree = treeResp.data.tree
          .filter((t) => t.type === "blob")
          .map((t) => `- \`${t.path}\``)
          .slice(0, 200)
          .join("\n");
        if (treeResp.data.tree.length > 200) tree += "\n- ... (truncated)";
      } catch { /* no tree */ }

      const langs = Object.entries(languagesResp.data);
      const totalBytes = langs.reduce((a, [, b]) => a + b, 0);
      const langBreakdown = langs
        .map(([lang, bytes]) => `- ${lang}: ${((bytes / totalBytes) * 100).toFixed(1)}%`)
        .join("\n") || "No language data";

      const recentCommits = commitsResp.data.map((c) => {
        const inner = c.commit as Record<string, unknown>;
        return `- ${(inner?.message as string)?.split("\n")[0]}`;
      }).join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `# Codebase Overview: ${owner}/${repo}`,
                "",
                `**Description:** ${repoResp.data.description || "N/A"}`,
                `**Default Branch:** \`${repoResp.data.default_branch}\``,
                "",
                `## Languages`,
                langBreakdown,
                "",
                `## File Structure`,
                tree,
                "",
                `## Recent Activity`,
                recentCommits,
                "",
                `## README`,
                readme,
                "",
                "---",
                "",
                "Based on the above, please provide:",
                "1. **Architecture Overview** — High-level structure and key components",
                "2. **Tech Stack** — Languages, frameworks, tools, and patterns used",
                "3. **Key Directories** — What each major directory contains",
                "4. **Entry Points** — Where to start reading the code",
                "5. **Development Workflow** — How to build, test, and run the project",
              ].join("\n"),
            },
          },
        ],
      };
    }
  );
}
