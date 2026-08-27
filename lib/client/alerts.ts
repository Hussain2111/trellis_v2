'use client';

import type { AlertsResult } from '../alerts';

/**
 * One request per navigation, shared by everything that needs it.
 *
 * The banners and the nav badge come from the same data. Without this they
 * would each fetch it, which is two database round trips for one answer, on
 * every page.
 */
let inFlight: { key: string; promise: Promise<AlertsResult> } | null = null;

const EMPTY: AlertsResult = { alerts: [], overdue: 0 };

export function loadAlerts(key: string): Promise<AlertsResult> {
  if (inFlight?.key === key) return inFlight.promise;

  const promise = fetch('/api/alerts')
    .then((response) => (response.ok ? (response.json() as Promise<AlertsResult>) : EMPTY))
    .catch(() => EMPTY);

  inFlight = { key, promise };
  return promise;
}

/** After writing something the alerts depend on, so the next read is not the stale one. */
export function forgetAlerts(): void {
  inFlight = null;
}
