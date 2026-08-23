import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";

const BASE_STATUS_HEADERS = {
	"Cache-Control": "no-store, no-cache, must-revalidate",
	"Referrer-Policy": "no-referrer",
	Vary: "Accept",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"X-Robots-Tag": "noindex, nofollow",
};

const TEXT_STATUS_HEADERS = {
	...BASE_STATUS_HEADERS,
	"Content-Type": "text/plain; charset=utf-8",
};

const HTML_STATUS_HEADERS = {
	...BASE_STATUS_HEADERS,
	"Content-Security-Policy":
		"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"Content-Type": "text/html; charset=utf-8",
};

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#039;",
};

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function getStatusContext(request: Request) {
	return {
		origin: new URL(request.url).origin,
		checkedAt: new Date().toISOString(),
		ray: request.headers.get("cf-ray") ?? "local",
	};
}

function createTextStatus(request: Request) {
	const { origin, checkedAt, ray } = getStatusContext(request);

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

function createHtmlStatus(request: Request) {
	const context = getStatusContext(request);
	const origin = escapeHtml(context.origin);
	const checkedAt = escapeHtml(context.checkedAt);
	const ray = escapeHtml(context.ray);

	return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#050807">
  <title>MCP // Edge Console</title>
  <style>
    :root {
      color-scheme: dark;
      --ink: #eafff8;
      --muted: #7f9b92;
      --line: rgba(131, 255, 209, .15);
      --panel: rgba(8, 16, 14, .72);
      --green: #77ffbf;
      --cyan: #58e8ff;
      --violet: #ad7cff;
    }

    * { box-sizing: border-box; }

    html { min-width: 320px; background: #030504; }

    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      overflow-x: hidden;
      color: var(--ink);
      background:
        radial-gradient(circle at 18% 12%, rgba(88, 232, 255, .12), transparent 32rem),
        radial-gradient(circle at 84% 88%, rgba(173, 124, 255, .14), transparent 34rem),
        #030504;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(119, 255, 191, .045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(119, 255, 191, .045) 1px, transparent 1px);
      background-size: 48px 48px;
      mask-image: radial-gradient(circle at center, black 18%, transparent 78%);
    }

    body::after {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .12;
      background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,.06) 4px);
      mix-blend-mode: soft-light;
    }

    .console {
      position: relative;
      width: min(1120px, calc(100% - 32px));
      margin: 32px auto;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 22px;
      background: linear-gradient(145deg, rgba(9, 18, 16, .92), rgba(3, 7, 6, .88));
      box-shadow: 0 35px 100px rgba(0, 0, 0, .65), inset 0 1px rgba(255,255,255,.045);
      backdrop-filter: blur(18px);
    }

    .console::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: 0;
      left: 8%;
      width: 84%;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--cyan), var(--green), var(--violet), transparent);
      box-shadow: 0 0 24px var(--green);
    }

    .chrome {
      min-height: 54px;
      padding: 0 20px;
      display: flex;
      align-items: center;
      gap: 14px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .lights { display: flex; gap: 7px; }
    .lights i { width: 8px; height: 8px; border-radius: 50%; background: #27342f; }
    .lights i:first-child { background: #ff6c78; }
    .lights i:nth-child(2) { background: #ffd36c; }
    .lights i:last-child { background: var(--green); box-shadow: 0 0 13px rgba(119,255,191,.8); }
    .address { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .live {
      margin-left: auto;
      padding: 7px 10px;
      border: 1px solid rgba(119, 255, 191, .25);
      border-radius: 999px;
      color: var(--green);
      background: rgba(119, 255, 191, .055);
    }

    .live::before {
      content: "";
      display: inline-block;
      width: 6px;
      height: 6px;
      margin-right: 7px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 10px currentColor;
      animation: pulse 1.8s ease-in-out infinite;
    }

    .hero {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(280px, .65fr);
      gap: 36px;
      padding: clamp(34px, 6vw, 76px);
      border-bottom: 1px solid var(--line);
    }

    .eyebrow {
      margin: 0 0 22px;
      color: var(--green);
      font-size: 11px;
      letter-spacing: .22em;
    }

    .ascii {
      margin: 0 0 28px;
      color: var(--ink);
      font-size: clamp(8px, 1.3vw, 15px);
      line-height: 1.15;
      letter-spacing: .04em;
      text-shadow: 0 0 25px rgba(88,232,255,.22);
    }

    h1 {
      max-width: 760px;
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      font-size: clamp(42px, 7vw, 88px);
      font-weight: 760;
      line-height: .88;
      letter-spacing: -.065em;
    }

    h1 span {
      color: transparent;
      background: linear-gradient(92deg, var(--green), var(--cyan) 50%, var(--violet));
      background-clip: text;
      -webkit-background-clip: text;
    }

    .lede {
      max-width: 620px;
      margin: 28px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.8;
    }

    .orbital {
      position: relative;
      min-height: 310px;
      display: grid;
      place-items: center;
    }

    .orb {
      position: relative;
      width: min(270px, 70vw);
      aspect-ratio: 1;
      display: grid;
      place-items: center;
      border: 1px solid rgba(88,232,255,.2);
      border-radius: 50%;
      background:
        radial-gradient(circle, rgba(119,255,191,.2), rgba(5,12,10,.8) 34%, transparent 35%),
        conic-gradient(from 90deg, transparent, rgba(88,232,255,.3), transparent 28%, rgba(173,124,255,.3), transparent 58%);
      box-shadow: inset 0 0 60px rgba(88,232,255,.08), 0 0 70px rgba(88,232,255,.08);
      animation: breathe 5s ease-in-out infinite;
    }

    .orb::before, .orb::after {
      content: "";
      position: absolute;
      border: 1px dashed rgba(119,255,191,.28);
      border-radius: 50%;
      animation: spin 18s linear infinite;
    }

    .orb::before { inset: 16px; }
    .orb::after { inset: 48px; animation-direction: reverse; animation-duration: 11s; }

    .core {
      z-index: 1;
      display: grid;
      place-items: center;
      width: 86px;
      height: 86px;
      border: 1px solid rgba(119,255,191,.45);
      border-radius: 24px;
      color: var(--green);
      background: rgba(7,17,14,.92);
      box-shadow: 0 0 35px rgba(119,255,191,.22), inset 0 0 20px rgba(119,255,191,.08);
      font-weight: 700;
      letter-spacing: .14em;
      transform: rotate(45deg);
    }

    .core span { transform: rotate(-45deg); }
    .orbit-label { position: absolute; color: var(--muted); font-size: 9px; letter-spacing: .18em; }
    .orbit-label.top { top: 14px; right: 6%; }
    .orbit-label.bottom { bottom: 12px; left: 4%; }

    .telemetry {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      border-bottom: 1px solid var(--line);
    }

    .metric {
      min-width: 0;
      padding: 22px 24px;
      border-right: 1px solid var(--line);
    }

    .metric:last-child { border-right: 0; }
    .metric small { display: block; margin-bottom: 10px; color: var(--muted); font-size: 9px; letter-spacing: .16em; text-transform: uppercase; }
    .metric strong { display: block; overflow: hidden; color: var(--ink); font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
    .metric .ok { color: var(--green); }

    .grid {
      display: grid;
      grid-template-columns: .85fr 1.15fr;
      gap: 14px;
      padding: 14px;
    }

    .panel {
      min-width: 0;
      padding: 26px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--panel);
    }

    .panel-title { margin: 0 0 20px; color: var(--muted); font-size: 10px; font-weight: 500; letter-spacing: .17em; text-transform: uppercase; }

    .route, .tool {
      display: grid;
      align-items: center;
      gap: 14px;
      padding: 15px 0;
      border-top: 1px solid rgba(131,255,209,.09);
    }

    .route { grid-template-columns: 46px 1fr; }
    .tool { grid-template-columns: 32px minmax(0, 1fr) auto; }
    .route:first-of-type, .tool:first-of-type { border-top: 0; }
    .verb { color: var(--green); font-size: 10px; }
    code { overflow-wrap: anywhere; color: var(--ink); font-family: inherit; font-size: 12px; }
    .index { color: var(--violet); font-size: 10px; }
    .tool-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag { color: var(--muted); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }

    footer {
      padding: 16px 22px;
      display: flex;
      justify-content: space-between;
      gap: 20px;
      border-top: 1px solid var(--line);
      color: #52665f;
      font-size: 9px;
      letter-spacing: .13em;
      text-transform: uppercase;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 50% { opacity: .35; transform: scale(.72); } }
    @keyframes breathe { 50% { transform: scale(1.025); filter: saturate(1.3); } }

    @media (max-width: 820px) {
      .hero { grid-template-columns: 1fr; }
      .orbital { min-height: 250px; }
      .telemetry { grid-template-columns: repeat(2, 1fr); }
      .metric:nth-child(2) { border-right: 0; }
      .metric:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
      .grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 520px) {
      .console { width: min(100% - 16px, 1120px); margin: 8px auto; border-radius: 16px; }
      .chrome { padding: 0 14px; }
      .address { display: none; }
      .hero { padding: 30px 22px; }
      .telemetry { grid-template-columns: 1fr; }
      .metric, .metric:nth-child(2) { border-right: 0; border-bottom: 1px solid var(--line); }
      .metric:last-child { border-bottom: 0; }
      .tool { grid-template-columns: 26px minmax(0, 1fr); }
      .tag { display: none; }
      footer { flex-direction: column; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; }
    }
  </style>
</head>
<body>
  <main class="console">
    <header class="chrome">
      <span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="address">r3.net.eu.org // edge console</span>
      <span class="live">online</span>
    </header>

    <section class="hero">
      <div>
        <p class="eyebrow">Model Context Protocol // Edge Node</p>
        <pre class="ascii" aria-label="MCP"> __  __   ____   ____
|  \/  | / ___| |  _ \
| |\/| || |     | |_) |
| |  | || |___  |  __/
|_|  |_| \____| |_|</pre>
        <h1>Small tools.<br><span>Global edge.</span></h1>
        <p class="lede">A stateless MCP worker carrying deterministic UUID generation and Unix time across Cloudflare's edge. No origin. No session. Just tools.</p>
      </div>

      <div class="orbital" aria-hidden="true">
        <div class="orb"><div class="core"><span>MCP</span></div></div>
        <span class="orbit-label top">STREAMABLE_HTTP</span>
        <span class="orbit-label bottom">EDGE_NATIVE / V1.0</span>
      </div>
    </section>

    <section class="telemetry" aria-label="Runtime telemetry">
      <div class="metric"><small>System state</small><strong class="ok">● Operational</strong></div>
      <div class="metric"><small>Transport</small><strong>Streamable HTTP</strong></div>
      <div class="metric"><small>Cloudflare ray</small><strong>${ray}</strong></div>
      <div class="metric"><small>Checked at</small><strong>${checkedAt}</strong></div>
    </section>

    <section class="grid">
      <article class="panel">
        <h2 class="panel-title">Routes // Public surface</h2>
        <div class="route"><span class="verb">POST</span><code>${origin}/mcp</code></div>
        <div class="route"><span class="verb">GET</span><code>${origin}/204</code></div>
      </article>

      <article class="panel">
        <h2 class="panel-title">Tool registry // 02 active</h2>
        <div class="tool"><span class="index">01</span><code class="tool-name">generate_uuid_from_seed</code><span class="tag">UUID v5</span></div>
        <div class="tool"><span class="index">02</span><code class="tool-name">get_unix_timestamp</code><span class="tag">Epoch sec</span></div>
      </article>
    </section>

    <footer>
      <span>r3.net.eu.org</span>
      <span>No auth // No state // No origin</span>
    </footer>
  </main>
</body>
</html>`;
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
			const wantsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
			const body =
				request.method === "HEAD"
					? null
					: wantsHtml
						? createHtmlStatus(request)
						: createTextStatus(request);

			return new Response(body, {
				headers: wantsHtml ? HTML_STATUS_HEADERS : TEXT_STATUS_HEADERS,
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
