---
paths:
  - "web/src/**/*.spec.ts"
  - "web/angular.json"
  - "web/.prettierrc"
  - "src-tauri/src/barcode.rs"
  - "src-tauri/src/barcode_sheet.rs"
  - "src-tauri/src/db.rs"
  - "src-tauri/src/report.rs"
  - "src-tauri/src/models/response/api_response.rs"
---

# Tests and formatting

## Angular (vitest via `ng test`)

Tests run through Angular's `@angular/build:unit-test` builder (vitest under
jsdom, no `vitest.config.ts`). The builder is what initialises the TestBed, so
`npx vitest` directly fails. Always go through `npm test` from `web/`.

```bash
npm test -- --watch=false                                  # one-shot run from an interactive shell
npm test -- --include src/app/core/scan.service.spec.ts    # one spec file (path is web/-relative)
npm test -- --filter "keyboard wedge"                      # tests whose name matches a regex
```

`--watch` defaults to true in a TTY, so a bare `npm test` at a prompt stays in
watch mode instead of exiting.

Coverage is four spec files: `core/scan.service.spec.ts`,
`core/zone-wrapper/zone-wrapper.service.spec.ts`, `models/auth.spec.ts`,
`shared/scan-field/scan-field.spec.ts`. Nothing under `views/` or `services/`
is covered.

## Rust

Plain `#[test]` functions inline in `barcode.rs`, `barcode_sheet.rs`, `db.rs`,
`report.rs` and `models/response/api_response.rs`. Run them with
`cargo test --manifest-path src-tauri/Cargo.toml`. The barcode tests check real
symbology correctness, so a failure there means a scanner will misread the
sheet. Don't loosen those tests to get them passing.

## Formatting

There is no linter. Formatting is Prettier 3 against `web/.prettierrc` (100
columns, single quotes, `angular` parser for `*.html`). There is no `format`
script, so run `npx prettier --write <paths>` from `web/`.
