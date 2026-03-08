import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { withDefaults, buildQueryString, formatDate } from "../utils/helpers.js";
import { formatWorkflowRun } from "../utils/markdown.js";

export function registerActionTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  if (!isGateEnabled("actions", config)) return;

  server.tool(
    "list_workflows",
    "List workflow definitions in a repository",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<{ total_count: number; workflows: Array<Record<string, unknown>> }>(
        `/repos/${owner}/${repo}/actions/workflows?per_page=${params.per_page}`
      );
      const workflows = resp.data.workflows;
      if (workflows.length === 0) return { content: [{ type: "text" as const, text: "No workflows found." }] };

      const lines = ["| ID | Name | State | Path |", "| --- | --- | --- | --- |"];
      for (const w of workflows) {
        lines.push(`| ${w.id} | ${w.name} | ${w.state} | \`${w.path}\` |`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "list_workflow_runs",
    "List workflow runs with status and branch filters",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      workflow_id: z.union([z.string(), z.number()]).optional().describe("Workflow ID or filename"),
      branch: z.string().optional(),
      event: z.string().optional(),
      status: z.enum(["completed", "action_required", "cancelled", "failure", "neutral", "skipped", "stale", "success", "timed_out", "in_progress", "queued", "requested", "waiting", "pending"]).optional(),
      per_page: z.number().min(1).max(100).optional().default(20),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const qs = buildQueryString({ branch: params.branch, event: params.event, status: params.status, per_page: params.per_page });
      const path = params.workflow_id
        ? `/repos/${owner}/${repo}/actions/workflows/${params.workflow_id}/runs${qs}`
        : `/repos/${owner}/${repo}/actions/runs${qs}`;

      const resp = await client.get<{ total_count: number; workflow_runs: Array<Record<string, unknown>> }>(path);
      const runs = resp.data.workflow_runs;
      if (runs.length === 0) return { content: [{ type: "text" as const, text: "No workflow runs found." }] };

      const lines = ["| # | Workflow | Status | Conclusion | Branch | Event | Updated |", "| --- | --- | --- | --- | --- | --- | --- |"];
      for (const r of runs) {
        lines.push(
          `| #${r.run_number} | ${r.name} | ${r.status} | ${r.conclusion ?? "pending"} | \`${r.head_branch}\` | ${r.event} | ${formatDate(r.updated_at as string)} |`
        );
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "get_workflow_run",
    "Get details for a specific workflow run",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number().describe("Workflow run ID"),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/actions/runs/${params.run_id}`);
      return { content: [{ type: "text" as const, text: formatWorkflowRun(resp.data) }] };
    }
  );

  server.tool(
    "list_workflow_run_jobs",
    "List jobs in a workflow run with step details",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number(),
      filter: z.enum(["latest", "all"]).optional().default("latest"),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<{ total_count: number; jobs: Array<Record<string, unknown>> }>(
        `/repos/${owner}/${repo}/actions/runs/${params.run_id}/jobs?filter=${params.filter}`
      );
      const jobs = resp.data.jobs;
      if (jobs.length === 0) return { content: [{ type: "text" as const, text: "No jobs found." }] };

      const lines: string[] = [];
      for (const job of jobs) {
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
    }
  );

  server.tool(
    "get_workflow_run_logs",
    "Download and return workflow run logs as text",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number(),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      try {
        const resp = await client.get<{ total_count: number; jobs: Array<Record<string, unknown>> }>(
          `/repos/${owner}/${repo}/actions/runs/${params.run_id}/jobs?filter=latest`
        );

        const jobs = resp.data.jobs;
        const lines: string[] = [`# Logs for Run #${params.run_id}`, ""];

        for (const job of jobs) {
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
    }
  );

  server.tool(
    "trigger_workflow",
    "Trigger a workflow_dispatch event",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      workflow_id: z.union([z.string(), z.number()]).describe("Workflow ID or filename (e.g. 'deploy.yml')"),
      ref: z.string().describe("Branch or tag to run on"),
      inputs: z.record(z.string()).optional().describe("Workflow input parameters"),
    },
    WRITE_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      await client.post(
        `/repos/${owner}/${repo}/actions/workflows/${params.workflow_id}/dispatches`,
        { ref: params.ref, inputs: params.inputs }
      );
      return { content: [{ type: "text" as const, text: `Workflow \`${params.workflow_id}\` triggered on \`${params.ref}\`.` }] };
    }
  );

  server.tool(
    "cancel_workflow_run",
    "Cancel a running workflow",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number(),
    },
    WRITE_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      await client.post(`/repos/${owner}/${repo}/actions/runs/${params.run_id}/cancel`);
      return { content: [{ type: "text" as const, text: `Workflow run #${params.run_id} cancellation requested.` }] };
    }
  );

  server.tool(
    "rerun_workflow",
    "Re-run a failed workflow",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.number(),
      enable_debug_logging: z.boolean().optional().default(false),
    },
    WRITE_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      await client.post(
        `/repos/${owner}/${repo}/actions/runs/${params.run_id}/rerun`,
        { enable_debug_logging: params.enable_debug_logging }
      );
      return { content: [{ type: "text" as const, text: `Workflow run #${params.run_id} re-run triggered.` }] };
    }
  );
}
