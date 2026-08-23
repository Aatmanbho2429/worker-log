import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { NgHttpLoaderComponent, Spinkit } from 'ng-http-loader';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NgHttpLoaderComponent, ToastModule, ConfirmDialogModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly spinkit = Spinkit;

  constructor() {
    const translate = inject(TranslateService);
    translate.setDefaultLang('en');
    translate.use('en');
  }
}
