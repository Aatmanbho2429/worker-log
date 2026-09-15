import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

import { DIALOG_WIDTH } from './models/constants';

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
  }
}
