import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  FileSystemReader,
  McpServerApproval,
  PermissionMode,
  ProjectFile,
} from "@paleonyx/shared-types";
import { canRunCommands } from "@paleonyx/shared-types";
import type { ConnectedTool } from "@paleonyx/agent-core";
import {
  PROJECT_MCP_CONFIG_PATH,
  acceptToolList,
  approvalState,
  approveServer,
  fingerprintServer,
  newTools,
  offeredTools,
  parseApprovals,
  parseMcpConfig,
  setToolEnabled,
} from "@paleonyx/mcp-client";
import type { ConnectedServerView } from "@paleonyx/ui";
import { useLocalPreference } from "@paleonyx/ui";
import { ServerManager } from "./connected-servers.js";
import { serverTransport } from "./tauri-mcp.js";
import packageJson from "../package.json";

const CLIENT_INFO = { name: "Paleonyx Studio", version: packageJson.version };

export interface ConnectedServers {
  configPath: string;
  hasConfig: boolean;
  servers: ConnectedServerView[];
  problems: string[];
  /** What the agent may be offered right now. */
  tools: ConnectedTool[];
  allow: (serverId: string) => void;
  forget: (serverId: string) => void;
  stop: (serverId: string) => void;
  start: (serverId: string) => void;
  retry: (serverId: string) => void;
  setToolEnabled: (serverId: string, toolName: string, enabled: boolean) => void;
}

/**
 * The project's MCP servers: what its configuration lists, what the user
 * has allowed, and what is running.
 *
 * A server runs only when all three line up — listed, approved exactly
 * as it is now listed, and the project in a mode where the agent may use
 * it. Anything else stops it. The approval is stored per project, like
 * the permission mode, since trusting a server in one repository says
 * nothing about another.
 */
export function useConnectedServers({
  fs,
  files,
  projectRoot,
  permissionMode,
}: {
  fs: FileSystemReader;
  files: readonly ProjectFile[];
  projectRoot: string;
  permissionMode: PermissionMode;
}): ConnectedServers {
  const hasConfig = files.some((file) => file.path === PROJECT_MCP_CONFIG_PATH);
  const [configText, setConfigText] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  // Re-read whenever the file list is refreshed, which is after every
  // write — so a server added or changed by an applied change shows up,
  // and a changed command stops the old one straight away.
  useEffect(() => {
    if (!hasConfig) {
      setConfigText(null);
      setReadError(null);
      return;
    }
    let current = true;
    fs.readFile(PROJECT_MCP_CONFIG_PATH).then(
      (text) => {
        if (!current) return;
        setConfigText(text);
        setReadError(null);
      },
      (error: unknown) => {
        if (!current) return;
        setConfigText(null);
        setReadError(
          `${PROJECT_MCP_CONFIG_PATH} couldn't be read: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    );
    return () => {
      current = false;
    };
  }, [fs, files, hasConfig]);

  const config = useMemo(
    () => (configText === null ? { servers: [], problems: [] } : parseMcpConfig(configText)),
    [configText]
  );

  const [storedApprovals, storeApprovals] = useLocalPreference<unknown>(
    `paleonyx.mcpApprovals:${projectRoot}`,
    {}
  );
  const approvals = useMemo(() => parseApprovals(storedApprovals), [storedApprovals]);
  // The manager reports tool lists asynchronously; it must update the
  // approvals as they are then, not as they were when it started.
  const latestApprovals = useRef(approvals);
  latestApprovals.current = approvals;

  const updateApproval = useCallback(
    (serverId: string, next: McpServerApproval | undefined) => {
      const all = { ...latestApprovals.current };
      if (next) all[serverId] = next;
      else delete all[serverId];
      latestApprovals.current = all;
      storeApprovals(all);
    },
    [storeApprovals]
  );

  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const manager = useMemo(
    () =>
      new ServerManager({
        clientInfo: CLIENT_INFO,
        openTransport: serverTransport,
        onChange: rerender,
        onToolsListed: (serverId, fingerprint, tools) => {
          const approval = latestApprovals.current[serverId];
          if (!approval || approval.fingerprint !== fingerprint) return;
          const next = acceptToolList(approval, tools);
          if (next !== approval) updateApproval(serverId, next);
        },
      }),
    // A project gets its own manager; the old one is stopped below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by project on purpose
    [projectRoot, updateApproval]
  );
  useEffect(() => () => manager.stopAll(), [manager]);

  const commandsAllowed = canRunCommands(permissionMode);
  useEffect(() => {
    manager.reconcile(
      commandsAllowed
        ? config.servers.filter(
            (server) => approvalState(server, approvals[server.id]) === "approved"
          )
        : []
    );
  }, [manager, config, approvals, commandsAllowed]);

  const running = manager.running();
  const offered = offeredTools(
    running.flatMap((session) => {
      const approval = approvals[session.serverId];
      return approval ? [{ ...session, approval }] : [];
    })
  );

  const servers: ConnectedServerView[] = config.servers.map((server) => {
    const approval = approvals[server.id];
    const approved = approvalState(server, approval);
    const status = manager.status(server.id);
    const listed = status.kind === "running" ? status.tools : [];
    const unseen = approval ? newTools(approval, listed) : [];
    return {
      id: server.id,
      command: server.command,
      args: server.args,
      env: server.env,
      approval: approved,
      state:
        approved !== "approved"
          ? { kind: "needs-approval" }
          : status.kind === "running"
            ? {
                kind: "running",
                protocolVersion: status.protocolVersion,
                ...(status.serverName ? { serverName: status.serverName } : {}),
              }
            : status.kind === "failed"
              ? status.fingerprint === fingerprintServer(server)
                ? { kind: "failed", message: status.message, log: status.log }
                : { kind: "waiting" }
              : status.kind === "starting"
                ? { kind: "starting" }
                : manager.isPaused(server.id)
                  ? { kind: "stopped" }
                  : { kind: "waiting" },
      tools: listed.map((tool) => ({
        name: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        description: tool.description,
        enabled: approval?.enabledTools.includes(tool.name) ?? false,
        isNew: unseen.includes(tool.name),
      })),
      problems: status.kind === "running" ? status.problems : [],
    };
  });

  const problems = [
    ...(readError ? [readError] : []),
    ...config.problems.map((problem) => problem.message),
    ...offered.problems.map((problem) => `${problem.serverId}: ${problem.message}`),
  ];

  return {
    configPath: PROJECT_MCP_CONFIG_PATH,
    hasConfig,
    servers,
    problems,
    tools: offered.tools,
    allow: (serverId) => {
      const server = config.servers.find((candidate) => candidate.id === serverId);
      if (!server) return;
      const previous = approvals[serverId];
      // Re-approving a changed server keeps the tool choices already
      // made; a tool that appeared meanwhile still starts switched off.
      updateApproval(
        serverId,
        previous
          ? { ...previous, fingerprint: fingerprintServer(server) }
          : approveServer(server)
      );
      manager.retry(serverId);
    },
    forget: (serverId) => updateApproval(serverId, undefined),
    stop: (serverId) => manager.pause(serverId),
    start: (serverId) => manager.resume(serverId),
    retry: (serverId) => manager.retry(serverId),
    setToolEnabled: (serverId, toolName, enabled) => {
      const approval = approvals[serverId];
      if (approval) updateApproval(serverId, setToolEnabled(approval, toolName, enabled));
    },
  };
}
