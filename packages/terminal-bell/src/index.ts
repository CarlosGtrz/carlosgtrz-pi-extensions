import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_TIMEOUT_SECONDS = "5";

function ringBell() {
  // ASCII BEL - most terminals play a sound or show a visual bell.
  // Use stderr so the bell does not interfere with normal stdout output.
  if (process.stderr.isTTY) {
    process.stderr.write("\x07");
  }
}

export default function (pi: ExtensionAPI) {
  let agentStartedAt = 0;

  pi.registerFlag("terminal-bell-timeout", {
    description:
      "Minimum agent duration in seconds before ringing the terminal bell. Use -1 to disable.",
    type: "string",
    default: DEFAULT_TIMEOUT_SECONDS,
  });

  pi.on("agent_start", () => {
    agentStartedAt = Date.now();
  });

  // Fires once a prompt is fully processed (after all tool calls and streaming).
  pi.on("agent_end", (_event, ctx) => {
    if (!ctx.hasUI) return;

    const timeoutSeconds = Number(pi.getFlag("terminal-bell-timeout"));
    if (timeoutSeconds < 0) return;

    const elapsedSeconds = (Date.now() - agentStartedAt) / 1000;
    if (elapsedSeconds >= timeoutSeconds) {
      ringBell();
    }
  });
}
