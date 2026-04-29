# @carlosgtrz/pi-ansi-tools

Pi extension that adds tools for legacy-encoded source files, defaulting to `windows-1252`:

- `read_ansi`
- `write_ansi`
- `edit_ansi`

Useful for Clarion `.clw`/`.inc` files and other legacy source formats.

## Install

```bash
pi install npm:@carlosgtrz/pi-ansi-tools
```

Try without installing permanently:

```bash
pi -e npm:@carlosgtrz/pi-ansi-tools
```

For one-off testing from this repo:

```bash
pi -e ./packages/ansi-tools
```

## Usage

Once installed, Pi can call these tools when working with legacy-encoded source files.

The tools mirror Pi's built-in `read`, `write`, and `edit` tools, but add an encoding layer:

- `read_ansi` decodes the source file to UTF-8 before calling the built-in read behavior.
- `write_ansi` encodes UTF-8 content back to the target legacy encoding before writing.
- `edit_ansi` decodes the source file to UTF-8, applies the same exact-replacement behavior as the built-in edit tool, then re-encodes the result before writing.

Use them the same way you would use Pi's built-in tools, with an optional `encoding` parameter. If omitted, the encoding defaults to `windows-1252`.

## License

MIT
