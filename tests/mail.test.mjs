import { test, mock } from "node:test";
import assert from "node:assert/strict";
import PostalMime from "postal-mime";
import { authorizeMcp } from "../src/auth.ts";

let instance;
class FakeImap {
	constructor(options) {
		this.options = options;
		instance = this;
	}
	on() {}
	async connect() {}
	close() {
		this.closed = true;
	}
	async mailboxOpen(path, options) {
		assert.equal(options.readOnly, true);
		return { uidValidity: 7n };
	}
	async search() {
		return [1, 2, 3];
	}
	async fetchAll(uids) {
		return uids.map((uid) => ({ uid, flags: new Set(), size: 100 }));
	}
	async fetchOne(uid, query) {
		return query.size ? { size: 100 } : { source: Buffer.from("Subject: hello\r\n\r\nbody") };
	}
	async list() {
		return [{ path: "Drafts", specialUse: "\\Drafts" }];
	}
	async append(path, source, flags) {
		this.appended = { path, source, flags };
		return { uid: 9, uidValidity: 7n };
	}
}
mock.module("imapflow", { namedExports: { ImapFlow: FakeImap } });
const { composeDraft, registerMailTools } = await import("../src/mail.ts");
const env = {
	IMAP_SERVER: "imap.example.com",
	IMAP_ACCOUNT: "me@example.com",
	IMAP_SECRET: "secret",
};
function registry(config = env) {
	const tools = {};
	registerMailTools(
		{
			registerTool(name, definition, callback) {
				tools[name] = (args) => callback(definition.inputSchema.parse(args));
			},
		},
		config,
	);
	return tools;
}
const value = (response) => JSON.parse(response.content[0].text);

test("empty search never fetches every message", async () => {
	const search = mock.method(FakeImap.prototype, "search", async () => []);
	const fetch = mock.method(FakeImap.prototype, "fetchAll", async () => {
		throw new Error("must not fetch");
	});
	try {
		assert.deepEqual(value(await registry().find_email({})).messages, []);
		assert.equal(fetch.mock.callCount(), 0);
	} finally {
		search.mock.restore();
		fetch.mock.restore();
	}
});

test("missing Drafts folder never writes", async () => {
	const list = mock.method(FakeImap.prototype, "list", async () => []);
	const append = mock.method(FakeImap.prototype, "append");
	try {
		assert.equal(
			(await registry().draft_email({ to: ["you@example.com"], subject: "Hi", text: "" }))
				.isError,
			true,
		);
		assert.equal(append.mock.callCount(), 0);
	} finally {
		list.mock.restore();
		append.mock.restore();
	}
});

test("private URL fails closed and rejects old Bearer and query credentials", async () => {
	const key = "a".repeat(64);
	const request = (path) =>
		new Request("https://example.com" + path, { headers: { Authorization: "Bearer " + key } });
	assert.equal((await authorizeMcp(request("/mcp/" + key), undefined)).status, 503);
	for (const path of [
		"/mcp",
		"/mcp?key=" + key,
		"/mcp/" + "b".repeat(64),
		"/mcp/" + key + "/",
		"/mcp/short",
	]) {
		assert.equal((await authorizeMcp(request(path), key)).status, 404);
	}
	assert.equal(await authorizeMcp(new Request("https://example.com/mcp/" + key), key), null);
});
test("Unicode MIME round trip and address injection rejection", async () => {
	const subject = "中文测试标题".repeat(20);
	const mail = await PostalMime.parse(
		composeDraft(
			"me@example.com",
			["you@example.com"],
			subject,
			"第一行\n第二行",
			"id@example.com",
		),
	);
	assert.equal(mail.subject, subject);
	assert.match(mail.text, /第一行\r?\n第二行/);
	assert.throws(() => composeDraft("me@example.com\r\nBcc: bad@example.com", [], "a", "b", "id"));
});
test("search paginates newest first and closes TLS connection", async () => {
	const result = value(await registry().find_email({ limit: 2 }));
	assert.deepEqual(
		result.messages.map((m) => m.uid),
		[3, 2],
	);
	assert.equal(result.next_before_uid, 2);
	assert.equal(instance.options.secure, true);
	assert.equal(instance.options.logger, false);
	assert.equal(instance.closed, true);
});
test("read verifies UIDVALIDITY, parses source, closes connection", async () => {
	assert.equal((await registry().read_email({ uid: 1, uid_validity: "8" })).isError, true);
	const result = value(await registry().read_email({ uid: 1, uid_validity: "7" }));
	assert.equal(result.subject, "hello");
	assert.equal(instance.closed, true);
});
test("draft appends Draft flag, never sends, and rejects header injection", async () => {
	const tools = registry();
	const result = value(
		await tools.draft_email({ to: ["you@example.com"], subject: "Hi", text: "Hello" }),
	);
	assert.equal(result.sent, false);
	assert.equal(instance.appended.path, "Drafts");
	assert.ok(instance.appended.flags.includes("\\Draft"));
	assert.throws(() =>
		tools.draft_email({ to: ["you@example.com"], subject: "Hi\r\nBcc: x", text: "" }),
	);
});
test("missing config returns safe tool error", async () => {
	assert.equal((await registry({}).find_email({})).isError, true);
});
test("oversized mail is rejected before fetching body", async () => {
	const stub = mock.method(FakeImap.prototype, "fetchOne", async () => ({
		size: 3 * 1024 * 1024,
	}));
	try {
		assert.equal((await registry().read_email({ uid: 1, uid_validity: "7" })).isError, true);
		assert.equal(stub.mock.callCount(), 1);
	} finally {
		stub.mock.restore();
	}
});
test("raw server errors do not leak secrets", async () => {
	const stub = mock.method(FakeImap.prototype, "connect", async () => {
		throw new Error("private-password");
	});
	try {
		const response = await registry().find_email({});
		assert.equal(response.isError, true);
		assert.ok(!JSON.stringify(response).includes("private-password"));
		assert.equal(instance.closed, true);
	} finally {
		stub.mock.restore();
	}
});
