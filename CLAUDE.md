# CLAUDE.md

ESP32-S3 camera with a companion website. Start with `docs/plan.md`, which lists the project's major
parts, the serial protocol, the website's structure and the build order.

## Workflow (every feature)

1. **Branch.** Every feature or fix gets its own branch off `main`: `feature/<name>` or
   `fix/<name>`. Never commit to `main` directly. The pre-push hook blocks pushes to it.
2. **Test.** New code ships with tests in the same branch:
   - **Unit tests** (Vitest) for logic in `web/src/lib/`: `*.test.ts` next to the file.
   - **Integration tests** (Playwright) for user-facing behavior: `web/e2e/*.spec.ts`, driven
     through the mock sources, in headless Chromium with a fake webcam.
   - A bug fix adds a test that fails without the fix.
3. **Check.** `npm run check` in `web/` (lint → typecheck → unit → build → integration) must pass.
   The pre-push hook runs it, and CI (`.github/workflows/web.yml`) runs it again on every PR.
4. **Review docs.** Follow the docs rule below.
5. **Review code before the PR.** Run `/code-review` on the branch and fix or explicitly dismiss
   every finding *before* opening the PR.
6. **Open the PR** with `gh pr create` against `main`. Merge only once CI is green.

One-time setup per clone: `git config core.hooksPath .githooks`.

## Docs rule (every commit)

Before **every** commit to this repo:

1. **Review** `docs/` (at least `docs/plan.md`) against the staged changes.
2. **Update** the docs in the same commit whenever a change affects them: tick build-order items
   when they're done, and update any changed protocol packet, filename convention, folder structure,
   `CameraSource` interface, test layout or deploy step.
3. If the docs and the code disagree, fix one of them before committing. Never commit code the
   docs contradict.

## Coding standards

- **Minimal code.** Write the smallest change that does the job. Add no speculative abstractions,
  unused options, dead code or commented-out code, and no dependency the platform already covers
  (e.g. use `<dialog>` rather than a modal library).
- **Follow best practices.** Strict TypeScript with no `any`, and clean up effects, streams and
  object URLs. Use semantic, accessible HTML: real `<button>`s, labels, keyboard support. Handle
  errors where they can occur and show them to the user; don't swallow them.
- **Match the surrounding code.** Keep its naming, file layout and comment density. Comments explain
  *why*, not *what*.
- The UI talks to hardware **only** through the `CameraSource` interface
  (`web/src/lib/camera/types.ts`). New transports (serial, WiFi) implement it, and the UI does not
  change.

## Website (`web/`)

- Next.js App Router with a static export (`output: "export"`). No API routes, server actions,
  middleware or SSR-only features. See `web/AGENTS.md`: this Next.js version differs from training
  data, so check `web/node_modules/next/dist/docs/` before using an API.
- Node **24.21.0** (LTS), pinned in `web/.nvmrc` and enforced with `engine-strict`. Use
  `nvm use` in `web/`. Keep dependencies on their latest stable versions unless a peer range
  blocks one. Record any such hold-back and its reason in `docs/plan.md` (Toolchain).
- Commands (run in `web/`):
  - `npm run dev`: dev server on port 8888
  - `npm run build`: static site in `out/`
  - `npm test`: unit tests
  - `npm run test:e2e`: integration tests against the built site on port 3100 (first run:
    `npx playwright install chromium`)
  - `npm run check`: everything, as the pre-push hook and CI run it

## Repo root commands

- `make` / `make help`: list targets. Give every new target a `## description` so it shows up there.
- `make flash` / `make upload` `[PORT=...]`: build and flash the firmware over USB. `make hwtest`:
  protocol-level test of the flashed board (no browser). `make monitor`: serial monitor.
- `make web` / `make stop` / `make restart`: `./start.sh` deploy, stop and restart of the site on
  nginx at port 8888 (→ `camera.nirvek.xyz` via the Cloudflare tunnel).
- Run `shellcheck` on `start.sh` and `.githooks/*` after changing them.

## Firmware (`firmware/`)

- PlatformIO + Arduino for the XIAO ESP32-S3 Sense. Keep `CORE_DEBUG_LEVEL=0`: any log text on the
  USB port corrupts the binary protocol.
- **The protocol lives in three places, and they must stay in sync:** `web/src/lib/camera/protocol.ts`,
  `firmware/src/protocol.h` and the test double `web/e2e/fake-serial-device.js`, plus the table in
  `docs/plan.md`. Every command gets exactly one reply.
- `web/src/lib/camera/settings.ts` `RESOLUTIONS` must match `FRAME_SIZES` in `main.cpp`.
- A new camera setting touches: the `CameraSource` interface, both sources, `Settings`/`APPLY` in
  `camera-context.tsx`, the protocol (three places), `main.cpp`, `hwtest.py` and the docs.
- Firmware changes must pass `make flash && make hwtest` on the real board before a PR. Say so in
  the PR if no board was available.
- Every build exports `web/public/firmware/` (merged image + manifest). Commit the firmware source
  first, then `make build`, then commit the exported files, so the manifest version is a real
  commit and not `-dirty`.

## Device UI (`firmware/lib/ui/`)

- Portable C++17: no Arduino, no heap, no RTTI or exceptions. The same code runs on the ESP32 and
  as WASM on the site's Device tab. Design: `docs/wii-theme.md`.
- **Deterministic:** integer or fixed-point math only (no floats or `sin` in rendering), and
  `-ffp-contract=off` for both builds. The native tests and the browser test check the same golden
  hash (`firmware/test_ui/golden.h`).
- Test first with `make uitest`. If pixels change on purpose, look at `make ui-preview`, then update
  `EXPECTED_HASH`.
- After changing UI code, run `make wasm` and commit `web/public/wasm/device-ui.wasm`. `npm test`
  fails if the `.wasm` doesn't match `golden.h`.
- Only draw what the ST7789 emulator decodes: the site must show the SPI output, never the
  framebuffer directly.
- Wii-*inspired* only: no Nintendo assets, fonts, sounds or names.

## Git

- Commit and push with `git` / `gh`. The remote is `camera-esp` →
  `github.com/NirvekPanda/camera-esp`.
