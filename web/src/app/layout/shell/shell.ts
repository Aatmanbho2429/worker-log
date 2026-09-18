import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth.service';
import { NotifyService } from '../../core/notify.service';
import { PictoriaService } from '../../core/pictoria.service';
import { UpdatesService } from '../../core/updates.service';
import { accountFullName, accountInitials } from '../../models/auth';
import {
  ROUTE_BARCODES,
  ROUTE_GRADES,
  ROUTE_LOGIN,
  ROUTE_PROFILE,
  ROUTE_REASONS,
  ROUTE_REPORTS,
  ROUTE_SERIES,
  ROUTE_SETTINGS,
  ROUTE_SHEET,
  ROUTE_WASTE,
  ROUTE_WORKERS,
} from '../../models/constants';
import { SettingsService } from '../../services/settings/settings.service';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';
import { UpdateBanner } from '../../shared/update-banner/update-banner';

interface NavItem {
  /** A translation key, resolved by the template. */
  label: string;
  icon: string;
  route: string;
}

interface NavSection {
  /** A translation key, resolved by the template. */
  label: string;
  items: NavItem[];
}

@Component({
  selector: 'app-shell',
  imports: [PrimengComponentsModule, RouterOutlet, RouterLink, RouterLinkActive, UpdateBanner],
  templateUrl: './shell.html',
})
export class Shell implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly notify = inject(NotifyService);
  private readonly pictoria = inject(PictoriaService);
  private readonly settingsApi = inject(SettingsService);
  private readonly updates = inject(UpdatesService);

  protected readonly sections: NavSection[] = [
    {
      label: 'shell.sectionFloor',
      items: [
        { label: 'shell.navWaste', icon: 'pi pi-bolt', route: ROUTE_WASTE },
        { label: 'shell.navBarcodes', icon: 'pi pi-qrcode', route: ROUTE_BARCODES },
        { label: 'shell.navSheet', icon: 'pi pi-table', route: ROUTE_SHEET },
        { label: 'shell.navReports', icon: 'pi pi-file-pdf', route: ROUTE_REPORTS },
      ],
    },
    {
      label: 'shell.sectionMasters',
      items: [
        { label: 'shell.navWorkers', icon: 'pi pi-users', route: ROUTE_WORKERS },
        { label: 'shell.navSeries', icon: 'pi pi-box', route: ROUTE_SERIES },
        { label: 'shell.navReasons', icon: 'pi pi-tags', route: ROUTE_REASONS },
        { label: 'shell.navGrades', icon: 'pi pi-sliders-h', route: ROUTE_GRADES },
        // Not advertised in the nav — the manual "Check for updates" action
        // now lives on the version tag in the topbar (see `checkForUpdates()`
        // below). The screen itself, and `ROUTE_SETTINGS`, stay reachable by
        // URL for support (it's the only place showing the database path).
        // { label: 'shell.navSettings', icon: 'pi pi-cog', route: ROUTE_SETTINGS },
      ],
    },
    {
      // The topbar chip goes to the same place, but the topbar is hidden on a
      // narrow window and the nav is not.
      label: 'shell.sectionAccount',
      items: [{ label: 'shell.navProfile', icon: 'pi pi-user', route: ROUTE_PROFILE }],
    },
  ];

  protected readonly ROUTE_PROFILE = ROUTE_PROFILE;

  /**
   * The Floor and Masters sections disappear while the subscription is
   * expired — `authGuard` already refuses to navigate there, this just keeps
   * the operator from clicking a link that silently bounces them back to
   * `/profile`, the one place still open. Account (profile, sign-out) stays.
   */
  protected readonly visibleSections = computed(() =>
    this.auth.subscriptionExpired()
      ? this.sections.filter((section) => section.label === 'shell.sectionAccount')
      : this.sections,
  );

  protected readonly user = this.auth.user;

  protected readonly initials = computed(() => {
    const user = this.user();
    return user ? accountInitials(user) : '';
  });

  protected readonly fullName = computed(() => {
    const user = this.user();
    return user ? accountFullName(user) : '';
  });

  protected readonly clock = signal(this.stamp());

  private readonly timer = setInterval(() => this.clock.set(this.stamp()), 30_000);

  /** The version shown as a tag beside the company name. `null` until it loads. */
  protected readonly version = signal<string | null>(null);

  constructor() {
    void this.loadVersion();
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  /**
   * The version tag's own click target. Not worth a toast on failure — it's
   * a meta detail in the topbar, not a command the operator is waiting on.
   */
  private async loadVersion(): Promise<void> {
    try {
      const info = await this.settingsApi.appInfo();
      this.version.set(info.version);
    } catch {
      // Leave it at '—' (the template's fallback) rather than surfacing an
      // error for a detail this minor.
    }
  }

  /**
   * The manual counterpart to `UpdatesService`'s background poll: this one
   * always tells the operator something, success or failure. A newer version
   * found here shows up in the shell's own banner too — this doesn't install
   * anything itself. Mirrors `views/settings/settings.ts`'s method of the
   * same name, which is where this lived before Settings left the nav.
   */
  protected async checkForUpdates(): Promise<void> {
    try {
      const result = await this.updates.checkNow();
      if (result === 'available') {
        this.notify.info(
          this.translate.instant('update.availableToast', {
            version: this.updates.available()?.version,
          }),
        );
      } else {
        this.notify.success(this.translate.instant('update.upToDate'));
      }
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('update.checkFailed'));
    }
  }

  /** The sidebar credit's link. A dead link is not worth a toast. */
  protected openPictoria(): void {
    this.pictoria
      .openSite()
      .catch((err) => console.warn('[shell] could not open pictoria.shop:', err));
  }

  /**
   * Signing out is cheap to undo but expensive to do by accident mid-shift, so
   * it asks first.
   */
  protected signOut(): void {
    this.confirm.confirm({
      header: this.translate.instant('shell.signOut'),
      message: this.translate.instant('shell.signOutConfirm'),
      icon: 'pi pi-sign-out',
      acceptLabel: this.translate.instant('shell.signOutAccept'),
      rejectLabel: this.translate.instant('shell.signOutReject'),
      rejectButtonStyleClass: 'p-button-secondary',
      accept: async () => {
        await this.auth.logout();
        await this.router.navigate([ROUTE_LOGIN]);
      },
    });
  }

  private stamp(): string {
    return new Date().toLocaleString('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
