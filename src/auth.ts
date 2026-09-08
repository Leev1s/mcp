import { timingSafeEqual } from "node:crypto";

export async function authorizeMcp(request: Request, key?: string): Promise<Response | null> {
	const headers = { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };
	if (!key || !/^[a-f0-9]{64}$/.test(key))
		return new Response("MCP authentication is not configured.", { status: 503, headers });
	const match = /^\/mcp\/([a-f0-9]{64})$/.exec(new URL(request.url).pathname);
	const digest = (value: string) =>
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	const [provided, expected] = await Promise.all([digest(match?.[1] ?? ""), digest(key)]);
	if (!match || !timingSafeEqual(new Uint8Array(provided), new Uint8Array(expected))) {
		return new Response("Not Found", { status: 404, headers });
	}
	return null;
}
