import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { DividerModule } from 'primeng/divider';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { RippleModule } from 'primeng/ripple';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';

/**
 * The PrimeNG surface the app actually uses, bundled so each standalone view
 * imports one symbol instead of a dozen.
 */
const MODULES = [
  CommonModule,
  FormsModule,
  RouterModule,
  ButtonModule,
  ConfirmDialogModule,
  DatePickerModule,
  DialogModule,
  DividerModule,
  IconFieldModule,
  InputIconModule,
  InputTextModule,
  MessageModule,
  ProgressSpinnerModule,
  RippleModule,
  SelectModule,
  SelectButtonModule,
  SkeletonModule,
  TableModule,
  TabsModule,
  TagModule,
  ToastModule,
  TooltipModule,
];

@NgModule({
  imports: MODULES,
  exports: MODULES,
})
export class PrimengComponentsModule {}
