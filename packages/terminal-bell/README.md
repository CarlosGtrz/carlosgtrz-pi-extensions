# @carlosgtrz/pi-terminal-bell

Pi extension that rings the terminal bell when an agent run finishes after a configurable timeout.

By default, it rings only when the agent ran for at least 5 seconds. Use `-1` to disable it.

## Install

```bash
pi install npm:@carlosgtrz/pi-terminal-bell
```

Try without installing permanently:

```bash
pi -e npm:@carlosgtrz/pi-terminal-bell
```

For one-off testing from this repo:

```bash
pi -e ./packages/terminal-bell
```

## Usage

Default behavior: ring after runs that take 5 seconds or longer.

```bash
pi
```

Change the timeout:

```bash
pi --terminal-bell-timeout 10
```

Ring for every completed agent run:

```bash
pi --terminal-bell-timeout 0
```

Disable the bell:

```bash
pi --terminal-bell-timeout -1
```

The extension writes the ASCII BEL character to `stderr`, so it does not interfere with normal stdout output.

## License

MIT
