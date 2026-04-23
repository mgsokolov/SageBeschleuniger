# SageBeschleuniger

SageBeschleuniger is a Windows-only desktop tool that lets you visibly whip the
**Sage** application window. Each successful hit plays a whip-crack sound and
makes the Sage window shake briefly without stealing focus, moving it
permanently, or changing its size.

> Inspired by the interaction idea of [OpenWhip](https://github.com/GitFrog1111/OpenWhip),
> rebuilt as a standalone Windows tool whose target is the Sage window instead
> of a keyboard macro.

## What it does

- Runs as a tray icon.
- Clicking the tray icon spawns a transparent full-screen whip overlay.
- Swinging the whip fast triggers a crack; if the whip tip lands on the Sage
  window, the window shakes horizontally for ~130 ms and returns to its exact
  original position.
- Closing the whip (mouse click or Escape) hides the overlay; the app stays in
  the tray.

## Platform support

**Windows only. Windows Server 2019 and newer / Windows 10 and newer.**

macOS and Linux are explicitly **not supported**. The CLI refuses to start on
any non-Windows platform.

## Prerequisites

- Windows Server 2019+ or Windows 10/11.
- Node.js 18 or newer: <https://nodejs.org/>
- An x64 architecture (matches the prebuilt Electron and `koffi` binaries).
- No administrator rights required.

## Install

### Option A — from the GitHub repository (recommended)

```powershell
npm install -g github:mgsokolov/SageBeschleuniger
```

### Option B — from a local clone

```powershell
git clone https://github.com/mgsokolov/SageBeschleuniger.git
cd SageBeschleuniger
npm install
npm install -g .
```

Both options expose the `sagebeschleuniger` command globally.

## Start

```powershell
sagebeschleuniger
```

A tray icon appears. Left-click the tray icon to open the whip. Right-click for
the menu (Open Whip / Locate Sage Window / Quit).

You can also run it once without a global install:

```powershell
npx github:mgsokolov/SageBeschleuniger
```

Or, inside a local clone:

```powershell
npm start
```

## How the Sage window is detected

The locator enumerates all top-level Windows and keeps candidates that match
either of:

- window **title** contains `sage` (case-insensitive), or
- the owning **process image name** contains `sage` (e.g. `Sage100.exe`,
  `Sage.exe`, `SageCRM.exe`).

It then filters the list:

- drops invisible, minimized, owned, and tiny windows,
- drops known shell/system classes and SageBeschleuniger's own windows.

Ranking among surviving candidates:

1. the currently focused (foreground) window wins,
2. otherwise the candidate that matches both title *and* process name wins,
3. otherwise the candidate with the largest screen area wins.

If no candidate matches, the overlay shows "No Sage window found" with a
**Retry** button. The tray menu entry **Locate Sage Window** reports which
window was found.

Set `SAGEBESCHLEUNIGER_DEBUG=1` to get verbose discovery logs on stdout.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Tray icon does not appear | Some Windows Server 2019 core installs hide the notification area. Check that the Explorer shell is installed, or open the app via its taskbar fallback. |
| "No Sage window found" banner | Make sure Sage is running and has a visible main window. Restore it if minimized. Click **Retry** or use tray menu → *Locate Sage Window*. |
| Whip cracks but window does not shake | Sage may be running elevated while you run SageBeschleuniger non-elevated; Windows blocks `SetWindowPos` across integrity levels. Start both programs at the same integrity level. |
| Whip tip does not register on Sage | The overlay uses the primary display. Move Sage to the primary display, or click Retry after dragging it. |
| No whip-crack sound | Output device may be muted. Sound is synthesized via Web Audio; no external mp3 is required. |

## Known limits on Windows Server 2019+

- The overlay covers the **primary display** only. On multi-monitor setups,
  move Sage to the primary display before whipping.
- Windows Server 2019 Core / headless installs without a desktop shell cannot
  show a system tray and therefore are not supported.
- High-DPI Sage windows running in a mixed-DPI session may report slightly
  offset rectangles; the shake still works but the target outline may be a few
  pixels off. This is a limitation of mixed-DPI Win32 coordinate reporting.

## Uninstall

```powershell
npm uninstall -g sagebeschleuniger
```

No files are written outside `node_modules`. No scheduled tasks, services,
registry keys, or autostart entries are created.

## Project layout

```
SageBeschleuniger/
├── bin/sagebeschleuniger.js   # CLI launcher → spawns Electron
├── main.js                    # Tray + overlay lifecycle + IPC
├── preload.js                 # Safe renderer bridge
├── overlay.html               # Whip physics, rendering, hit detection
├── src/
│   ├── win32.js               # koffi bindings: EnumWindows, SetWindowPos, …
│   ├── sageLocator.js         # Window discovery and ranking
│   ├── shake.js               # Non-activating, rate-limited shake animation
│   └── logger.js              # Stdout logging (debug gated by env var)
├── package.json
├── README.md
└── LICENSE
```

## Design notes

- Pure user-space: no driver, no DLL injection, no hooks, no admin.
- Window movement uses `SetWindowPos` with `SWP_NOSIZE | SWP_NOZORDER |
  SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS` so the Sage window never gets resized,
  re-z-ordered, or activated.
- Each shake reads the original position first and guarantees it is restored in
  a `finally` block, even on error.
- Shakes are serialized per-window with a concurrency guard and rate-limited
  to avoid jitter under rapid whip-spamming.

## License

MIT — see [LICENSE](./LICENSE).
