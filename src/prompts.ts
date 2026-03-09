import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubClient } from "./github/client.js";
import type { Config } from "./config.js";
import { withDefaults, decodeBase64 } from "./utils/helpers.js";
import { toonFormat } from "./utils/toon.js";

export function registerPrompts(server: McpServer, client: GitHubClient, config: Config): void {

  server.registerPrompt("pr-review", {
    description: "Perform a thorough code review of a pull request with inline suggestions",
    argsSchema: {
      owner: z.string().optional().describe("Repository owner"),
      repo: z.string().optional().describe("Repository name"),
      pr_number: z.string().describe("Pull request number"),
    },
  }, async (params) => {
    const { owner, repo } = withDefaults({ owner: params.owner, repo: params.repo }, config);
    const prNum = parseInt(params.pr_number, 10);

    const [prResp, files, diffResp, reviews] = await Promise.all([
      client.octokit.rest.pulls.get({ owner, repo, pull_number: prNum }),
      client.octokit.paginate(client.octokit.rest.pulls.listFiles, { owner, repo, pull_number: prNum, per_page: 100 }),
      client.octokit.rest.pulls.get({ owner, repo, pull_number: prNum, mediaType: { format: "diff" } }),
      client.octokit.paginate(client.octokit.rest.pulls.listReviews, { owner, repo, pull_number: prNum }),
    ]);

    const diff = diffResp.data as unknown as string;
    const data = toonFormat({ pr: prResp.data, files, reviews });
    const instructions = [
      "Please review this pull request thoroughly. For each issue found:",
      "1. Identify the file and line number",
      "2. Explain the problem",
      "3. Suggest a specific fix",
      "",
      "Focus on: correctness, security, performance, maintainability, and adherence to project conventions.",
      "If the PR looks good, say so and highlight any particularly well-done aspects.",
    ].join("\n");
    return {
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: `${data}\n\n---\n\n## Full Diff\n${diff}\n\n---\n\n${instructions}` },
      }],
    };
  });

  server.registerPrompt("repo-health", {
    description: "Assess the health and status of a repository",
    argsSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
    },
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);

    const [repoResp, issuesResp, prsResp, commitsResp] = await Promise.all([
      client.octokit.rest.repos.get({ owner, repo }),
      client.octokit.rest.issues.listForRepo({ owner, repo, state: "open", per_page: 5 }),
      client.octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 5 }),
      client.octokit.rest.repos.listCommits({ owner, repo, per_page: 10 }),
    ]);

    const data = toonFormat({
      repo: repoResp.data,
      recent_commits: commitsResp.data,
      open_issues: issuesResp.data,
      open_prs: prsResp.data,
    });
    const instructions = [
      "Please assess the health of this repository. Consider:",
      "- Activity level and momentum",
      "- Issue/PR management (are things getting addressed?)",
      "- Code maintenance signals",
      "- Recommendations for improvement",
    ].join("\n");
    return {
      messages: [{ role: "user" as const, content: { type: "text" as const, text: `${data}\n\n---\n\n${instructions}` } }],
    };
  });

  server.registerPrompt("release-notes", {
    description: "Generate formatted release notes from commits/PRs between two refs",
    argsSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      base: z.string().describe("Base tag/ref"),
      head: z.string().optional().describe("Head tag/ref (defaults to HEAD)"),
    },
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const head = params.head || "HEAD";

    const { data } = await client.octokit.rest.repos.compareCommits({ owner, repo, base: params.base, head });
    const payload = toonFormat(data);
    const instructions = [
      "Please generate well-formatted release notes. Group into:",
      "- Features (new functionality)",
      "- Bug Fixes",
      "- Improvements (refactors, performance)",
      "- Breaking Changes (if any)",
      "- Other",
      "", "Write in a user-friendly style suitable for a CHANGELOG or GitHub release.",
    ].join("\n");
    return {
      messages: [{ role: "user" as const, content: { type: "text" as const, text: `${payload}\n\n---\n\n${instructions}` } }],
    };
  });

  server.registerPrompt("issue-analysis", {
    description: "Analyze an issue with comments and linked PRs for root cause or implementation plan",
    argsSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      issue_number: z.string().describe("Issue number"),
    },
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const num = parseInt(params.issue_number, 10);

    const [issueResp, comments] = await Promise.all([
      client.octokit.rest.issues.get({ owner, repo, issue_number: num }),
      client.octokit.paginate(client.octokit.rest.issues.listComments, { owner, repo, issue_number: num, per_page: 100 }),
    ]);
    const data = toonFormat({ issue: issueResp.data, comments });
    const instructions = [
      "Please analyze this issue and provide:",
      "1. Root Cause Analysis — What's the underlying problem?",
      "2. Implementation Plan — Step-by-step approach to resolve it",
      "3. Risks & Considerations — Edge cases, backward compatibility, testing needs",
      "4. Estimated Complexity — Simple / Medium / Complex",
    ].join("\n");
    return {
      messages: [{ role: "user" as const, content: { type: "text" as const, text: `${data}\n\n---\n\n${instructions}` } }],
    };
  });

  server.registerPrompt("action-failure-diagnosis", {
    description: "Diagnose a failed GitHub Actions workflow run",
    argsSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.string().describe("Workflow run ID"),
    },
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const runId = parseInt(params.run_id, 10);

    const [runResp, jobsResp] = await Promise.all([
      client.octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId }),
      client.octokit.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: runId, filter: "latest" }),
    ]);
    const data = toonFormat({ run: runResp.data, jobs: jobsResp.data.jobs });
    const instructions = [
      "Please diagnose this workflow failure:",
      "1. Identify the root cause from the failed steps",
      "2. Suggest specific fixes",
      "3. Indicate if this is a flaky test, config issue, code bug, or environment problem",
    ].join("\n");
    return {
      messages: [{ role: "user" as const, content: { type: "text" as const, text: `${data}\n\n---\n\n${instructions}` } }],
    };
  });

  server.registerPrompt("dependency-review", {
    description: "Review dependency changes in a pull request for security and compatibility",
    argsSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pr_number: z.string().describe("Pull request number"),
    },
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const prNum = parseInt(params.pr_number, 10);

    const files = await client.octokit.paginate(client.octokit.rest.pulls.listFiles, { owner, repo, pull_number: prNum, per_page: 100 });

    const depPatterns = [
      "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
      "requirements.txt", "Pipfile", "Pipfile.lock", "pyproject.toml", "poetry.lock",
      "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "Gemfile", "Gemfile.lock",
      "build.gradle", "pom.xml",
    ];

    const depFiles = files.filter((f) => depPatterns.some((p) => f.filename.endsWith(p)));
    const data = toonFormat({ pr_number: prNum, repository: `${owner}/${repo}`, dependency_files: depFiles });
    const instructions = [
      "Please review these dependency changes:",
      "1. New dependencies — Are they well-maintained? Any known vulnerabilities?",
      "2. Version changes — Are there breaking changes in major bumps?",
      "3. Removed dependencies — Is removal safe?",
      "4. Lock file consistency — Do lock file changes match manifest changes?",
      "5. Security concerns — Any dependencies with known CVEs?",
    ].join("\n");
    return {
      messages: [{ role: "user" as const, content: { type: "text" as const, text: `${data}\n\n---\n\n${instructions}` } }],
    };
  });

  server.registerPrompt("codebase-overview", {
    description: "Generate an architectural overview of a repository for onboarding",
    argsSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
    },
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);

    const [repoResp, langsResp, commitsResp] = await Promise.all([
      client.octokit.rest.repos.get({ owner, repo }),
      client.octokit.rest.repos.listLanguages({ owner, repo }),
      client.octokit.rest.repos.listCommits({ owner, repo, per_page: 10 }),
    ]);

    let readme = "README not found.";
    try {
      const readmeResp = await client.octokit.rest.repos.getReadme({ owner, repo });
      readme = decodeBase64((readmeResp.data as unknown as { content: string }).content);
    } catch { /* no readme */ }

    let tree: unknown[] = [];
    try {
      const treeResp = await client.octokit.rest.git.getTree({ owner, repo, tree_sha: repoResp.data.default_branch, recursive: "1" });
      tree = treeResp.data.tree.filter((t) => t.type === "blob").slice(0, 200);
    } catch { /* no tree */ }

    const payload = toonFormat({
      repo: repoResp.data,
      languages: langsResp.data,
      file_tree: tree,
      recent_commits: commitsResp.data,
      readme,
    });
    const instructions = [
      "Based on the above, please provide:",
      "1. Architecture Overview — High-level structure and key components",
      "2. Tech Stack — Languages, frameworks, tools, and patterns used",
      "3. Key Directories — What each major directory contains",
      "4. Entry Points — Where to start reading the code",
      "5. Development Workflow — How to build, test, and run the project",
    ].join("\n");
    return {
      messages: [{ role: "user" as const, content: { type: "text" as const, text: `${payload}\n\n---\n\n${instructions}` } }],
    };
  });
}
