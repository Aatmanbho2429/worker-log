/** `auth_register`. The device id is not here — Rust reads it off the machine. */
export interface RegisterRequest {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  companyName: string;
}
