import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { withDefaults, formatDate } from "../utils/helpers.js";
import { formatWorkflowRun } from "../utils/markdown.js";

export function registerActionTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  if (!isGateEnabled("actions", config)) return;

  server.registerTool("list_workflows", {
    description: "List workflow definitions in a repository",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const { data } = await client.octokit.rest.actions.listRepoWorkflows({
      owner,
      repo,
      per_page: params.per_page,
    });
    const workflows = data.workflows;
    if (workflows.length === 0) return { content: [{ type: "text" as const, text: "No workflows found." }] };

    const lines = ["| ID | Name | State | Path |", "| --- | --- | --- | --- |"];
    for (const w of workflows as Record<string, unknown>[]) {
      lines.push(`| ${w.id} | ${w.name} | ${w.state} | \`${w.path}\` |`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  server.registerTool("list_workflow_runs", {
    description: "List workflow runs with status and branch filters",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      workflow_id: z.union([z.string(), z.number()]).optional().describe("Workflow ID or filename"),
      branch: z.string().optional(),
      event: z.string().optional(),
      status: z.enum(["completed", "action_required", "cancelled", "failure", "neutral", "skipped", "stale", "success", "timed_out", "in_progress", "queued", "requested", "waiting", "pending"]).optional(),
      per_page: z.number().min(1).max(100).optional().default(20),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    let runs: Array<Record<string, unknown>>;
    if (params.workflow_id !== undefined) {
      const { data } = await client.octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: params.workflow_id,
        branch: params.branch,
        event: params.event,
        status: params.status,
        per_page: params.per_page,
      });
      runs = data.workflow_runs as Array<Record<string, unknown>>;
    } else {
      const { data } = await client.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch: params.branch,
        event: params.event,
        status: params.status,
        per_page: params.per_page,
      });
      runs = data.workflow_runs as Array<Record<string, unknown>>;
    }
    if (runs.length === 0) return { content: [{ type: "text" as const, text: "No workflow runs found." }] };

    const lines = ["| # | Workflow | Status | Conclusion | Branch | Event | Updated |", "| --- | --- | --- | --- | --- | --- | --- |"];
    for (const r of runs) {
      lines.push(
        `| #${r.run_number} | ${r.name} | ${r.status} | ${r.conclusion ?? "pending"} | \`${r.head_branch}\` | ${r.event} | ${formatDate(r.updated_at as string)} |`
      );
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  server.registerTool("get_workflow_run", {
    description: "Get details for a specific workflow run",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number().describe("Workflow run ID"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const { data } = await client.octokit.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: params.run_id,
    });
    return { content: [{ type: "text" as const, text: formatWorkflowRun(data as Record<string, unknown>) }] };
  });

  server.registerTool("list_workflow_run_jobs", {
    description: "List jobs in a workflow run with step details",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number(),
      filter: z.enum(["latest", "all"]).optional().default("latest"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const { data } = await client.octokit.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: params.run_id,
      filter: params.filter,
    });
    const jobs = data.jobs;
    if (jobs.length === 0) return { content: [{ type: "text" as const, text: "No jobs found." }] };

    const lines: string[] = [];
    for (const job of jobs as Record<string, unknown>[]) {
      lines.push(
        `## ${job.name}`,
        "",
        `**Status:** ${job.status} | **Conclusion:** ${job.conclusion ?? "pending"} | **Runner:** ${job.runner_name ?? "N/A"}`,
        ""
      );
      const steps = job.steps as Array<Record<string, unknown>> | undefined;
      if (steps?.length) {
        lines.push("| # | Step | Status | Conclusion |", "| --- | --- | --- | --- |");
        for (const s of steps) {
          lines.push(`| ${s.number} | ${s.name} | ${s.status} | ${s.conclusion ?? "pending"} |`);
        }
        lines.push("");
      }
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  server.registerTool("get_workflow_run_logs", {
    description: "Download and return workflow run logs as text",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number(),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    try {
      const { data } = await client.octokit.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: params.run_id,
        filter: "latest",
      });
      const jobs = data.jobs;
      const lines: string[] = [`# Logs for Run #${params.run_id}`, ""];

      for (const job of jobs as Record<string, unknown>[]) {
        lines.push(`## ${job.name} (${job.conclusion ?? job.status})`, "");
        const steps = job.steps as Array<Record<string, unknown>> | undefined;
        if (steps?.length) {
          for (const step of steps) {
            const icon = step.conclusion === "success" ? "+" : step.conclusion === "failure" ? "x" : "-";
            lines.push(`[${icon}] Step ${step.number}: ${step.name} (${step.conclusion ?? step.status})`);
          }
        }
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch {
      return { content: [{ type: "text" as const, text: `Failed to fetch logs for run ${params.run_id}. Logs may have expired (kept for 90 days).` }] };
    }
  });

  server.registerTool("trigger_workflow", {
    description: "Trigger a workflow_dispatch event",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      workflow_id: z.union([z.string(), z.number()]).describe("Workflow ID or filename (e.g. 'deploy.yml')"),
      ref: z.string().describe("Branch or tag to run on"),
      inputs: z.record(z.string()).optional().describe("Workflow input parameters"),
    },
    annotations: WRITE_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    await client.octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: params.workflow_id,
      ref: params.ref,
      inputs: params.inputs,
    });
    return { content: [{ type: "text" as const, text: `Workflow \`${params.workflow_id}\` triggered on \`${params.ref}\`.` }] };
  });

  server.registerTool("cancel_workflow_run", {
    description: "Cancel a running workflow",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number(),
    },
    annotations: WRITE_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    await client.octokit.rest.actions.cancelWorkflowRun({
      owner,
      repo,
      run_id: params.run_id,
    });
    return { content: [{ type: "text" as const, text: `Workflow run #${params.run_id} cancellation requested.` }] };
  });

  server.registerTool("rerun_workflow", {
    description: "Re-run a failed workflow",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number(),
      enable_debug_logging: z.boolean().optional().default(false),
    },
    annotations: WRITE_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    await client.octokit.rest.actions.reRunWorkflow({
      owner,
      repo,
      run_id: params.run_id,
      enable_debug_logging: params.enable_debug_logging,
    });
    return { content: [{ type: "text" as const, text: `Workflow run #${params.run_id} re-run triggered.` }] };
  });
}
