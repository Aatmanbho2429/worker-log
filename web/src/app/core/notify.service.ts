import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { TranslateService } from '@ngx-translate/core';

import { isCommandError } from './tauri.service';

@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly messages = inject(MessageService);
  private readonly translate = inject(TranslateService);

  success(detail: string): void {
    this.messages.clear();
    this.messages.add({
      severity: 'success',
      summary: this.translate.instant('lblSuccess'),
      detail,
      life: 2500,
    });
  }

  info(detail: string): void {
    this.messages.clear();
    this.messages.add({
      severity: 'info',
      summary: this.translate.instant('lblInfo'),
      detail,
      life: 3000,
    });
  }

  warn(detail: string): void {
    this.messages.clear();
    this.messages.add({
      severity: 'warn',
      summary: this.translate.instant('lblWarn'),
      detail,
      life: 4000,
    });
  }

  error(detail: string): void {
    this.messages.clear();
    this.messages.add({
      severity: 'error',
      summary: this.translate.instant('lblError'),
      detail,
      life: 6000,
    });
  }

  /**
   * Surfaces the message a rejected command carried.
   *
   * A validation problem the operator can act on ("Last name is required.")
   * comes back tagged `badRequest`, `notFound` or `conflict` and is shown as a
   * warning; anything else is a genuine fault and is shown as an error.
   */
  fromCommand(error: unknown, fallback: string): void {
    if (isCommandError(error)) {
      if (error.kind === 'internal') {
        this.error(error.message || fallback);
      } else {
        this.warn(error.message || fallback);
      }
      return;
    }

    // A rejection that never reached Rust — a missing command, a permission
    // the capability file does not grant, or a bug in the bridge.
    console.error(error);
    this.error(typeof error === 'string' && error.trim() ? error : fallback);
  }
}
