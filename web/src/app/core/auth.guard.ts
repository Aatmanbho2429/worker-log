import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ROUTE_PROFILE } from '../models/constants';
import { AuthService } from './auth.service';

/**
 * The register is behind the sign-in page, and every screen but the profile
 * is behind an unexpired subscription.
 *
 * Both guards wait on `auth.ready` first: the stored session is restored
 * asynchronously, and without the wait a reload of `/waste` would decide nobody
 * was signed in before the answer had come back.
 *
 * The subscription check runs on `canActivateChild`, so it applies to every
 * screen under the shell without needing a guard of its own on each route —
 * the profile is the one exempt, since it is where the operator sees *why*
 * the app stopped and, eventually, where a plan gets picked to fix it.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ready;

  if (!auth.signedIn()) {
    return router.createUrlTree(['/login']);
  }

  if (auth.subscriptionExpired() && state.url !== ROUTE_PROFILE) {
    return router.createUrlTree([ROUTE_PROFILE]);
  }

  return true;
};

/** Keeps a signed-in operator off the sign-in and register pages. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ready;
  return !auth.signedIn() || router.createUrlTree(['/waste']);
};
