import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth.service';
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
import { PrimengComponentsModule } from '../../shared/primeng-components-module';

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
  imports: [PrimengComponentsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
})
export class Shell implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

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
        { label: 'shell.navSettings', icon: 'pi pi-cog', route: ROUTE_SETTINGS },
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

  ngOnDestroy(): void {
    clearInterval(this.timer);
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
      rejectButtonStyleClass: 'p-button-text',
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
