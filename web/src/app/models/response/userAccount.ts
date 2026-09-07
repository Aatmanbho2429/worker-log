import { AccountStatus } from '../auth';

export interface UserAccount {
  /** The `auth.users` uuid — `public.users.id` is a foreign key onto it. */
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  /** Fingerprint of the PC this licence is claimed by, null until claimed. */
  deviceId: string | null;
  status: AccountStatus;
  createdDate: string;
}
