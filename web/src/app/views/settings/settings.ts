import { Component, inject, signal } from '@angular/core';
import { ConfirmationService } from 'primeng/api';

import { NotifyService } from '../../core/notify.service';
import { AppInfo, WasteLogService } from '../../core/waste-log.service';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';

/**
 * Where the register lives, and the demo data loader.
 *
 * The seeder used to be a CLI subcommand on the server. There is no server and
 * no terminal in a desktop build, so it lives here instead.
 */
@Component({
  selector: 'app-settings',
  imports: [PrimengComponentsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly api = inject(WasteLogService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);

  protected readonly info = signal<AppInfo | null>(null);
  protected readonly seeding = signal(false);

  constructor() {
    void this.load();
  }

  protected seed(): void {
    void this.run(false);
  }

  /**
   * Replacing existing data is destructive and irreversible, so it asks first
   * and spells out what goes.
   */
  protected reseed(): void {
    this.confirm.confirm({
      header: 'Replace all data with demo data',
      message:
        'This deletes every worker, series and logged waste entry, then loads a ' +
        'fresh demo month. Your reason columns are kept. This cannot be undone.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Replace everything',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => void this.run(true),
    });
  }

  private async run(force: boolean): Promise<void> {
    this.seeding.set(true);
    try {
      const summary = await this.api.seedDemoData(force);
      this.notify.success(summary);
    } catch (error) {
      // A refusal because data already exists comes back as `conflict`, and
      // reads as a warning telling the operator to use Replace instead.
      this.notify.fromCommand(error, 'Could not load the demo data.');
    } finally {
      this.seeding.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.info.set(await this.api.appInfo());
    } catch (error) {
      this.notify.fromCommand(error, 'Could not read the application details.');
    }
  }
}
