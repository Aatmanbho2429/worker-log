/** `auth_change_password`. The confirmation never leaves the form. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
