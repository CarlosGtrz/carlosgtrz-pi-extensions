# @carlosgtrz/pi-run-timer

Pi extension that shows agent run timing in the footer/status line.

It displays:

- elapsed time for the current run
- duration of the previous completed run
- longest run duration in the current session branch, with a very short prompt preview

A run is one continuous busy period from the first `agent_start` after idle until `agent_end` with no pending messages. Steering and follow-up prompts remain part of the same run.

State is saved into the Pi session and restored after `/reload`.

## Install

```bash
pi install npm:@carlosgtrz/pi-run-timer
```

Try without installing permanently:

```bash
pi -e npm:@carlosgtrz/pi-run-timer
```

For one-off testing from this repo:

```bash
pi -e ./packages/run-timer
```

## Usage

Start Pi normally:

```bash
pi
```

The footer/status line will show timing information automatically while the agent is working and after each completed run.

Example status:

```text
● run 01:23 · prev 00:40 · max 03:12 (Review README…)
```

The longest-run prompt preview is limited to 15 characters.

## License

MIT
