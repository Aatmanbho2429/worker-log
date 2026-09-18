import { Component, computed, inject, signal } from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { TranslateService } from '@ngx-translate/core';

import { UpdatesService } from '../../core/updates.service';
import { DIALOG_WIDTH } from '../../models/constants';
import { PrimengComponentsModule } from '../primeng-components-module';

/**
 * A slim, dismissible banner — never a forced overlay. A shop-floor terminal
 * must never be locked out of logging waste by an update, so the operator
 * chooses when to install; the download only starts once they click.
 *
 * Mounted once in `layout/shell/shell.html`, above the router outlet, so it
 * never covers the login screen — an update that fixes sign-in is reached
 * through "Download manually" or a reinstall, not by blocking every screen.
 * See `.claude/plans/auto-update.md`.
 */
@Component({
  selector: 'app-update-banner',
  imports: [PrimengComponentsModule],
  templateUrl: './update-banner.html',
})
export class UpdateBanner {
  protected readonly updates = inject(UpdatesService);
  private readonly confirm = inject(ConfirmationService);
  private readonly translate = inject(TranslateService);

  protected readonly DIALOG_WIDTH = DIALOG_WIDTH;
  protected readonly showNotes = signal(false);

  protected readonly hasNotes = computed(() => !!this.updates.available()?.notes?.trim());

  /**
   * Installing closes the register for about a minute, so it asks first —
   * the same pattern as the shell's sign-out confirm.
   */
  protected confirmInstall(): void {
    const version = this.updates.available()?.version ?? '';
    this.confirm.confirm({
      header: this.translate.instant('update.confirmHeader'),
      message: this.translate.instant('update.confirmMessage', { version }),
      icon: 'pi pi-arrow-circle-up',
      acceptLabel: this.translate.instant('update.confirmAccept'),
      rejectLabel: this.translate.instant('update.confirmReject'),
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => void this.updates.install(),
    });
  }
}
