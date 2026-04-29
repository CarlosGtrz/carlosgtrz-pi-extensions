import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createAssistantMessageEventStream, getModels, streamSimple } from "@mariozechner/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	Model,
	OAuthCredentials,
	OAuthLoginCallbacks,
} from "@mariozechner/pi-ai";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const BUILTIN_CODEX_PROVIDER = "openai-codex";

const ALIASES = [
	{ id: "openai-codex-personal", name: "ChatGPT Plus/Pro (Codex Subscription) - Personal" },
	{ id: "openai-codex-work", name: "ChatGPT Plus/Pro (Codex Subscription) - Work" },
] as const;

const CODEX_ENV_KEYS = [
	"OPENAI_CODEX_OAUTH_TOKEN",
	"OPENAI_CODEX_ACCESS_TOKEN",
	"OPENAI_CODEX_ACCOUNT_ID",
	"CHATGPT_ACCOUNT_ID",
] as const;
const [OAUTH_TOKEN_ENV, ACCESS_TOKEN_ENV, ACCOUNT_ID_ENV, CHATGPT_ACCOUNT_ID_ENV] = CODEX_ENV_KEYS;

type CodexEnvKey = (typeof CODEX_ENV_KEYS)[number];

type OpenAICodexOAuth = {
	loginOpenAICodex(options: {
		onAuth: OAuthLoginCallbacks["onAuth"];
		onPrompt: OAuthLoginCallbacks["onPrompt"];
		onProgress?: OAuthLoginCallbacks["onProgress"];
		onManualCodeInput?: OAuthLoginCallbacks["onManualCodeInput"];
		originator?: string;
	}): Promise<OAuthCredentials>;
	refreshOpenAICodexToken(refreshToken: string): Promise<OAuthCredentials>;
};

export default async function codexAliases(pi: ExtensionAPI) {
	const oauth = await loadOpenAICodexOAuth();
	for (const alias of ALIASES) {
		registerCodexAlias(pi, alias.id, alias.name, oauth);
	}

	const originalSubBarEnv = Object.fromEntries(
		CODEX_ENV_KEYS.map((key) => [key, process.env[key]]),
	) as Record<CodexEnvKey, string | undefined>;
	let ownsSubBarEnv = false;

	function restoreSubBarEnv(): boolean {
		if (!ownsSubBarEnv) return false;

		for (const key of CODEX_ENV_KEYS) {
			const value = originalSubBarEnv[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		ownsSubBarEnv = false;
		return true;
	}

	function isAliasProvider(provider: string | undefined): provider is (typeof ALIASES)[number]["id"] {
		return provider !== undefined && ALIASES.some((alias) => alias.id === provider);
	}

	function syncSubBarCodexEnv(ctx: Pick<ExtensionContext, "model" | "modelRegistry">) {
		const provider = ctx.model?.provider;
		if (!isAliasProvider(provider)) return restoreSubBarEnv();

		const credentials = ctx.modelRegistry?.authStorage?.get(provider);
		if (!credentials || credentials.type !== "oauth" || typeof credentials.access !== "string") {
			return restoreSubBarEnv();
		}

		process.env[OAUTH_TOKEN_ENV] = credentials.access;
		process.env[ACCESS_TOKEN_ENV] = credentials.access;
		if (typeof credentials.accountId === "string") {
			process.env[ACCOUNT_ID_ENV] = credentials.accountId;
			process.env[CHATGPT_ACCOUNT_ID_ENV] = credentials.accountId;
		} else {
			delete process.env[ACCOUNT_ID_ENV];
			delete process.env[CHATGPT_ACCOUNT_ID_ENV];
		}
		ownsSubBarEnv = true;
		return true;
	}

	function refreshSubBarSoon() {
		setTimeout(() => pi.events.emit("sub-core:action", { type: "refresh", force: true }), 0);
		setTimeout(() => pi.events.emit("sub-core:action", { type: "refresh", force: true }), 250);
	}

	function syncAndRefresh(_event: unknown, ctx: Pick<ExtensionContext, "model" | "modelRegistry">) {
		if (syncSubBarCodexEnv(ctx)) refreshSubBarSoon();
	}

	function syncOnly(_event: unknown, ctx: Pick<ExtensionContext, "model" | "modelRegistry">) {
		syncSubBarCodexEnv(ctx);
	}

	pi.on("session_start", syncAndRefresh);
	pi.on("model_select", syncAndRefresh);
	pi.on("before_agent_start", syncOnly);
	pi.on("turn_start", syncOnly);

	pi.on("session_shutdown", async () => {
		restoreSubBarEnv();
	});
}

async function loadOpenAICodexOAuth(): Promise<OpenAICodexOAuth> {
	// Pi's extension loader resolves @mariozechner/pi-ai from Pi's own install,
	// but static subpath imports like @mariozechner/pi-ai/oauth are not always
	// resolved correctly by the TS loader. Try the subpath first, then fall back to
	// likely dist/oauth.js locations for global npm installs on Windows/Linux/WSL.
	try {
		const oauth = (await import("@mariozechner/pi-ai/oauth")) as Partial<OpenAICodexOAuth>;
		if (hasOpenAICodexOAuth(oauth)) return oauth;
	} catch {
		// Fall through to path-based resolution.
	}

	const candidates = getOAuthCandidates();
	const oauthPath = candidates.find((candidate) => existsSync(candidate));
	if (!oauthPath) {
		throw new Error(`Could not locate Pi's @mariozechner/pi-ai oauth.js. Tried: ${candidates.join(", ")}`);
	}

	const oauth = (await import(pathToFileURL(oauthPath).href)) as Partial<OpenAICodexOAuth>;
	if (typeof oauth.loginOpenAICodex !== "function" || typeof oauth.refreshOpenAICodexToken !== "function") {
		throw new Error(`Pi's @mariozechner/pi-ai oauth.js does not expose the required OpenAI Codex OAuth helpers: ${oauthPath}`);
	}

	return oauth as OpenAICodexOAuth;
}

function hasOpenAICodexOAuth(oauth: Partial<OpenAICodexOAuth>): oauth is OpenAICodexOAuth {
	return typeof oauth.loginOpenAICodex === "function" && typeof oauth.refreshOpenAICodexToken === "function";
}

function addCandidate(candidates: string[], candidate: string | undefined) {
	if (!candidate || candidates.includes(candidate)) return;
	candidates.push(candidate);
}

function getOAuthCandidates(): string[] {
	const candidates: string[] = [];

	try {
		const require = createRequire(import.meta.url);
		addCandidate(candidates, join(dirname(require.resolve("@mariozechner/pi-ai")), "oauth.js"));
	} catch {
		// The extension's own package.json may not depend on pi-ai. That's OK.
	}

	const argvPaths = [process.argv[1]];
	if (process.argv[1]) {
		try {
			argvPaths.push(realpathSync(process.argv[1]));
		} catch {
			// Ignore non-resolvable launcher paths.
		}
	}

	for (const argvPath of argvPaths) {
		if (!argvPath) continue;
		const binDir = dirname(argvPath);
		const packageRoot = dirname(binDir);
		const packageParent = dirname(packageRoot);

		addCandidate(candidates, join(packageRoot, "node_modules", "@mariozechner", "pi-ai", "dist", "oauth.js"));
		addCandidate(candidates, join(packageParent, "node_modules", "@mariozechner", "pi-ai", "dist", "oauth.js"));
		addCandidate(candidates, join(binDir, "node_modules", "@mariozechner", "pi-ai", "dist", "oauth.js"));
	}

	addCandidate(candidates, "/usr/local/lib/node_modules/@mariozechner/pi-ai/dist/oauth.js");
	addCandidate(candidates, "/usr/lib/node_modules/@mariozechner/pi-ai/dist/oauth.js");

	return candidates;
}

function registerCodexAlias(pi: ExtensionAPI, providerId: string, displayName: string, oauth: OpenAICodexOAuth) {
	const api = `${providerId}-responses`;
	const models = getModels(BUILTIN_CODEX_PROVIDER).map((model) => ({
		id: model.id,
		name: `${model.name ?? model.id} (${displayName})`,
		api,
		reasoning: model.reasoning,
		input: [...model.input],
		cost: { ...model.cost },
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		compat: model.compat,
	}));

	pi.registerProvider(providerId, {
		baseUrl: CODEX_BASE_URL,
		api,
		models,
		streamSimple(model, context, options) {
			// Pi resolves the OAuth token for the alias provider before calling this
			// function. The built-in Codex stream has a few provider-name checks for
			// Codex tool-call/replay compatibility, so call it with provider rewritten
			// to the built-in provider while preserving the alias token in options.
			const codexModel = {
				...model,
				provider: BUILTIN_CODEX_PROVIDER,
				api: "openai-codex-responses",
				baseUrl: model.baseUrl ?? CODEX_BASE_URL,
			} as Model<"openai-codex-responses">;

			const inner = streamSimple(codexModel, context, options);
			const outer = createAssistantMessageEventStream();

			void (async () => {
				for await (const event of inner) {
					outer.push(rewriteEventProvider(event, providerId));
				}
			})();

			return outer;
		},
		oauth: {
			name: displayName,
			async login(callbacks) {
				return oauth.loginOpenAICodex({
					onAuth: callbacks.onAuth,
					onPrompt: callbacks.onPrompt,
					onProgress: callbacks.onProgress,
					onManualCodeInput: callbacks.onManualCodeInput,
					originator: "pi",
				});
			},
			async refreshToken(credentials) {
				return oauth.refreshOpenAICodexToken(credentials.refresh);
			},
			getApiKey(credentials) {
				return credentials.access;
			},
		},
	});
}

function rewriteEventProvider(event: AssistantMessageEvent, providerId: string): AssistantMessageEvent {
	const eventWithMessages = event as AssistantMessageEvent & {
		partial?: AssistantMessage;
		message?: AssistantMessage;
		error?: AssistantMessage;
	};

	if (eventWithMessages.partial) eventWithMessages.partial.provider = providerId;
	if (eventWithMessages.message) eventWithMessages.message.provider = providerId;
	if (eventWithMessages.error) eventWithMessages.error.provider = providerId;

	return event;
}
