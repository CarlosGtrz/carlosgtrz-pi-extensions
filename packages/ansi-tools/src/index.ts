import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createEditTool, createReadTool, createWriteTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { constants } from "node:fs";
import {
	access as fsAccess,
	mkdir as fsMkdir,
	readFile as fsReadFile,
	writeFile as fsWriteFile,
} from "node:fs/promises";
import iconv from "iconv-lite";

const DEFAULT_ENCODING = "windows-1252";

function normalizeEncoding(enc: string): string {
	return enc.trim().toLowerCase().replace(/[ _]+/g, "-");
}

function requireEncoding(encRaw: string | undefined): string {
	const enc = normalizeEncoding(encRaw ?? DEFAULT_ENCODING);
	if (!iconv.encodingExists(enc)) {
		throw new Error(`Unsupported encoding: ${enc}. (Supported encodings are those provided by iconv-lite)`);
	}
	return enc;
}

function formatCodePoint(ch: string): string {
	const cp = ch.codePointAt(0);
	if (cp === undefined) return "(empty)";
	return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

function strictEncode(text: string, encoding: string): Buffer {
	// iconv-lite will replace unsupported chars. We want a hard error instead.
	const buf = iconv.encode(text, encoding);
	const roundTrip = iconv.decode(buf, encoding);

	if (roundTrip !== text) {
		const a = Array.from(text);
		const b = Array.from(roundTrip);
		const min = Math.min(a.length, b.length);

		let idx = min;
		for (let i = 0; i < min; i++) {
			if (a[i] !== b[i]) {
				idx = i;
				break;
			}
		}

		const orig = a[idx] ?? "";
		const rt = b[idx] ?? "";
		const contextStart = Math.max(0, idx - 20);
		const contextEnd = Math.min(a.length, idx + 20);
		const snippet = a.slice(contextStart, contextEnd).join("");

		throw new Error(
			`Text contains character(s) not representable in encoding '${encoding}'. ` +
				`First mismatch at character #${idx + 1}: '${orig}' (${formatCodePoint(orig)}). ` +
				(rt ? `Round-trip becomes '${rt}' (${formatCodePoint(rt)}). ` : "") +
				`Context: "${snippet}"`,
		);
	}

	return buf;
}

function getExecutionOptions(encRaw: string | undefined, cwd: string | undefined) {
	return {
		encoding: requireEncoding(encRaw),
		cwd: cwd ?? process.cwd(),
	};
}

async function readAnsiFile(absolutePath: string, encoding: string): Promise<Buffer> {
	const raw = await fsReadFile(absolutePath);
	const decoded = iconv.decode(raw, encoding);
	return Buffer.from(decoded, "utf-8");
}

async function writeAnsiFile(absolutePath: string, content: string, encoding: string): Promise<void> {
	const bytes = strictEncode(content, encoding);
	await fsWriteFile(absolutePath, bytes);
}

function parseStringifiedEdits(edits: unknown): unknown {
	if (typeof edits !== "string") return edits;

	try {
		const parsed = JSON.parse(edits);
		return Array.isArray(parsed) ? parsed : edits;
	} catch {
		// Leave invalid JSON unchanged so normal tool argument validation reports it.
		return edits;
	}
}

function prepareEditArguments(input: unknown): any {
	if (!input || typeof input !== "object" || Array.isArray(input)) return input;

	const args = input as Record<string, unknown>;
	const { oldText, newText, ...rest } = args;
	const edits = parseStringifiedEdits(args.edits);

	if (Array.isArray(edits)) return { ...rest, edits };
	if (typeof oldText === "string" && typeof newText === "string") {
		return { ...rest, edits: [{ oldText, newText }] };
	}
	if (args.edits !== undefined) return { ...rest, edits };

	return input;
}

export default function (pi: ExtensionAPI) {
	// read_ansi --------------------------------------------------------------
	pi.registerTool({
		name: "read_ansi",
		label: "read_ansi",
		description:
			"Read a text file using a legacy encoding (default windows-1252). The file is decoded to UTF-8 for processing and truncation. Text-only; images are not supported.",
		promptSnippet: "Read legacy-encoded text files as UTF-8",
		promptGuidelines: ["Use read_ansi for Clarion .clw/.inc files and other legacy-encoded text files."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
			offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
			encoding: Type.Optional(Type.String({ description: `Text encoding (default: ${DEFAULT_ENCODING})` })),
		}),

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const { encoding, cwd } = getExecutionOptions(params.encoding, ctx?.cwd);

			const internal = createReadTool(cwd, {
				operations: {
					access: (absolutePath) => fsAccess(absolutePath, constants.R_OK),
					readFile: (absolutePath) => readAnsiFile(absolutePath, encoding),
					// Force text mode (no images)
					detectImageMimeType: async () => null,
				},
			});

			// Delegate to pi's built-in read implementation
			return internal.execute(toolCallId, { path: params.path, offset: params.offset, limit: params.limit }, signal);
		},
	});

	// write_ansi -------------------------------------------------------------
	pi.registerTool({
		name: "write_ansi",
		label: "write_ansi",
		description:
			"Write a text file using a legacy encoding (default windows-1252). If content contains characters not representable in the encoding, the tool errors. Text-only; images are not supported.",
		promptSnippet: "Write UTF-8 text to disk using a legacy encoding",
		promptGuidelines: [
			"Use write_ansi for new or fully rewritten Clarion .clw/.inc files and other legacy-encoded text files.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
			content: Type.String({ description: "Content to write to the file" }),
			encoding: Type.Optional(Type.String({ description: `Text encoding (default: ${DEFAULT_ENCODING})` })),
		}),

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const { encoding, cwd } = getExecutionOptions(params.encoding, ctx?.cwd);

			const internal = createWriteTool(cwd, {
				operations: {
					mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
					writeFile: (absolutePath, content) => writeAnsiFile(absolutePath, content, encoding),
				},
			});

			return internal.execute(toolCallId, { path: params.path, content: params.content }, signal);
		},
	});

	// edit_ansi --------------------------------------------------------------
	pi.registerTool({
		name: "edit_ansi",
		label: "edit_ansi",
		description:
			"Edit a single legacy-encoded text file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the decoded original file. The result is re-encoded and errors if it contains characters not representable in the target encoding.",
		promptSnippet: "Edit legacy-encoded text files with one or more exact replacements",
		promptGuidelines: [
			"Use edit_ansi for precise changes to Clarion .clw/.inc files and other legacy-encoded text files.",
			"When changing multiple separate locations in one legacy-encoded file, use one edit_ansi call with multiple entries in edits[].",
			"Each edit_ansi edits[].oldText is matched against the original decoded file, not after earlier edits are applied.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
			edits: Type.Array(
				Type.Object(
					{
						oldText: Type.String({
							description:
								"Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
						}),
						newText: Type.String({ description: "Replacement text for this targeted edit." }),
					},
					{ additionalProperties: false },
				),
				{
					description:
						"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
				},
			),
			encoding: Type.Optional(Type.String({ description: `Text encoding (default: ${DEFAULT_ENCODING})` })),
		}),

		prepareArguments: prepareEditArguments,

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const { encoding, cwd } = getExecutionOptions(params.encoding, ctx?.cwd);

			const internal = createEditTool(cwd, {
				operations: {
					access: (absolutePath) => fsAccess(absolutePath, constants.R_OK | constants.W_OK),
					readFile: (absolutePath) => readAnsiFile(absolutePath, encoding),
					writeFile: (absolutePath, content) => writeAnsiFile(absolutePath, content, encoding),
				},
			});

			return internal.execute(toolCallId, { path: params.path, edits: params.edits }, signal);
		},
	});
}
