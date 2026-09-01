import {
  ApplicationConfig,
  importProvidersFrom,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { AuthBackend } from './core/auth.backend';
import { createTranslateLoader } from './core/custom-translate-loader';
import { TauriAuthBackend } from './core/tauri-auth.backend';
import { WasteLogPreset } from './theme';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zone.js change detection with coalescing: the waste grid fires a burst
    // of events per tap and one detection pass for the burst is enough.
    provideZoneChangeDetection({ eventCoalescing: true, runCoalescing: true }),
    provideAnimationsAsync(),
    // Only the translation loader speaks HTTP now; the register itself goes
    // over Tauri's IPC.
    provideHttpClient(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    importProvidersFrom(
      TranslateModule.forRoot({
        defaultLanguage: 'en',
        loader: {
          provide: TranslateLoader,
          useFactory: createTranslateLoader,
          deps: [HttpClient],
        },
      }),
    ),
    providePrimeNG({
      theme: {
        preset: WasteLogPreset,
        options: {
          darkModeSelector: '.app-dark',
        },
      },
    }),
    MessageService,
    ConfirmationService,
    // Accounts go through Rust, like everything else that leaves this window.
    // The project URL, the anon key, the session tokens and the licence check
    // are all in `src-tauri/src/auth.rs`; nothing about Supabase is in `web/`.
    { provide: AuthBackend, useClass: TauriAuthBackend },
  ],
};
