import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/**
 * The register is behind the sign-in page.
 *
 * Both guards wait on `auth.ready` first: the stored session is restored
 * asynchronously, and without the wait a reload of `/waste` would decide nobody
 * was signed in before the answer had come back.
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ready;
  return auth.signedIn() || router.createUrlTree(['/login']);
};

/** Keeps a signed-in operator off the sign-in and register pages. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ready;
  return !auth.signedIn() || router.createUrlTree(['/waste']);
};
