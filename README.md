# SageBeschleuniger

SageBeschleuniger is a Windows-only desktop tool that lets you visibly whip the
**currently active application window**. Each successful hit plays a whip-crack
sound and makes that window shake briefly without stealing focus, moving it
permanently, or changing its size.

> Inspired by the interaction idea of [OpenWhip](https://github.com/GitFrog1111/OpenWhip),
> rebuilt as a standalone Windows tool whose target is whichever top-level
> window you were just using.

## What it does

- Runs as a tray icon.
- Tracks the most recently active top-level window (foreground).
- Clicking the tray icon spawns a transparent full-screen whip overlay.
- Swinging the whip fast triggers a crack; if the whip tip lands on the target
  window, the window shakes horizontally for ~130 ms and returns to its exact
  original position.
- Closing the whip (mouse click or Escape) hides the overlay; the app stays in
  the tray.

## Platform support

**Windows only. Windows Server 2019+ and Windows 10/11.**

macOS and Linux are explicitly **not supported**. The app refuses to start on
any non-Windows platform.

## Run it (portable, no install)

The project is designed to be used as a **portable application** — just
download and run. No installer, no admin rights, no registry changes, no
persistence outside the exe.

### Get the portable exe

1. Go to the [Releases page](https://github.com/mgsokolov/SageBeschleuniger/releases).
2. Download `SageBeschleuniger-<version>-portable.exe`.
3. Double-click the exe. A tray icon appears.

If no release is published yet, build it yourself (see below). Release builds
are produced automatically by GitHub Actions when a `v*` tag is pushed.

### Build the portable distribution yourself

Requires Node.js 18+ and a Windows machine.

```powershell
git clone https://github.com/mgsokolov/SageBeschleuniger.git
cd SageBeschleuniger
npm install
```

Two local build options are provided:

**Portable folder + zip (works for every Windows user, no admin needed):**

```powershell
npm run build:portable-folder
```

Produces `dist/SageBeschleuniger-<version>-portable.zip`. Unzip anywhere,
then run `SageBeschleuniger\SageBeschleuniger.exe`.

**Single portable .exe (requires Windows Developer Mode or elevated shell):**

```powershell
npm run build:portable
```

Produces `dist/SageBeschleuniger-<version>-portable.exe`. Copy anywhere and
run. This target uses `electron-builder`, which needs permission to create
symbolic links during its toolchain extraction — either enable *Developer
Mode* under *Settings → Privacy & security → For developers*, or run the
command in an elevated (Administrator) shell. The CI release pipeline
builds this target automatically on `windows-latest` runners, so most users
do not need to build it locally.

### Run from source without packaging

```powershell
git clone https://github.com/mgsokolov/SageBeschleuniger.git
cd SageBeschleuniger
npm install
npm start
```

## Using it

1. Click the app that you want to whip, so it is the active window.
2. Left-click the SageBeschleuniger tray icon.
3. The whip spawns at your cursor. Swing fast toward the target window.
4. On a hit, the target window shakes briefly.
5. Click (or press Escape) to drop the whip and hide the overlay.

Tray menu:

- **Open Whip** — same as left-clicking the tray icon.
- **Identify Current Target** — shows the title and process name of the
  current target, useful for confirming which window will be hit.
- **Quit** — exits the app.

## How the target window is chosen

The app polls the Windows foreground window every 200 ms. The "target" is the
most recently seen top-level foreground window that:

- is visible and not minimized,
- is larger than 80×60 pixels,
- is not one of the system shell windows (`Progman`, `WorkerW`,
  `Shell_TrayWnd`, `Shell_SecondaryTrayWnd`, `Windows.UI.Core.CoreWindow`,
  `ApplicationFrameWindow`, `IME`, `MSCTFIME UI`, `Default IME`),
- does not belong to SageBeschleuniger itself.

When you open the overlay, the target is locked in and a red dashed rectangle
marks it so you can see where to aim. If the target disappears (closed or
minimized), the app falls back to whatever is in the foreground now.

Set `SAGEBESCHLEUNIGER_DEBUG=1` for verbose discovery logs on stdout (visible
when running `npm start`, not when running the portable exe).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Tray icon does not appear | On Windows Server Core there is no notification area. Install the Desktop Experience, or run a non-core SKU. |
| "No target window" banner | Click once on the window you want to whip so it becomes foreground, then open the whip again. Use tray menu → *Identify Current Target* to confirm. |
| Whip cracks but window does not shake | The target may be running elevated while you run SageBeschleuniger non-elevated; Windows blocks `SetWindowPos` across integrity levels. Start both programs at the same integrity level. |
| Whip tip does not register | The overlay uses the primary display. Move the target window to the primary display. |
| No whip-crack sound | Output device may be muted. Sound is synthesized via Web Audio; no external mp3 is required. |

## Known limits on Windows Server 2019+

- The overlay covers the **primary display** only. On multi-monitor setups,
  move the target to the primary display before whipping.
- Windows Server 2019 Core / headless installs without a desktop shell cannot
  show a system tray and therefore are not supported.
- High-DPI targets running in a mixed-DPI session may report slightly
  offset rectangles; the shake still works but the outline may be a few
  pixels off.

## Uninstall

Delete the exe. That is it. The portable build does not write to the registry,
does not create a Start Menu entry, does not create a scheduled task, and
does not leave behind any files outside Windows' standard per-user temp
unpack directory (which Windows cleans up on its own).

## Project layout

```
SageBeschleuniger/
├── bin/sagebeschleuniger.js     # Optional CLI launcher (for "from source" usage)
├── main.js                       # Tray + overlay lifecycle + IPC
├── preload.js                    # Safe renderer bridge
├── overlay.html                  # Whip physics, rendering, hit detection
├── src/
│   ├── win32.js                  # koffi bindings: EnumWindows, SetWindowPos, …
│   ├── targetTracker.js          # Foreground-window tracker
│   ├── shake.js                  # Non-activating, rate-limited shake animation
│   └── logger.js                 # Stdout logging (debug gated by env var)
├── .github/workflows/release.yml # CI: build portable exe on "v*" tag push
├── package.json                  # electron-builder config included
├── README.md
└── LICENSE
```

## Design notes

- Pure user-space: no driver, no DLL injection, no hooks, no admin.
- Window movement uses `SetWindowPos` with `SWP_NOSIZE | SWP_NOZORDER |
  SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS` so the target window never gets
  resized, re-z-ordered, or activated.
- Each shake reads the original position first and guarantees it is restored
  in a `finally` block, even on error.
- Shakes are serialized per-window with a concurrency guard and rate-limited
  to avoid jitter under rapid whip-spamming.
- The overlay uses `focusable: false`, so opening the whip does not steal
  focus from the target window.
- Portable packaging: single `.exe` produced by `electron-builder` with
  `target: portable`. All files are extracted to a per-user temp directory at
  launch and cleaned up on exit.

## Publishing a release

Maintainer-only:

```powershell
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions builds the portable exe on `windows-latest` and attaches it to
the GitHub Release automatically.

## License

MIT — see [LICENSE](./LICENSE).
