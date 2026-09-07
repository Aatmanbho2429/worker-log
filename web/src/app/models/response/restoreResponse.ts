import { Session } from './session';

/** `auth_restore` answers with null when nobody is signed in. */
export type RestoreResponse = Session | null;
