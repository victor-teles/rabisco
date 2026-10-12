import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, isDesktop } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import type { AgentClientId, AgentClientStatus } from "../../../shared/mcp/clients";
import type { AgentServerStatus } from "../../../shared/mcp/tools";

const REFRESH_MS = 5000;

export function AgentSettings() {
	const [status, setStatus] = useState<AgentServerStatus | null>(null);
	const [pending, setPending] = useState(false);
	const [unknown, setUnknown] = useState(false);

	useEffect(() => {
		let live = true;

		api
			.agentServerStatus({})
			.then((next) => live && setStatus(next))
			.catch(() => live && setUnknown(true));

		return () => {
			live = false;
		};
	}, []);

	if (!isDesktop) return null;

	const apply = async (request: () => Promise<AgentServerStatus>, failure: string) => {
		setPending(true);

		try {
			setStatus(await request());
		} catch (error) {
			toast.error(failure, { description: String(error) });
		} finally {
			setPending(false);
		}
	};

	const enabled = status?.enabled ?? false;

	const note = unknown
		? "Couldn't check this setting. Close Settings and open it again."
		: enabled && !status?.port
			? "Couldn't start. Turn it off and on to try again."
			: enabled
				? `MCP server on 127.0.0.1:${status?.port}`
				: null;

	return (
		<div className="border-t px-6 py-4">
			<h3 className="mb-3 text-xs font-medium text-muted-foreground">Agents</h3>
			<label className="flex items-start justify-between gap-6">
				<span className="flex flex-col gap-0.5">
					<span className="text-sm font-medium">Let coding agents use Rabisco</span>
					<span className="text-[13px] text-muted-foreground">
						Claude Code, Codex, Cursor and other MCP clients can read the open project, the selection and screenshots.
						Only apps on this computer can connect.
					</span>
					{note ? <span className="text-[13px] text-muted-foreground">{note}</span> : null}
				</span>
				<Switch
					className="mt-0.5"
					checked={enabled}
					disabled={status === null || pending}
					onCheckedChange={(on) =>
						apply(() => api.setAgentServer({ enabled: on }), on ? "Couldn't start the MCP server" : "Couldn't stop it")
					}
				/>
			</label>
			{enabled ? (
				<div className="mt-3 flex items-center justify-between gap-6">
					<span className="text-[13px] text-muted-foreground">
						Disconnects every agent. Agents set up with Rabisco reconnect on their next call.
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={pending}
						onClick={() =>
							void apply(async () => {
								const next = await api.resetAgentAccess({});
								toast("Access reset");

								return next;
							}, "Couldn't reset access")
						}
					>
						Reset access
					</Button>
				</div>
			) : null}
			{enabled ? <AgentClients /> : null}
		</div>
	);
}

function clientText({ name, detected, setup, connected }: AgentClientStatus) {
	if (connected) return "Connected";

	if (setup === "current") return `Set up. Restart ${name} to connect.`;

	if (setup === "outdated") return "Set up for another copy of Rabisco";

	return detected ? "Not set up" : "Not found on this computer";
}

/** One click writes the `rabisco` server into the client's config; the config holds no token (decision 0030) */
function AgentClients() {
	const [clients, setClients] = useState<AgentClientStatus[] | null>(null);
	const [busy, setBusy] = useState<AgentClientId | null>(null);

	useEffect(() => {
		let live = true;

		const refresh = () =>
			api
				.agentClients({})
				.then((next) => live && setClients(next))
				.catch(() => live && setClients([]));

		void refresh();
		const timer = setInterval(refresh, REFRESH_MS);

		return () => {
			live = false;
			clearInterval(timer);
		};
	}, []);

	if (!clients?.length) return null;

	const change = async (client: AgentClientStatus, remove: boolean) => {
		setBusy(client.id);

		try {
			setClients(await (remove ? api.removeAgentClient : api.setUpAgentClient)({ id: client.id }));

			if (!remove) toast(`${client.name} is set up`, { description: `Restart ${client.name} to connect.` });
		} catch (error) {
			toast.error(remove ? `Couldn't remove Rabisco from ${client.name}` : `Couldn't set up ${client.name}`, {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(null);
		}
	};

	return (
		<ul aria-label="Coding agents" className="mt-4 flex flex-col divide-y rounded-md border">
			{clients.map((client) => (
				<li key={client.id} className="flex items-center gap-3 px-3 py-2">
					<span
						aria-hidden="true"
						className={cn(
							"size-2 shrink-0 rounded-full",
							client.connected ? "bg-success" : client.setup === "none" ? "bg-border-strong" : "bg-muted-foreground",
						)}
					/>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="text-sm">{client.name}</span>
						<span className="text-[13px] text-muted-foreground">{clientText(client)}</span>
					</span>
					{client.setup === "current" ? (
						<Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void change(client, true)}>
							Remove
						</Button>
					) : (
						<Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void change(client, false)}>
							{client.setup === "outdated" ? "Update" : "Set up"}
						</Button>
					)}
				</li>
			))}
		</ul>
	);
}
