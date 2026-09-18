import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

import { DIALOG_WIDTH } from './models/constants';
import { UpdatesService } from './core/updates.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastModule, ConfirmDialogModule],
  templateUrl: './app.html',
  host: { class: 'app' },
})
export class App {
  protected readonly DIALOG_WIDTH = DIALOG_WIDTH;

  constructor() {
    const translate = inject(TranslateService);
    translate.setDefaultLang('en');
    translate.use('en');

    // Started here, at app boot, rather than in `Shell` — `Shell` only
    // mounts once someone is signed in, and starting the check that late
    // would mean a cold start does no check until then. The 6-hour poll and
    // the answer (`UpdatesService.available`) are both ready by the time the
    // shell renders and the banner needs them.
    inject(UpdatesService).start();
  }
}
