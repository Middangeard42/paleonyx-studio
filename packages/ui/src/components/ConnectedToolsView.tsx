import { useState } from "react";
import { AlertTriangle, Eye, EyeOff, Plug } from "lucide-react";
import clsx from "clsx";
import { Button } from "../primitives/Button.js";
import { StatusBadge } from "../primitives/StatusBadge.js";
import type { StatusTone } from "../primitives/StatusBadge.js";

export type ConnectedServerApproval = "not-approved" | "changed" | "approved";

export type ConnectedServerState =
  /** Not approved, so not started. */
  | { kind: "needs-approval" }
  /** Approved, but the permission mode does not let the agent use it. */
  | { kind: "waiting" }
  /** Stopped by the user. */
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "running"; protocolVersion: string; serverName?: string }
  | { kind: "failed"; message: string; log: string };

export interface ConnectedToolView {
  name: string;
  title?: string;
  description: string;
  enabled: boolean;
  /** Appeared after the server was approved; starts disabled. */
  isNew: boolean;
}

export interface ConnectedServerView {
  id: string;
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  approval: ConnectedServerApproval;
  state: ConnectedServerState;
  tools: readonly ConnectedToolView[];
  /** Tools the server offered that could not be used. */
  problems: readonly string[];
}

export interface ConnectedToolsViewProps {
  configPath: string;
  hasConfig: boolean;
  servers: readonly ConnectedServerView[];
  /** Configuration entries that could not be used, and name clashes. */
  problems: readonly string[];
  /** Whether the permission mode lets the agent use these at all. */
  commandsAllowed: boolean;
  modelCanCallTools: boolean;
  modelLabel: string;
  onAllow: (serverId: string) => void;
  onForget: (serverId: string) => void;
  onStop: (serverId: string) => void;
  onStart: (serverId: string) => void;
  onRetry: (serverId: string) => void;
  onToolEnabledChange: (serverId: string, toolName: string, enabled: boolean) => void;
}

const EXAMPLE = `{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}`;

/**
 * Servers that give the agent extra tools, and what each is allowed to do.
 *
 * Everything a user needs to decide whether to trust a server is on the
 * card before they allow it: the exact program and arguments, and the
 * environment it is given. Nothing here starts a program without a
 * click, and the tools are listed one by one, so "the agent may use this"
 * is a choice made per tool rather than implied by a file in the repo.
 */
export function ConnectedToolsView(props: ConnectedToolsViewProps) {
  const { configPath, hasConfig, servers, problems, commandsAllowed, modelCanCallTools } = props;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1.5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <Plug size={16} />
          Connected tools
        </h2>
        <p className="max-w-prose text-sm text-text-secondary">
          Programs listed in <code className="font-mono text-text-primary">{configPath}</code> can
          give the agent extra tools, such as looking things up or talking to other apps. They run
          on this computer with your permissions, and what they do is not part of a proposed
          change — so it can&apos;t be undone from History.
        </p>
      </header>

      {!commandsAllowed ? (
        <p className="rounded-md border border-status-info/30 bg-status-info/10 p-2.5 text-xs text-text-secondary">
          The agent only uses these when this project is set to{" "}
          <span className="font-medium text-text-primary">Can run commands</span>. Servers you
          allow will start when you switch to it, from the status bar.
        </p>
      ) : !modelCanCallTools ? (
        <p className="rounded-md border border-status-info/30 bg-status-info/10 p-2.5 text-xs text-text-secondary">
          {props.modelLabel} can&apos;t call tools, so it won&apos;t use these. Pick a model marked
          &ldquo;can run commands&rdquo; in Models.
        </p>
      ) : null}

      {problems.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5 text-xs text-text-secondary"
        >
          <p className="mb-1 flex items-center gap-1.5 font-medium text-text-primary">
            <AlertTriangle size={12} className="text-status-warning" />
            {problems.length === 1 ? "Something couldn't be used" : `${problems.length} things couldn't be used`}
          </p>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {!hasConfig ? (
        <section className="rounded-md border border-border-subtle bg-surface-1 p-3 text-sm text-text-secondary">
          <p className="text-text-primary">No servers are set up for this project.</p>
          <p className="mt-1">
            To add one, create <code className="font-mono">{configPath}</code> listing it like
            this. Most servers&apos; instructions include a block in this format — it&apos;s the
            same one Claude Desktop and Cursor read.
          </p>
          <pre className="mt-2 overflow-x-auto rounded border border-border-subtle bg-surface-0 p-2 font-mono text-xs text-text-primary">
            {EXAMPLE}
          </pre>
        </section>
      ) : servers.length === 0 && problems.length === 0 ? (
        <p className="text-sm text-text-secondary">
          <code className="font-mono">{configPath}</code> doesn&apos;t list any servers.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {servers.map((server) => (
            <li key={server.id}>
              <ServerCard server={server} {...props} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ServerCard({
  server,
  onAllow,
  onForget,
  onStop,
  onStart,
  onRetry,
  onToolEnabledChange,
}: { server: ConnectedServerView } & ConnectedToolsViewProps) {
  const { tone, label } = describeState(server);
  const envNames = Object.keys(server.env);

  return (
    <article
      aria-label={`Server ${server.id}`}
      className="rounded-md border border-border-default bg-surface-1 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-sm font-semibold text-text-primary">{server.id}</h3>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-tertiary">Runs</dt>
        <dd className="min-w-0 break-all font-mono text-text-primary">
          {describeCommandLine(server.command, server.args)}
        </dd>
        {envNames.length > 0 && (
          <>
            <dt className="text-text-tertiary">Sets</dt>
            <dd className="min-w-0">
              <EnvironmentList env={server.env} />
            </dd>
          </>
        )}
      </dl>

      {server.approval !== "approved" ? (
        <div className="mt-3 rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5">
          <p className="text-xs text-text-secondary">
            {server.approval === "changed"
              ? "What this server runs has changed since you allowed it, so it won't start until you check it again."
              : "This project wants to start this program. Only allow it if you trust it: it can do anything you can do on this computer."}
          </p>
          <Button className="mt-2" variant="primary" size="sm" onClick={() => onAllow(server.id)}>
            {server.approval === "changed" ? "Allow the new version" : "Allow"}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {server.state.kind === "running" || server.state.kind === "starting" ? (
            <Button size="sm" onClick={() => onStop(server.id)}>
              Stop
            </Button>
          ) : server.state.kind === "stopped" ? (
            <Button size="sm" onClick={() => onStart(server.id)}>
              Start
            </Button>
          ) : null}
          {server.state.kind === "failed" && (
            <Button size="sm" onClick={() => onRetry(server.id)}>
              Try again
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onForget(server.id)}>
            Remove permission
          </Button>
        </div>
      )}

      {server.state.kind === "failed" && (
        <div className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/10 p-2.5 text-xs">
          <p className="text-text-primary">{server.state.message}</p>
          {server.state.log.trim() && (
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-text-secondary">
              {server.state.log}
            </pre>
          )}
        </div>
      )}

      {server.state.kind === "running" && (
        <section className="mt-3">
          <h4 className="mb-1.5 text-xs font-medium text-text-tertiary">
            Tools the agent may use
            <span className="ml-1.5 font-normal">
              · MCP {server.state.protocolVersion}
              {server.state.serverName ? ` · ${server.state.serverName}` : ""}
            </span>
          </h4>
          {server.tools.length === 0 ? (
            <p className="text-xs text-text-secondary">This server doesn&apos;t offer any tools.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {server.tools.map((tool) => (
                <li key={tool.name}>
                  <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={tool.enabled}
                      onChange={(event) =>
                        onToolEnabledChange(server.id, tool.name, event.target.checked)
                      }
                      className="mt-0.5 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 text-xs">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-text-primary">{tool.name}</span>
                        {tool.title && <span className="text-text-secondary">{tool.title}</span>}
                        {tool.isNew && <StatusBadge tone="warning">New — off until you turn it on</StatusBadge>}
                      </span>
                      {tool.description && (
                        <span className="mt-0.5 block text-text-tertiary">{tool.description}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {server.problems.length > 0 && (
            <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-4 text-xs text-text-tertiary">
              {server.problems.map((problem, index) => (
                <li key={index}>Left out: {problem}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </article>
  );
}

/**
 * Names first, values on request. The values are the user's — or the
 * repository's — to see, but often include a token, and this screen is
 * one people share.
 */
function EnvironmentList({ env }: { env: Readonly<Record<string, string>> }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {Object.entries(env).map(([name, value]) => (
        <code key={name} className="break-all font-mono text-text-primary">
          {name}={shown ? value : "•••"}
        </code>
      ))}
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        className={clsx(
          "inline-flex items-center gap-1 rounded px-1 text-text-tertiary hover:text-text-primary",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        )}
      >
        {shown ? <EyeOff size={11} /> : <Eye size={11} />}
        {shown ? "Hide values" : "Show values"}
      </button>
    </span>
  );
}

export function describeState(server: Pick<ConnectedServerView, "approval" | "state" | "tools">): {
  tone: StatusTone;
  label: string;
} {
  if (server.approval === "changed") return { tone: "warning", label: "Changed — check again" };
  if (server.approval === "not-approved") return { tone: "warning", label: "Needs your OK" };
  switch (server.state.kind) {
    case "needs-approval":
      return { tone: "warning", label: "Needs your OK" };
    case "waiting":
      return { tone: "neutral", label: "Allowed — not running" };
    case "stopped":
      return { tone: "neutral", label: "Stopped" };
    case "starting":
      return { tone: "info", label: "Starting…" };
    case "running": {
      const enabled = server.tools.filter((tool) => tool.enabled).length;
      return {
        tone: "success",
        label: `Running · ${enabled} of ${server.tools.length} ${server.tools.length === 1 ? "tool" : "tools"} on`,
      };
    }
    case "failed":
      return { tone: "danger", label: "Couldn't run" };
  }
}

/**
 * The command as a person would type it, for reading only — it is never
 * run in this form. Arguments with spaces or quotes are quoted, so
 * `["a b"]` and `["a", "b"]` look different, as they are.
 */
export function describeCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(quoteForDisplay).join(" ");
}

function quoteForDisplay(part: string): string {
  if (part.length > 0 && !/[\s"']/.test(part)) return part;
  return `"${part.replace(/(["\\])/g, "\\$1")}"`;
}
