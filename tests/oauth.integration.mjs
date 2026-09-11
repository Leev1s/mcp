// Real workerd + official OAuth Provider. No production state or email access.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const origin = "https://r3.net.eu.org";
const password = "local-integration-only-" + randomBytes(32).toString("base64url");
const options = {
	modules: true,
	scriptPath: ".wrangler/oauth-build/index.js",
	compatibilityDate: "2026-07-02",
	compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
	kvNamespaces: ["OAUTH_KV"],
	ratelimits: { AUTH_LIMITER: { namespace_id: "1", simple: { limit: 1000, period: 60 } } },
	bindings: { AUTH_PASSWORD: password },
	outboundService: async (request) => {
		if (request.url !== "https://client.example/oauth.json")
			return new Response(null, { status: 503 });
		return Response.json({
			client_id: request.url,
			client_name: "CIMD test",
			redirect_uris: ["https://client.example/callback"],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		});
	},
};
const mf = new Miniflare(convertV4MiniflareOptions(options));
const request = (path, options = {}) =>
	mf.dispatchFetch(origin + path, { redirect: "manual", ...options });
const form = (params) => ({ method: "POST", body: new URLSearchParams(params) });
try {
	assert.equal((await request("/204")).status, 204);
	assert.equal((await request("/mcp/" + "a".repeat(64))).status, 404);
	assert.equal((await request("/mcp")).status, 401);
	const metadata = await (await request("/.well-known/oauth-authorization-server")).json();
	assert.equal(metadata.issuer, origin);
	assert.ok(metadata.code_challenge_methods_supported.includes("S256"));
	const resource = await (await request("/.well-known/oauth-protected-resource/mcp")).json();
	assert.equal(resource.resource, origin + "/mcp");
	const registration = await request("/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_name: "Local OAuth test",
			redirect_uris: ["https://client.example/callback"],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		}),
	});
	assert.equal(registration.status, 201);
	const { client_id } = await registration.json();
	const verifier = randomBytes(32).toString("base64url");
	const params = new URLSearchParams({
		client_id,
		redirect_uri: "https://client.example/callback",
		response_type: "code",
		scope: "mcp:access",
		state: "test-state",
		resource: origin + "/mcp",
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
	});
	const badRedirect = new URLSearchParams(params);
	badRedirect.set("redirect_uri", "https://evil.example/callback");
	assert.equal((await request("/authorize?" + badRedirect)).status, 400);
	const noPkce = new URLSearchParams(params);
	noPkce.delete("code_challenge");
	assert.equal((await request("/authorize?" + noPkce)).status, 400);
	const page = await request("/authorize?" + params);
	assert.equal(page.status, 200);
	const cookie = page.headers.get("set-cookie").split(";")[0];
	const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)[1];
	const cimd = new URLSearchParams(params);
	cimd.set("client_id", "https://client.example/oauth.json");
	assert.equal((await request("/authorize?" + cimd)).status, 200, "CIMD clients need no DCR");
	const consent = await request("/authorize?" + params, {
		...form({ csrf, password, decision: "approve" }),
		headers: {
			Cookie: cookie,
			Origin: origin,
			"Content-Type": "application/x-www-form-urlencoded",
		},
	});
	assert.equal(consent.status, 303);
	const redirect = new URL(consent.headers.get("location"));
	assert.equal(redirect.searchParams.get("state"), "test-state");
	assert.equal(redirect.searchParams.get("iss"), origin);
	const exchange = {
		grant_type: "authorization_code",
		client_id,
		redirect_uri: "https://client.example/callback",
		code: redirect.searchParams.get("code"),
		code_verifier: verifier,
		resource: origin + "/mcp",
	};
	assert.equal(
		(await request("/token", form({ ...exchange, code_verifier: "wrong".repeat(10) }))).status,
		400,
	);
	const tokenResponse = await request("/token", form(exchange));
	assert.equal(tokenResponse.status, 200);
	let tokens = await tokenResponse.json();
	assert.ok(tokens.refresh_token);
	async function rpc(method, params, accessToken = tokens.access_token) {
		return request("/mcp", {
			method: "POST",
			headers: {
				Authorization: "Bearer " + accessToken,
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
		});
	}
	const listed = await rpc("tools/list", {});
	assert.equal(listed.status, 200);
	const listBody = await listed.text();
	for (const name of [
		"find_email",
		"read_email",
		"draft_email",
		"generate_uuid_from_seed",
		"get_unix_timestamp",
	])
		assert.ok(listBody.includes(name));
	assert.equal(
		(await rpc("tools/call", { name: "get_unix_timestamp", arguments: {} })).status,
		200,
	);
	assert.equal(
		(
			await request(
				"/token",
				form({
					grant_type: "refresh_token",
					client_id,
					refresh_token: tokens.refresh_token,
					resource: "https://evil.example/mcp",
				}),
			)
		).status,
		400,
	);
	const refreshed = await request(
		"/token",
		form({ grant_type: "refresh_token", client_id, refresh_token: tokens.refresh_token }),
	);
	assert.equal(refreshed.status, 200);
	tokens = await refreshed.json();
	assert.equal((await rpc("tools/list", {})).status, 200);
	await mf.setOptions(
		convertV4MiniflareOptions({
			...options,
			bindings: { AUTH_PASSWORD: password + "rotated" },
		}),
	);
	assert.equal(
		(await rpc("tools/list", {})).status,
		401,
		"password rotation blocks previous grants",
	);
	const staleRefresh = await request(
		"/token",
		form({ grant_type: "refresh_token", client_id, refresh_token: tokens.refresh_token }),
	);
	assert.equal(staleRefresh.status, 200);
	tokens = await staleRefresh.json();
	assert.equal(
		(await rpc("tools/list", {})).status,
		401,
		"refresh cannot bypass password rotation",
	);
	await mf.setOptions(convertV4MiniflareOptions(options));
	assert.equal((await rpc("tools/list", {})).status, 200);
	assert.equal(
		(
			await request(
				"/token",
				form({ client_id, token: tokens.refresh_token, token_type_hint: "refresh_token" }),
			)
		).status,
		200,
	);
	assert.equal((await rpc("tools/list", {})).status, 401);
	assert.equal(
		(await request("/token", form(exchange))).status,
		400,
		"authorization codes cannot be reused",
	);
	console.log(
		"OAuth integration passed: discovery, DCR, CIMD, consent, PKCE, redirect validation, code replay, 5 tools, resource binding, password rotation, refresh and revocation.",
	);
} finally {
	await mf.dispose();
}
