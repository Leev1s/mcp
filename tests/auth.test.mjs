import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createConsent,
	validConsent,
	handleAuthorize,
	OAUTH_ORIGIN,
	MCP_SCOPE,
} from "../src/auth.ts";

const password = "test-only-passphrase-" + "x".repeat(32);
const query = "?client_id=test&state=original";
const auth = {
	responseType: "code",
	clientId: "test",
	redirectUri: "https://client.example/callback",
	scope: [MCP_SCOPE],
	state: "original",
	codeChallenge: "x".repeat(43),
	codeChallengeMethod: "S256",
};
function fixture(overrides = {}) {
	let grants = 0;
	const env = {
		AUTH_PASSWORD: password,
		AUTH_LIMITER: { limit: async () => ({ success: true }) },
		OAUTH_PROVIDER: {
			parseAuthRequest: async () => ({ ...auth, ...overrides }),
			lookupClient: async () => ({ clientName: '<script>alert("x")</script>' }),
			completeAuthorization: async (options) => {
				grants++;
				assert.equal(options.userId, "owner");
				assert.deepEqual(options.scope, [MCP_SCOPE]);
				return { redirectTo: auth.redirectUri + "?code=example" };
			},
		},
	};
	return { env, grants: () => grants };
}
async function formRequest(env, fields = {}, extraHeaders = {}) {
	const url = OAUTH_ORIGIN + "/authorize" + query;
	const page = await handleAuthorize(new Request(url), env);
	const html = await page.text();
	assert.ok(!html.includes("<script>"));
	assert.ok(html.includes("&lt;script&gt;"));
	assert.ok(page.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
	const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
	return new Request(url, {
		method: "POST",
		headers: {
			Origin: OAUTH_ORIGIN,
			Cookie: page.headers.get("set-cookie").split(";")[0],
			"Content-Type": "application/x-www-form-urlencoded",
			...extraHeaders,
		},
		body: new URLSearchParams({ csrf, password, decision: "approve", ...fields }),
	});
}
test("consent is bound to browser nonce, full OAuth request, expiry and secret", () => {
	const { nonce, cookie } = createConsent(query, password, 1000);
	assert.ok(validConsent(cookie, nonce, query, password, 1001));
	for (const args of [
		[cookie, "a".repeat(43), query, password, 1001],
		[cookie, nonce, query + "&redirect_uri=evil", password, 1001],
		[cookie + "x", nonce, query, password, 1001],
		[cookie, nonce, query, password + "x", 1001],
		[cookie, nonce, query, password, 601000],
	])
		assert.equal(validConsent(...args), false);
});
test("owner password and explicit consent create a grant; cookie is cleared", async () => {
	const { env, grants } = fixture();
	const response = await handleAuthorize(await formRequest(env), env);
	assert.equal(response.status, 303);
	assert.equal(grants(), 1);
	assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
});
test("wrong password, missing CSRF, foreign origin and invalid decision never create grants", async () => {
	for (const [fields, headers] of [
		[{ password: "wrong" }, {}],
		[{ csrf: "" }, {}],
		[{}, { Origin: "https://evil.example" }],
		[{ decision: "other" }, {}],
		[{}, { Cookie: "" }],
	]) {
		const { env, grants } = fixture();
		assert.equal(
			(await handleAuthorize(await formRequest(env, fields, headers), env)).status,
			403,
		);
		assert.equal(grants(), 0);
	}
});
test("deny preserves state and issuer without creating a grant", async () => {
	const { env, grants } = fixture();
	const response = await handleAuthorize(
		await formRequest(env, { decision: "deny", password: "" }),
		env,
	);
	assert.equal(response.status, 303);
	const url = new URL(response.headers.get("location"));
	assert.equal(url.searchParams.get("error"), "access_denied");
	assert.equal(url.searchParams.get("state"), "original");
	assert.equal(url.searchParams.get("iss"), OAUTH_ORIGIN);
	assert.equal(grants(), 0);
});
test("missing config, non-S256 PKCE and unsupported scope fail closed", async () => {
	for (const override of [
		{ codeChallengeMethod: "plain" },
		{ codeChallenge: undefined },
		{ scope: ["send_mail"] },
	]) {
		const { env } = fixture(override);
		assert.equal(
			(await handleAuthorize(new Request(OAUTH_ORIGIN + "/authorize" + query), env)).status,
			400,
		);
	}
	const { env } = fixture();
	delete env.AUTH_PASSWORD;
	assert.equal(
		(await handleAuthorize(new Request(OAUTH_ORIGIN + "/authorize"), env)).status,
		503,
	);
});
test("password attempts are rate limited and form size is bounded", async () => {
	const { env, grants } = fixture();
	const request = await formRequest(env);
	const oversized = await formRequest(env, { password: "x".repeat(9000) });
	assert.equal((await handleAuthorize(oversized, env)).status, 413);
	const denied = { ...env, AUTH_LIMITER: { limit: async () => ({ success: false }) } };
	assert.equal((await handleAuthorize(request, denied)).status, 429);
	assert.equal(grants(), 0);
});
