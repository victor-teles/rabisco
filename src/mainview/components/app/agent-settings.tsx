import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, isDesktop } from "@/lib/rpc";
import type { AgentServerStatus } from "../../../shared/mcp/tools";

export function AgentSettings() {
	const [status, setStatus] = useState<AgentServerStatus | null>(null);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		let live = true;

		api
			.agentServerStatus({})
			.then((next) => live && setStatus(next))
			.catch(() => live && setStatus({ enabled: false, port: null }));

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

	return (
		<div className="border-t px-6 py-4">
			<label className="flex items-start justify-between gap-6">
				<span className="flex flex-col gap-0.5">
					<span className="text-sm font-medium">Let coding agents use Rabisco</span>
					<span className="text-[13px] text-muted-foreground">
						Claude Code, Codex, Cursor and other MCP clients on this Mac can read the open project, the selection and
						screenshots. Only apps on this computer can connect.
					</span>
					{enabled && status?.port ? (
						<span className="text-[13px] text-muted-foreground">MCP server on 127.0.0.1:{status.port}</span>
					) : null}
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
						Agents connected now lose access and connect again with a new token.
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
		</div>
	);
}
