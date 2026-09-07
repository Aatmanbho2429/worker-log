import { Subscription } from './subscription';
import { UserAccount } from './userAccount';

/** What a successful register or sign-in hands back. */
export interface Session {
  user: UserAccount;
  subscription: Subscription;
}
