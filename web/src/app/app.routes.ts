import { Routes } from '@angular/router';

import { Shell } from './layout/shell/shell';

export const routes: Routes = [
  {
    path: '',
    component: Shell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'waste' },
      {
        path: 'waste',
        title: 'Waste log — Ceramic Waste Log',
        loadComponent: () => import('./views/waste/waste').then((m) => m.Waste),
      },
      {
        path: 'barcodes',
        title: 'Scanning sheet — Ceramic Waste Log',
        loadComponent: () => import('./views/barcodes/barcodes').then((m) => m.Barcodes),
      },
      {
        path: 'sheet',
        title: 'Month sheet — Ceramic Waste Log',
        loadComponent: () => import('./views/sheet/sheet').then((m) => m.Sheet),
      },
      {
        path: 'reports',
        title: 'Reports — Ceramic Waste Log',
        loadComponent: () => import('./views/reports/reports').then((m) => m.Reports),
      },
      {
        path: 'workers',
        title: 'Workers — Ceramic Waste Log',
        loadComponent: () => import('./views/workers/workers').then((m) => m.Workers),
      },
      {
        path: 'series',
        title: 'Series of product — Ceramic Waste Log',
        loadComponent: () => import('./views/series/series').then((m) => m.Series),
      },
      {
        path: 'settings',
        title: 'Settings — Ceramic Waste Log',
        loadComponent: () => import('./views/settings/settings').then((m) => m.Settings),
      },
      {
        path: 'reasons',
        title: 'Reasons — Ceramic Waste Log',
        loadComponent: () => import('./views/reasons/reasons').then((m) => m.Reasons),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
