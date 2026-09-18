# Shell polish + update-progress fix + 2-hour background polling

> **Status:** implemented 2026-09-18 by Sonnet 5, directly on `Development`,
> in the local checkout (no branch). Facts below were checked against the
> working tree and the live app log on 2026-09-18.
>
> - [x] Phase 1 — Use the new logo. Source art moved to `design/`; sidebar
>       mark, favicon and the full `src-tauri/icons/` set regenerated from it.
> - [x] Phase 2 — Shell chrome: sidebar credit (links to pictoria.shop via a
>       new `commands::open_pictoria_site`), Settings commented out of the
>       nav, version tag in the topbar doubling as the manual check.
> - [x] Phase 3 — Progress bar: restored the logging, fixed the dead CSS,
>       added an `installing` phase for the post-download stretch, and
>       started `percent` indeterminate instead of a dead 0%.
> - [x] Phase 4 — Polling moved to Rust (`updater::start_background_checks`),
>       every 2 hours, skipped in dev builds, running only while the app is
>       open (no tray/autostart, per the user's decision).
> - [x] Phase 5 — `cargo test` (37) and `npm test` (48) pass; `cargo check`
>       and `ng build` are clean. `updates.service.spec.ts` rewritten for the
>       new shape. `auto-update.md` updated with a supersession note.
>
> **Not done in this pass:** §3.5's live reproduction (installing a real
> older build and watching the bar) — that needs an actual older install to
> update *onto* `v0.4.0` or later, which this session did not have. Worth
> doing once there's a reason to cut another release.

---

## What is being asked

1. A "made by the founder of Pictoria" credit at the **bottom of the sidebar**.
2. **Remove Settings from the nav** — not needed.
3. Show the **app version in the topbar beside the company name, as a tag**.
4. **Fix the update progress bar** — it doesn't work properly today.
5. **Poll for new releases every 2 hours in the background**, not only at app
   open, and raise the banner when one is found.

Plus, assumed from context: the user added `logo.png` to the repo root and
wants it used (§1). If that assumption is wrong, skip Phase 1 — nothing else
depends on it.

---

## Facts established (verified 2026-09-18 — do not re-derive)

| Fact | Where | Consequence |
|---|---|---|
| `logo.png` at repo root, **1254×1254, PNG colour type 2 (RGB, no alpha)** — an **opaque white background**, blue basin + slate clipboard | `logo.png` | Needs a transparent-background version before it can sit on the slate sidebar (§1) |
| `src-tauri/icons/` is still the **Aug 23 placeholder set** | `ls -la src-tauri/icons` | The new logo has not been applied to the app icons yet |
| Shell is a 2×2 grid: `'brand topbar' 'nav main'` | `components/_shell.scss:3` | The credit belongs inside `.shell__nav` (grid area `nav`), not a new grid row |
| `.shell__nav` is `display:flex; flex-direction:column; overflow-y:auto` | `_shell.scss:136` | `margin-top:auto` pins the credit to the bottom |
| At **≤900px** `.shell__nav` becomes `flex-direction:row` and `.shell__section` is hidden | `_shell.scss:218-228` | The credit must hide at that breakpoint too, or it lands mid-strip |
| `.shell__mark` is 32×32, **`background: $accent`** (blue), `$radius-md` | `_shell.scss:22` | A blue-on-white logo inside a blue tile will not read; the tile's background has to change (§1.2) |
| `shell.html` uses a bare `<i class="pi pi-shield">`, but `_shell.scss` defines `.shell__mark-icon` | `shell.html:3`, `_shell.scss:32` | Pre-existing BEM drift; fix it while you are in there |
| Settings nav item is `shell.ts:68`; `ROUTE_SETTINGS` is used **only** by `shell.ts` and `constants.ts` | `shell.ts`, `constants.ts:19` | Removing the nav item leaves the route orphaned but harmless |
| The Settings screen holds Version, DB path, and the manual **Check for updates** button | `views/settings/settings.html` | That button needs a new home once Settings leaves the nav (§2.3) |
| `settings.ts` still has `seed()` / `reseed()` methods that **no template calls** | `views/settings/settings.ts` | Pre-existing dead code. Out of scope — do not "fix" it in this pass |
| `TagModule` is already in `PrimengComponentsModule`; `p-tag` precedent exists | `primeng-components-module.ts:65`, `profile.html:67`, `workers.html:98` | Version tag needs no new import |
| `app_info` returns `{version, databasePath}` from `env!("CARGO_PKG_VERSION")` | `commands.rs:24`, `SettingsService.appInfo()` | The version the topbar shows comes from here |
| **`updater.rs` has NO progress logging** — the original plan specified per-10% `log::info!` lines and the implementation omitted them | `src-tauri/src/updater.rs` | **The silent log proves nothing.** Restore the logging before diagnosing (§3.1) |
| `tauri-plugin-updater` **2.11.0** calls `on_chunk(chunk.len(), content_length)` once per streamed chunk | `updater.rs:733-737` in the crate | The Rust callback contract is correct; the bug is elsewhere |
| **The update worked.** Live log: `08:32:35 starting download of v0.4.0` → `08:33:53 opened local database` | `~/Library/Logs/com.aatman.ceramicwastelog/Ceramic Waste Log.log` | 78 s start-to-restart. The installer is fine; only the *reporting* is broken |
| After the bytes land, the plugin verifies the signature, extracts the archive and swaps the `.app` — **with no callbacks at all** | crate `updater.rs` `download` → `install` | A long silent tail at the end of the bar is expected today (§3.3) |
| `p-progressbar`'s host is a custom element, so it is `display: inline` | — | `max-width` and `margin-top` in `_update-banner.scss:54` **do nothing** today (§3.2) |
| `POLL_INTERVAL_MS = 6h`, in JS `setInterval`, skipped entirely under `isDevMode()` | `core/updates.service.ts:47,71,74` | Becomes 2h and moves to Rust (§4) |
| **No tray; closing the window quits the app** (no `on_window_event` in `lib.rs`) | `lib.rs` | "Background" can only mean *while the app is running*. See §4.4 |
| `tokio` is already a transitive dependency via `tauri` | `Cargo.lock` | Adding `tokio = { version = "1", features = ["time"] }` costs no new compile units |

---

## Phase 1 — Use the new logo

### 1.1 Make a transparent master

`logo.png` has no alpha channel, so it is a white square. Before anything else,
produce `logo-master.png` — same art, 1024×1024, **transparent** background.
Removing a flat white background is a one-liner with ImageMagick if it is
available, otherwise do it in any editor:

```bash
magick logo.png -fuzz 2% -transparent white -resize 1024x1024 logo-master.png
```

Check the result has an alpha channel before continuing — `-fuzz` too low
leaves a white halo, too high eats the white checklist strokes inside the
slate clipboard. Those strokes are white on purpose: **verify they survive.**

### 1.2 App icons

```bash
cd src-tauri && npx tauri icon ../logo-master.png
```

That regenerates the whole `src-tauri/icons/` set the `bundle.icon` list in
`tauri.conf.json` already points at. No config change needed.

### 1.3 The sidebar mark

Replace the placeholder shield in `shell.html:3`:

```html
<div class="shell__mark">
  <img class="shell__mark-image" src="…" alt="" />
</div>
```

- Put the asset at **`web/public/logo.png`** and reference it as
  `src="logo.png"`. Verified: `angular.json`'s assets array copies
  `public/**/*` to the build root (that is how `favicon.ico` already
  resolves), so a root-relative name is all it needs. **Do not** inline a
  1 MB data URI. Export it at the size it renders (48px or 64px square is
  plenty for a 24px mark at 2×) rather than shipping the 1254px master.
- This is the app's **first `<img>` in any template** — there is no existing
  precedent to copy. Give it `alt=""`, since the wordmark beside it already
  names the product and a screen reader repeating it is noise.
- `.shell__mark` currently paints `$accent` behind the icon. A blue logo on a
  blue tile is invisible: change that block's background to `$surface-card`
  (white) so the mark reads as a product logo, and add
  `.shell__mark-image { height: to-rem(24); width: to-rem(24); }`.
- While here, fix the BEM drift noted in the facts table — the old bare `<i>`
  had no class even though `.shell__mark-icon` exists.
- The favicon is `web/public/favicon.ico`, referenced from
  `web/src/index.html:9`. Regenerate it from the same master so the window
  icon matches the sidebar mark — `npx tauri icon` (§1.2) emits an
  `icon.ico` you can copy over it.

### 1.4 Keep the source art

Move `logo.png` and `logo-master.png` somewhere deliberate (suggest
`design/`) rather than leaving them loose at the repo root, and commit them —
they are the masters every icon is regenerated from.

---

## Phase 2 — Shell chrome

### 2.1 Sidebar credit

**Decided:** the credit links to **https://pictoria.shop/**.

Bottom of `.shell__nav`, after the `@for` over sections:

```html
<button type="button" class="shell__credit" (click)="openPictoria()">
  {{ 'shell.madeBy' | translate }}
</button>
```

- Copy goes in `en.json` as `shell.madeBy`: **"Made by the founder of
  Pictoria"**.

#### It cannot be a plain `<a href>` — it needs a Rust command

An `<a href="https://pictoria.shop/">` inside the Tauri webview either
navigates the app window away from itself (leaving the operator stranded in a
website with no back button) or is refused by the navigation policy. External
links have to open in the **system browser**, which means Rust.

This repo already has exactly this pattern — copy it rather than inventing a
second one: `updater.rs::update_open_releases_page` hardcodes its URL in Rust
and calls `app.opener().open_url(URL, None::<&str>)`.

- Add a sibling command — suggest `open_pictoria_site` — in `updater.rs`, or
  better in `commands.rs` since it has nothing to do with updating. **The URL
  is a `const` in Rust; it is never passed from the webview.** That rule is
  not stylistic: accepting a URL over the bridge would hand any future XSS an
  "open anything" primitive.
- The usual three places (`rules/tauri-ipc.md`): the `_impl` + wrapper, the
  `generate_handler![]` list in `lib.rs`, and a `TAURI_COMMANDS` entry.
- It needs **no** capability entry — `opener` is being called from Rust, not
  from JS. (`opener:allow-open-path` in `capabilities/default.json` is for the
  export-open flow, which does go through JS.)
- `Shell.openPictoria()` calls it through a service the same way
  `UpdatesService.openReleasesPage()` does — fire and forget, `console.warn`
  on failure. A dead credit link is not worth a toast.

#### Styling a `<button>` as a credit line

It is a `<button>`, not a `<p>`, so it must be reset (`background: none;
border: 0; cursor: pointer; font: inherit; padding: 0;`) before the rules
below, and it must show a focus ring — `@include focus-ring` or the global
`:focus-visible` outline. `rules/ui-design-system.md` requires that of every
interactive element, and a link that only works with a mouse fails it.
- `shared/…` is for shared components; this is shell chrome, so the style
  goes in `components/_shell.scss` next to the other `.shell__*` blocks:

```scss
.shell__credit {
  color: $sidebar-text-muted;
  font-size: $fs-xs;
  line-height: $lh-snug;
  margin-top: auto;          // pins to the bottom of the flex column
  padding-top: $space-lg;
  text-align: center;
}
```

- **Add `.shell__credit { display: none; }` to the ≤900px media block**, beside
  the existing `.shell__section` rule — otherwise it lands in the middle of
  the horizontal nav strip.
- `$sidebar-text-muted` (not `$text-muted`): this sits on the slate sidebar,
  and the contrast floor for text on slate chrome is 4.5:1 per
  `rules/ui-design-system.md`.

### 2.2 Remove Settings from the nav

**Decided: comment the nav entry out — delete nothing else.**

In `shell.ts`'s Masters section, restore the line to the commented-out state it
was in before the auto-update work un-hid it:

```ts
// { label: 'shell.navSettings', icon: 'pi pi-cog', route: ROUTE_SETTINGS },
```

- **Leave the `ROUTE_SETTINGS` import in place.** It is then unused, which is
  exactly how this file sat before and it compiles clean — the TS config does
  not error on unused imports (verified: that was the state through the whole
  controls-refresh and theme-refresh work).
- Leave the route in `app.routes.ts`, the constant, the component and
  `shell.navSettings` in `en.json` untouched. `/settings` stays reachable by
  URL for support — it is the only place showing the database file path.
- Drop the explanatory comment the auto-update change added above that line
  ("Unhidden for the update feature…"), since it is no longer true. Replace it
  with a one-liner saying the manual update check now lives on the version tag
  (§2.3), so the next person does not "helpfully" un-hide it again.

### 2.3 Version tag in the topbar — and the manual check's new home

In `shell.html`'s `.shell__context`, beside the company name:

```html
<p-tag
  class="shell__version"
  severity="secondary"
  [value]="'v' + (version() ?? '—')"
  [pTooltip]="'update.checkNow' | translate"
  tooltipPosition="bottom"
  (click)="checkForUpdates()"
/>
```

- `version` is a signal on `Shell`, filled from `SettingsService.appInfo()` in
  the constructor (same `void this.load()` shape `Settings` already uses).
  Swallow the error — a topbar tag is not worth a toast if it fails.
- **Making the tag the manual "Check for updates" trigger is what stops §2.2
  from stranding that feature.** `checkForUpdates()` on `Shell` mirrors
  `settings.ts`'s existing method exactly: `UpdatesService.checkNow()`, then
  `notify.info('update.availableToast')` / `notify.success('update.upToDate')`
  / `notify.fromCommand(err, 'update.checkFailed')`. Copy that method rather
  than inventing new copy — all four keys already exist in `en.json`.
- A clickable tag needs to look and behave clickable: `cursor: pointer`, a
  `:focus-visible` ring, and `tabindex="0"` plus a keyboard handler, or wrap it
  in a bare `<button>`. **A `(click)` on a non-interactive element is not
  reachable by keyboard** — `rules/ui-design-system.md` requires every
  interactive element to show focus.
- Style `.shell__version` in `_shell.scss`. It must not shout: this is a
  meta detail beside the company name, not a status.

---

## Phase 3 — Fix the update progress bar

### 3.1 First, restore the instrumentation that was specified and never written

`updater.rs`'s progress closure emits the event but logs nothing, so the app
log cannot tell you whether the callback ran. **Before changing behaviour**,
add back the logging from Pictoria's implementation
(`Visara-Tauri/UI/src-tauri/src/commands/update_commands.rs`):

```rust
match (pct, last_pct) {
    (Some(p), _) if p % 10 == 0 => {
        log::info!("[updater] download {p}% ({downloaded} / {total:?} bytes)")
    }
    (None, None) => log::info!(
        "[updater] download progressing, no Content-Length (UI shows an indeterminate bar)"
    ),
    _ => {}
}
```

Then reproduce once (§3.5) and read
`~/Library/Logs/com.aatman.ceramicwastelog/Ceramic Waste Log.log`. That single
run splits the problem in half:

- **Lines appear** → Rust is streaming fine; the fault is in the webview
  (event listener, signal, or rendering) → §3.2 and §3.4.
- **No lines at all** → the callback never fires; the fault is in Rust or the
  network layer → chase that instead, and ignore §3.2/§3.4 until it is fixed.

Do not skip this step and start "fixing" things. The three defects below are
all real and worth fixing regardless, but none is *confirmed* as the cause yet.

### 3.2 Definite defect — the bar's own CSS does nothing

`_update-banner.scss:54` sets `margin-top` and `max-width` on
`.update-banner__progress`, which is the `p-progressbar` **host** — a custom
element, therefore `display: inline`. Neither property applies to a
non-replaced inline box, so the bar today has no top gap and ignores its
320px cap.

```scss
.update-banner__progress {
  display: block;
  margin-top: $space-2xs;
  max-width: to-rem(320);
  width: 100%;
}
```

### 3.3 Definite defect — the bar has no idea the install phase exists

The percentage only covers the **download**. After the last byte, the plugin
verifies the signature, extracts the archive and swaps the bundle, and calls
back **nothing** until the process restarts. On the 78-second run in the log,
a meaningful slice of that was this silent tail — a bar parked at 100% while
the app appears hung is exactly the reported symptom.

Fix: use the `on_download_finish` callback, which is currently `|| {}`:

- Extend the progress payload with a phase, e.g.
  `UpdateProgress { downloaded, total, phase }` where `phase` is
  `"downloading" | "installing"`, **or** add a second event
  `worker-log://update-installing`. Either is fine; one struct with a phase
  keeps the event registry smaller.
- On `on_download_finish`, emit the `installing` phase.
- The banner then shows `'update.installing' | translate` with an
  **indeterminate** bar for that stretch, so a long verify/extract reads as
  work-in-progress rather than a freeze. New copy key needed in `en.json`.
- Mirror the phase in `models/events.ts` and keep the Rust/TS types in step
  (`rules/models.md`).

### 3.4 Likely defect — a dead 0% before the first chunk

`percent` is initialised to `0` and `install()` resets it to `0`, so between
the click and the first chunk (a re-check, DNS, TLS, redirect to GitHub's CDN
— seconds on a shop-floor connection) the operator stares at an empty
determinate bar. Start indeterminate instead:

- `readonly percent = signal<number | null>(null);` and `install()` sets
  `null`, not `0`.
- The template already maps `null` to `mode="indeterminate"`, so the bar
  animates from the moment the click lands and only switches to determinate
  once a real percentage arrives.
- Also guard against the bar going backwards: ignore a progress event whose
  computed percent is lower than the current one.

### 3.5 How to reproduce without cutting a release

The published `latest.json` is at `0.4.0` and `Cargo.toml` is also `0.4.0`, so
nothing is offered. Lower the local version to force an update:

1. Set `src-tauri/Cargo.toml` `version = "0.3.9"`, then
   `cargo check --manifest-path src-tauri/Cargo.toml`.
2. `npm run dev`, sign in, click the version tag (§2.3) → the banner appears.
3. Click **Install & restart**, watch the bar, then read the log.
4. **Revert the version to `0.4.0` afterwards** and re-run `cargo check`.

Note this genuinely downloads and installs `0.4.0` over the running dev build,
which is the point — but it means step 4 matters, or the next `cargo check`
will look like an unrelated diff.

---

## Phase 4 — 2-hour background polling, driven from Rust

### 4.1 Why it moves out of Angular

Today the poll is a JS `setInterval` in `UpdatesService`, which:

- is skipped entirely under `isDevMode()`, so it never runs in `npm run dev`;
- lives in a webview, where timers are throttled while the window is hidden or
  minimised — precisely the state a shop-floor terminal sits in for hours;
- restarts from zero on every reload.

A Rust task has none of those problems and is what "in the background" actually
means here.

### 4.2 The task

In `updater.rs`, add a `start_background_checks(app: AppHandle)` called from
`lib.rs`'s `setup()`:

```rust
const POLL_INTERVAL: Duration = Duration::from_secs(2 * 60 * 60);
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(60);
```

- `tauri::async_runtime::spawn` a loop: sleep `FIRST_CHECK_DELAY`, check, then
  loop on `POLL_INTERVAL`.
- The first check is delayed by ~60 s rather than firing at t=0, so it does not
  compete with window creation, the licence check and the first screen load on
  a slow terminal.
- Needs `tokio = { version = "1", features = ["time"] }` in `Cargo.toml` for
  `tokio::time::sleep` (already transitive via `tauri`, so no new build cost).
  A `std::thread` + `std::thread::sleep` + `tauri::async_runtime::block_on`
  also works if you would rather not add the direct dependency.
- **Skip the auto-poll in dev builds**: `if cfg!(debug_assertions) { return; }`.
  That preserves today's behaviour — `tauri dev` never nags — while the manual
  check keeps working in dev, which is how §3.5 is tested.
- **Do not check while an install is running**: the `INSTALLING: AtomicBool`
  guard already exists in `updater.rs`; read it and skip that tick.
- A failed check logs `log::warn!` and nothing else. Offline must stay silent
  (that rule has not changed).

### 4.3 The event, and the Angular side

- On a hit, emit `worker-log://update-available` carrying the existing
  `UpdateInfo`. Register it in `events.rs` beside the other two, and in
  `TAURI_EVENTS`.
- `UpdatesService`: subscribe to it in `start()` and `available.set(info)` —
  which is all the banner needs, since `bannerVisible()` already derives from
  `available()` and `dismissedVersion`.
- **Delete** the JS `setInterval`, `POLL_INTERVAL_MS`, `checkInBackground()`
  and the `isDevMode()` early return. `start()` then only wires listeners.
- Keep `checkNow()` exactly as it is — it is the manual path and still
  propagates its error to the caller.
- Per-version dismissal still applies: a poll that re-offers a dismissed
  version must not re-raise the banner. `bannerVisible()` already handles that;
  just don't clear `dismissedVersion` when the event arrives.

### 4.4 Scope of "background" — decided

The app has no tray and **quits when the window is closed**. So "every 2 hours"
means *every 2 hours while the app is running*. A terminal that is shut down
overnight checks when it is next opened plus every 2 hours thereafter.

**The user has confirmed that is enough** — checks only while the app runs. Do
**not** add a tray or autostart in this pass. (For the record, that would be
the Pictoria shape: `tauri-plugin-autostart` plus a tray with "Check for
Updates" — a separate, larger change if it is ever wanted.)

---

## Phase 5 — Tests and docs

- `core/updates.service.spec.ts` **will break**: it calls `start()` and pushes
  through the mocked `progress` observable, and asserts `percent()` of `0`.
  Update it for the new shape — the `null` initial percent (§3.4), the
  `update-available` event replacing the polled check, and the new phase
  (§3.3). The existing cases for per-version dismiss and failed-install still
  apply and must keep passing.
- Add a Rust test for the phase/percent mapping if §3.3 introduces any logic
  worth testing; `progress_percent`'s existing tests stay.
- `cargo test --manifest-path src-tauri/Cargo.toml` and, from `web/`,
  `npm test -- --watch=false` must both pass. Run
  `npx prettier --write` on touched Angular files.
- Update `.claude/plans/auto-update.md` where this supersedes it: the 6-hour
  JS poll (§3.3 of that plan) becomes the 2-hour Rust task, and the Settings
  screen is no longer where the manual check lives.
- Once this ships **and** the progress bar is confirmed fixed against a real
  release, fold both plans into the `release` skill that
  `auto-update.md` Phase 5 describes, and delete both plan files. Not before.

---

## Things that will bite

- **The 78-second run in the log is the baseline, not a bug report.** The
  update installed correctly. Anything you "fix" must keep that working —
  re-verify with §3.5 before and after.
- **Don't treat the silent log as evidence** that Rust never emitted progress.
  It logs nothing today. §3.1 exists for exactly this reason.
- **`p-progressbar` is an inline host.** This same trap applies to any
  PrimeNG component you try to size from a BEM class.
- **The version tag must be keyboard-reachable** if it triggers the manual
  check. A bare `(click)` on `p-tag` is not.
- **The sidebar credit needs hiding at ≤900px**, or it appears mid-strip in the
  horizontal nav.
- **An `<a href>` to pictoria.shop will hijack the app window.** External
  links go through Rust and the system browser, with the URL hardcoded on the
  Rust side (§2.1). Never accept a URL over the bridge.
- **The logo is opaque white.** Dropping `logo.png` straight onto the slate
  sidebar paints a white box.
- **Removing Settings from the nav strands the manual check** unless §2.3
  lands in the same change. Do them together.
- **Nothing here changes `tauri.conf.json`'s version key** — it does not exist
  any more; `Cargo.toml` is the only version source.

---

## Decisions taken (answered by the user, 2026-09-18)

1. **Credit wording and link** — "Made by the founder of Pictoria", linking to
   **https://pictoria.shop/**. Opened in the system browser through a Rust
   command with the URL hardcoded there; see §2.1 for why it cannot be a plain
   `<a href>` in a Tauri webview.
2. **Settings screen** — **comment the nav entry out only.** The screen, its
   route and its copy all stay; `/settings` remains reachable by URL. See §2.2.
3. **Background checks** — **only while the app is running.** No tray, no
   autostart. §4.4 stands as written: a terminal that is shut down overnight
   checks when it is next opened, then every 2 hours.

Nothing in this plan is blocked. Hand it to Sonnet as-is.
