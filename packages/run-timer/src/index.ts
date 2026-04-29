/**
 * Run Timer Status Extension
 *
 * Displays a footer status line with:
 * - Elapsed working time since the last non-steering user prompt
 * - Duration of the previous completed run
 * - Longest run duration in the current session branch
 *
 * Installation:
 *   Save as ~/.pi/agent/extensions/turn-timer.ts
 *   Then in pi: /reload
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "turn-timer";
const STATE_TYPE = "turn-timer-state";
const PROMPT_PREVIEW_LENGTH = 40;

type TimerState = {
	currentRunStartMs?: number;
	currentRunPrompt?: string;
	previousRunDurationMs?: number;
	longestRunDurationMs?: number;
	longestRunPrompt?: string;
};

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}
	return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function previewPrompt(prompt: string): string {
	const text = prompt.trim().replace(/\s+/g, " ");
	if (text.length <= PROMPT_PREVIEW_LENGTH) return text;
	return `${text.slice(0, PROMPT_PREVIEW_LENGTH - 1)}…`;
}

function isTimerState(value: unknown): value is TimerState {
	if (!value || typeof value !== "object") return false;
	const state = value as TimerState;
	return (
		(state.currentRunStartMs === undefined || typeof state.currentRunStartMs === "number") &&
		(state.currentRunPrompt === undefined || typeof state.currentRunPrompt === "string") &&
		(state.previousRunDurationMs === undefined || typeof state.previousRunDurationMs === "number") &&
		(state.longestRunDurationMs === undefined || typeof state.longestRunDurationMs === "number") &&
		(state.longestRunPrompt === undefined || typeof state.longestRunPrompt === "string")
	);
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;

	// A "run" here = one continuous busy period from the first agent_start after
	// idle until agent_end with no pending messages. Steering/follow-up prompts are
	// included in the same run.
	let currentRunStartMs: number | undefined;
	let currentRunPrompt: string | undefined;
	let previousRunDurationMs: number | undefined;
	let longestRunDurationMs: number | undefined;
	let longestRunPrompt: string | undefined;

	let lastRendered: string | undefined;
	let lastCtx: ExtensionContext | undefined;

	function getState(): TimerState {
		return {
			currentRunStartMs,
			currentRunPrompt,
			previousRunDurationMs,
			longestRunDurationMs,
			longestRunPrompt,
		};
	}

	function applyState(state: TimerState): void {
		currentRunStartMs = state.currentRunStartMs;
		currentRunPrompt = state.currentRunPrompt;
		previousRunDurationMs = state.previousRunDurationMs;
		longestRunDurationMs = state.longestRunDurationMs;
		longestRunPrompt = state.longestRunPrompt;
	}

	function saveState(): void {
		pi.appendEntry(STATE_TYPE, getState());
	}

	function restoreState(ctx: ExtensionContext): void {
		for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
			if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
			if (isTimerState(entry.data)) {
				applyState(entry.data);
			}
			return;
		}
	}

	function stopTimer(): void {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
	}

	function startTimer(): void {
		stopTimer();
		timer = setInterval(() => render(), 1000);
	}

	function render(): void {
		const ctx = lastCtx;
		if (!ctx || !ctx.hasUI) return;

		const theme = ctx.ui.theme;
		const startMs = currentRunStartMs;
		const working = startMs !== undefined;

		const elapsed = startMs !== undefined ? formatDuration(Date.now() - startMs) : "idle";
		const prev = previousRunDurationMs !== undefined ? formatDuration(previousRunDurationMs) : "--:--";
		const max = longestRunDurationMs !== undefined ? formatDuration(longestRunDurationMs) : "--:--";

		const indicator = working ? theme.fg("accent", "●") : theme.fg("dim", "○");
		const elapsedText = working ? theme.fg("text", elapsed) : theme.fg("dim", elapsed);
		const promptPreview = longestRunPrompt ? ` (${longestRunPrompt})` : "";
		const stats = theme.fg("dim", `  prev ${prev}  max ${max}${promptPreview}`);

		const status = `${indicator} ${elapsedText}${stats}`;
		if (status === lastRendered) return;
		lastRendered = status;

		ctx.ui.setStatus(STATUS_KEY, status);
	}

	pi.on("session_start", (_event, ctx) => {
		lastCtx = ctx;
		stopTimer();
		lastRendered = undefined;
		restoreState(ctx);
		if (currentRunStartMs !== undefined) startTimer();
		render();
	});

	pi.on("before_agent_start", (event, ctx) => {
		lastCtx = ctx;
		if (event.prompt) currentRunPrompt = previewPrompt(event.prompt);
	});

	pi.on("agent_start", (_event, ctx) => {
		lastCtx = ctx;
		if (!ctx.hasUI) return;

		if (currentRunStartMs === undefined) {
			currentRunStartMs = Date.now();
			startTimer();
			saveState();
		}

		render();
	});

	pi.on("agent_end", (_event, ctx) => {
		lastCtx = ctx;
		if (!ctx.hasUI) return;
		if (currentRunStartMs === undefined) {
			render();
			return;
		}

		if (ctx.hasPendingMessages()) {
			render();
			return;
		}

		const duration = Date.now() - currentRunStartMs;
		previousRunDurationMs = duration;

		if (longestRunDurationMs === undefined || duration > longestRunDurationMs) {
			longestRunDurationMs = duration;
			longestRunPrompt = currentRunPrompt;
		}

		currentRunStartMs = undefined;
		currentRunPrompt = undefined;
		stopTimer();
		saveState();
		render();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		lastCtx = ctx;
		saveState();
		stopTimer();
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
