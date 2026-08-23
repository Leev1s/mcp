import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";

const STATUS_HEADERS = {
	"Cache-Control": "no-store, no-cache, must-revalidate",
	"Content-Type": "text/plain; charset=utf-8",
	"X-Content-Type-Options": "nosniff",
	"X-Robots-Tag": "noindex, nofollow",
};

function createLandingPage(request: Request) {
	const origin = new URL(request.url).origin;
	const checkedAt = new Date().toISOString();
	const ray = request.headers.get("cf-ray") ?? "local";

	return `${String.raw`
 __  __   ____   ____
|  \/  | / ___| |  _ \
| |\/| || |     | |_) |
| |  | || |___  |  __/
|_|  |_| \____| |_|
`.trim()}

MCP WORKER // ONLINE
--------------------
service  : UUID + Unix Time Tools
mcp      : ${origin}/mcp
health   : ${origin}/204

tools
  - generate_uuid_from_seed
  - get_unix_timestamp

checked  : ${checkedAt}
cf-ray   : ${ray}
`;
}

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
		const url = new URL(request.url);
		const isReadRequest = request.method === "GET" || request.method === "HEAD";

		if (isReadRequest && url.pathname === "/") {
			return new Response(request.method === "HEAD" ? null : createLandingPage(request), {
				headers: STATUS_HEADERS,
			});
		}

		if (isReadRequest && url.pathname === "/204") {
			return new Response(null, {
				status: 204,
				headers: { "Cache-Control": "no-store" },
			});
		}

		return handler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
