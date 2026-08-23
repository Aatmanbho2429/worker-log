import { Component, OnDestroy, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { PrimengComponentsModule } from '../../shared/primeng-components-module';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

@Component({
  selector: 'app-shell',
  imports: [PrimengComponentsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
})
export class Shell implements OnDestroy {
  protected readonly sections: NavSection[] = [
    {
      label: 'Floor',
      items: [
        { label: 'Waste log', icon: 'pi pi-bolt', route: '/waste' },
        { label: 'Month sheet', icon: 'pi pi-table', route: '/sheet' },
        { label: 'Reports', icon: 'pi pi-file-pdf', route: '/reports' },
      ],
    },
    {
      label: 'Masters',
      items: [
        { label: 'Workers', icon: 'pi pi-users', route: '/workers' },
        { label: 'Series of product', icon: 'pi pi-box', route: '/series' },
        { label: 'Reasons', icon: 'pi pi-tags', route: '/reasons' },
      ],
    },
  ];

  protected readonly clock = signal(this.stamp());

  private readonly timer = setInterval(() => this.clock.set(this.stamp()), 30_000);

  ngOnDestroy(): void {
    clearInterval(this.timer);
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
