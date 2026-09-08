import { Session } from './session';

/**
 * `auth_restore` and `auth_validate` both answer with null when there is no
 * session left — nobody signed in, or one that no longer checks out.
 */
export type RestoreResponse = Session | null;
