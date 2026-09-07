/**
 * Repeated literals that are not user-facing copy — copy belongs in
 * `assets/i18n/en.json` instead (see `.claude/skills/extract-static-text`).
 * Plain TypeScript, no Angular imports.
 */

// Routes the app navigates to in code (`router.navigate`) as well as from a
// template (`routerLink`) — kept here once so the two never drift apart.
export const ROUTE_LOGIN = '/login';
export const ROUTE_REGISTER = '/register';
export const ROUTE_WASTE = '/waste';
export const ROUTE_BARCODES = '/barcodes';
export const ROUTE_SHEET = '/sheet';
export const ROUTE_REPORTS = '/reports';
export const ROUTE_WORKERS = '/workers';
export const ROUTE_SERIES = '/series';
export const ROUTE_REASONS = '/reasons';
export const ROUTE_GRADES = '/grades';
export const ROUTE_SETTINGS = '/settings';
export const ROUTE_PROFILE = '/profile';

// Toast lifetimes in ms, by severity — mirrors the `life` passed to
// `MessageService.add` in `core/notify.service.ts`.
export const TOAST_LIFE = {
  success: 2500,
  info: 3000,
  warn: 4000,
  error: 6000,
} as const;
