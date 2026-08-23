import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";

function createServer() {
	const server = new McpServer({
		name: "UUID and Time Tools",
		version: "1.0.0",
	});

	server.registerTool(
		"generate_uuid_from_seed",
		{
			description:
				"Generate a deterministic UUID v5 from a seed. The same seed always returns the same UUID.",
			inputSchema: z.object({
				seed: z.string().min(1).describe("Any non-empty text to use as the UUID seed."),
			}),
		},
		async ({ seed }) => {
			const uuid = uuidv5(seed, uuidv5.URL);

			return {
				content: [{ type: "text", text: uuid }],
			};
		},
	);

	server.registerTool(
		"get_unix_timestamp",
		{
			description:
				"Return the current Unix timestamp as whole seconds since 1970-01-01T00:00:00Z.",
			inputSchema: z.object({}),
		},
		async () => {
			const timestamp = Math.floor(Date.now() / 1000);

			return {
				content: [{ type: "text", text: String(timestamp) }],
			};
		},
	);

	return server;
}

const handler = createMcpHandler(createServer);

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return handler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
