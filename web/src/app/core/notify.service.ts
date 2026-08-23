import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MessageService } from 'primeng/api';
import { TranslateService } from '@ngx-translate/core';

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
   * Surfaces the API's own message where there is one.
   *
   * A validation failure the operator can act on ("Last name is required.")
   * arrives as 400/404/409 and is shown as a warning; anything else is a
   * genuine fault and is shown as an error.
   */
  fromHttp(error: unknown, fallback: string): void {
    if (!(error instanceof HttpErrorResponse)) {
      this.error(fallback);
      return;
    }

    if (error.status === 0) {
      this.error('Cannot reach the waste-log service. Check that it is running.');
      return;
    }

    const detail = extractMessage(error) ?? fallback;
    if (error.status >= 400 && error.status < 500) {
      this.warn(detail);
    } else {
      this.error(detail);
    }
  }
}

/** The API answers with `{ "error": "..." }`; extractors fall back to text. */
function extractMessage(error: HttpErrorResponse): string | null {
  const body = error.error;

  if (typeof body === 'string' && body.trim()) {
    return body.trim();
  }
  if (body && typeof body === 'object' && typeof body.error === 'string') {
    return body.error;
  }
  return null;
}
