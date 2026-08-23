import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  Dashboard,
  LogEntryPayload,
  RangeFilter,
  Reason,
  ReasonPayload,
  SeriesOfProduct,
  SeriesPayload,
  Worker,
  WorkerDeleteImpact,
  WorkerLog,
  WorkerPayload,
} from '../models';

const API = '/api';

@Injectable({ providedIn: 'root' })
export class WasteLogService {
  private readonly http = inject(HttpClient);

  // ------------------------------------------------------------- series ---

  listSeries(): Observable<SeriesOfProduct[]> {
    return this.http.get<SeriesOfProduct[]>(`${API}/series`);
  }

  createSeries(payload: SeriesPayload): Observable<SeriesOfProduct> {
    return this.http.post<SeriesOfProduct>(`${API}/series`, payload);
  }

  updateSeries(id: number, payload: SeriesPayload): Observable<SeriesOfProduct> {
    return this.http.put<SeriesOfProduct>(`${API}/series/${id}`, payload);
  }

  deleteSeries(id: number): Observable<void> {
    return this.http.delete<void>(`${API}/series/${id}`);
  }

  // ------------------------------------------------------------ reasons ---

  listReasons(): Observable<Reason[]> {
    return this.http.get<Reason[]>(`${API}/reasons`);
  }

  createReason(payload: ReasonPayload): Observable<Reason> {
    return this.http.post<Reason>(`${API}/reasons`, payload);
  }

  updateReason(id: number, payload: ReasonPayload): Observable<Reason> {
    return this.http.put<Reason>(`${API}/reasons/${id}`, payload);
  }

  deleteReason(id: number): Observable<void> {
    return this.http.delete<void>(`${API}/reasons/${id}`);
  }

  // ------------------------------------------------------------ workers ---

  listWorkers(seriesId?: number | null): Observable<Worker[]> {
    let params = new HttpParams();
    if (seriesId) {
      params = params.set('seriesId', seriesId);
    }
    return this.http.get<Worker[]>(`${API}/workers`, { params });
  }

  createWorker(payload: WorkerPayload): Observable<Worker> {
    return this.http.post<Worker>(`${API}/workers`, payload);
  }

  updateWorker(id: number, payload: WorkerPayload): Observable<Worker> {
    return this.http.put<Worker>(`${API}/workers/${id}`, payload);
  }

  /** How much history a delete would take with it. */
  workerDeleteImpact(id: number): Observable<WorkerDeleteImpact> {
    return this.http.get<WorkerDeleteImpact>(`${API}/workers/${id}/impact`);
  }

  deleteWorker(id: number): Observable<void> {
    return this.http.delete<void>(`${API}/workers/${id}`);
  }

  // -------------------------------------------------------------- waste ---

  dashboard(filter: RangeFilter): Observable<Dashboard> {
    return this.http.get<Dashboard>(`${API}/waste/dashboard`, {
      params: rangeParams(filter),
    });
  }

  logs(filter: RangeFilter, workerId?: number | null): Observable<WorkerLog[]> {
    let params = rangeParams(filter);
    if (workerId) {
      params = params.set('workerId', workerId);
    }
    return this.http.get<WorkerLog[]>(`${API}/waste/logs`, { params });
  }

  /** One tap of a grade button. */
  addEntry(payload: LogEntryPayload): Observable<WorkerLog> {
    return this.http.post<WorkerLog>(`${API}/waste/logs`, payload);
  }

  /**
   * Undoes the most recent matching tap. The range travels with the request so
   * the server only ever removes an entry from the period on screen.
   */
  undoEntry(payload: LogEntryPayload, filter: RangeFilter): Observable<WorkerLog> {
    return this.http.post<WorkerLog>(`${API}/waste/logs/undo`, {
      ...payload,
      from: filter.from,
      to: filter.to,
    });
  }

  // ------------------------------------------------------------ reports ---

  reportUrl(filter: RangeFilter, format: 'pdf' | 'csv'): string {
    return `${API}/reports/waste-log.${format}?${rangeParams(filter).toString()}`;
  }
}

function rangeParams(filter: RangeFilter): HttpParams {
  let params = new HttpParams().set('from', filter.from).set('to', filter.to);
  if (filter.seriesId) {
    params = params.set('seriesId', filter.seriesId);
  }
  return params;
}
