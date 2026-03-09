import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { withDefaults } from "../utils/helpers.js";
import { content } from "../utils/toon.js";

export function registerActionTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  if (!isGateEnabled("actions", config)) return;

  server.registerTool("list_workflows", {
    description: "List workflow definitions in a repository",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      per_page: z.coerce.number().min(1).max(100).optional().default(30),
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
    if (workflows.length === 0) return content({ workflows: [] });
    return content(data);
  });

  server.registerTool("list_workflow_runs", {
    description: "List workflow runs with status and branch filters",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      workflow_id: z.union([z.string(), z.coerce.number()]).optional().describe("Workflow ID or filename"),
      branch: z.string().optional(),
      event: z.string().optional(),
      status: z.enum(["completed", "action_required", "cancelled", "failure", "neutral", "skipped", "stale", "success", "timed_out", "in_progress", "queued", "requested", "waiting", "pending"]).optional(),
      per_page: z.coerce.number().min(1).max(100).optional().default(20),
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
    if (runs.length === 0) return content({ workflow_runs: [] });
    return content({ workflow_runs: runs });
  });

  server.registerTool("get_workflow_run", {
    description: "Get details for a specific workflow run",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.coerce.number().describe("Workflow run ID"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const { data } = await client.octokit.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: params.run_id,
    });
    return content(data);
  });

  server.registerTool("list_workflow_run_jobs", {
    description: "List jobs in a workflow run with step details",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.coerce.number(),
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
    if (jobs.length === 0) return content({ jobs: [] });
    return content(data);
  });

  server.registerTool("get_workflow_run_logs", {
    description: "Download and return workflow run logs as text",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.coerce.number(),
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
      return content({ run_id: params.run_id, jobs: data.jobs });
    } catch {
      return content({ error: "Logs may have expired (kept for 90 days)", run_id: params.run_id });
    }
  });

  server.registerTool("trigger_workflow", {
    description: "Trigger a workflow_dispatch event",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      workflow_id: z.union([z.string(), z.coerce.number()]).describe("Workflow ID or filename (e.g. 'deploy.yml')"),
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
    return content({ workflow_id: params.workflow_id, ref: params.ref, message: "Workflow triggered" });
  });

  server.registerTool("cancel_workflow_run", {
    description: "Cancel a running workflow",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.coerce.number(),
    },
    annotations: WRITE_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    await client.octokit.rest.actions.cancelWorkflowRun({
      owner,
      repo,
      run_id: params.run_id,
    });
    return content({ run_id: params.run_id, message: "Cancellation requested" });
  });

  server.registerTool("rerun_workflow", {
    description: "Re-run a failed workflow",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      run_id: z.coerce.number(),
      enable_debug_logging: z.coerce.boolean().optional().default(false),
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
    return content({ run_id: params.run_id, message: "Re-run triggered" });
  });
}
