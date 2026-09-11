// Generates a new owner password; only an authenticated Wrangler operator can run this.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = root + ".private";
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const password = randomBytes(32).toString("base64url");
const pending = directory + "/oauth-password.pending";
writeFileSync(pending, password + "\n", { mode: 0o600, flag: "wx" });
const result = spawnSync("npx", ["wrangler", "secret", "put", "AUTH_PASSWORD"], {
	cwd: root,
	input: password,
	encoding: "utf8",
	stdio: ["pipe", "pipe", "pipe"],
});
if (result.status !== 0) {
	console.error(
		"Secret upload failed or is uncertain. The pending password is saved privately; inspect Wrangler status before retrying.",
	);
	process.exitCode = 1;
} else {
	renameSync(pending, directory + "/oauth-password");
	console.log(
		"AUTH_PASSWORD updated. Private backup: .private/oauth-password (600). Save it in your password manager. Existing OAuth clients must reauthorize.",
	);
}
