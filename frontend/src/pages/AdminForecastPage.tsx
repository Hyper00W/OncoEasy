import { useEffect, useMemo, useState } from "react";

import { ApiError } from "../api/client";
import { AdminPortalShell } from "../admin/AdminPortalShell";
import { AdminDetailPanel } from "../components/admin/AdminDetailPanel";
import { AdminFilterBar, AdminSearchInput } from "../components/admin/AdminFilterBar";
import { AdminPagination, AdminTable, type AdminColumn } from "../components/admin/AdminTable";
import {
  CountUp,
  ForecastBarList,
  ForecastDonut,
  ForecastTimelineChart,
  Sparkline,
  type BarRow,
  type SeriesPoint
} from "../components/admin/forecast-charts";
import { StatusChip } from "../components/StatusChip";
import { formatDate, formatDateTime, formatStatusLabel } from "../components/status-utils";
import { Alert, Button, LoadingState } from "../components/ui";
import { Reveal } from "../motion/motion";
import {
  dataSufficiencyValues,
  forecastHorizons,
  getForecastBacktest,
  getForecastProduct,
  getForecastSummary,
  getForecastTimeline,
  listForecastProducts,
  type DataSufficiency,
  type ForecastBacktest,
  type ForecastHorizonDays,
  type ForecastProductDetail,
  type ForecastProductsQuery,
  type ForecastRow,
  type ForecastSummary,
  type ForecastTimeline
} from "../pharmacy/forecast-api";

type Navigate = (path: string) => void;

const PAGE_SIZE = 12;

/** Parses a lightweight shareable query string (?h=30&q=...&s=...&p=2). */
function readUrlState(): { horizon: ForecastHorizonDays; search: string; sufficiency: string; page: number } {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const horizonParam = Number(params.get("h"));
  const horizon = [7, 14, 30].includes(horizonParam) ? (horizonParam as ForecastHorizonDays) : 7;
  return {
    horizon,
    search: params.get("q") ?? "",
    sufficiency: params.get("s") ?? "",
    page: Math.max(1, Number(params.get("p")) || 1)
  };
}

function writeUrlState(state: { horizon: ForecastHorizonDays; search: string; sufficiency: string; page: number }): void {
  const params = new URLSearchParams();
  if (state.horizon !== 7) params.set("h", String(state.horizon));
  if (state.search) params.set("q", state.search);
  if (state.sufficiency) params.set("s", state.sufficiency);
  if (state.page > 1) params.set("p", String(state.page));
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

/** Demand status bands, derived from API fields (no new backend math). */
type DemandBand = "growth" | "stable" | "decline" | "insufficient";

function bandOf(row: ForecastRow): DemandBand | null {
  if (row.predictedQuantity === null || row.trendPerDay === null) return row.totalHistoricalDemand > 0 ? "insufficient" : null;
  const base = Math.max(row.averageHistoricalDemand, 0.0001);
  const change = row.trendPerDay * 14 / base; // 14-day projected change vs baseline
  if (change > 0.08) return "growth";
  if (change < -0.08) return "decline";
  return "stable";
}

const BAND_LABELS: Record<DemandBand, string> = {
  growth: "Demand growth",
  stable: "Stable demand",
  decline: "Declining demand",
  insufficient: "Low / sparse data"
};

/**
 * DEMAND FORECAST ENGINE (Phase 8 premium workspace).
 *
 * A read-only analytics layer over the existing deterministic, recency-weighted
 * statistical engine — every number, bar and line comes from the forecast API
 * (summary / products / product detail / timeline / backtest). No new math, no
 * fabricated confidence, no invented stock levels: products without enough
 * delivered-order history render "insufficient data", and the projected region
 * of the hero chart is labelled a statistical forecast, never a confidence band.
 */
export function AdminForecastPage({ navigate }: { navigate: Navigate }) {
  const initial = useMemo(() => readUrlState(), []);
  const [horizon, setHorizon] = useState<ForecastHorizonDays>(initial.horizon);
  const [searchInput, setSearchInput] = useState(initial.search);
  const [search, setSearch] = useState(initial.search);
  const [sufficiency, setSufficiency] = useState<DataSufficiency | "">(initial.sufficiency as DataSufficiency | "");
  const [sort, setSort] = useState<NonNullable<ForecastProductsQuery["sort"]>>("predictedQuantity");
  const [page, setPage] = useState(initial.page);

  const [summary, setSummary] = useState<ForecastSummary | null>(null);
  const [timeline, setTimeline] = useState<ForecastTimeline | null>(null);
  const [backtest, setBacktest] = useState<ForecastBacktest | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 });
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const [selectedProduct, setSelectedProduct] = useState<ForecastProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const hasAnyData = useMemo(
    () => Boolean(summary && summary.totals.productsWithDemandHistory > 0),
    [summary]
  );

  useEffect(() => {
    let cancelled = false;

    getForecastSummary({ horizonDays: horizon })
      .then((response) => {
        if (cancelled) return;
        setSummary(response);
        setSummaryError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setSummaryError(getErrorMessage(requestError));
      });

    getForecastTimeline({ horizonDays: horizon })
      .then((response) => {
        if (cancelled) return;
        setTimeline(response);
      })
      .catch(() => {
        /* the hero chart simply stays unavailable; summary errors already surface */
      });

    getForecastBacktest({ horizonDays: horizon })
      .then((response) => {
        if (cancelled) return;
        setBacktest(response);
      })
      .catch(() => {
        if (cancelled) return;
        setBacktest(null);
      });

    listForecastProducts({
      horizonDays: horizon,
      page,
      pageSize: PAGE_SIZE,
      search: search || undefined,
      dataSufficiency: sufficiency || undefined,
      sort,
      order: sort === "sku" || sort === "productName" ? "asc" : "desc"
    })
      .then((response) => {
        if (cancelled) return;
        setRows(response.items);
        setPagination(response.pagination);
        setListError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setListError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [horizon, page, search, sufficiency, sort, reloadToken]);

  function beginFetch(): void {
    setLoading(true);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
    beginFetch();
  }

  function clearFilters(): void {
    setSearchInput("");
    setSufficiency("");
    setPage(1);
    setSearch("");
    beginFetch();
  }

  function changeHorizon(days: ForecastHorizonDays): void {
    setHorizon(days);
    setPage(1);
    beginFetch();
  }

  useEffect(() => {
    writeUrlState({ horizon, search, sufficiency, page });
  }, [horizon, search, sufficiency, page]);

  function openProduct(row: ForecastRow): void {
    setDetailLoading(true);
    setDetailError(null);
    getForecastProduct(row.productId, { horizonDays: horizon })
      .then((detail) => {
        setSelectedProduct(detail);
        setDetailLoading(false);
      })
      .catch((requestError: unknown) => {
        setDetailLoading(false);
        setDetailError(getErrorMessage(requestError));
      });
  }

  const columns: AdminColumn<ForecastRow>[] = [
    {
      header: "Medicine",
      cell: (row) => (
        <div className="forecast-product-cell">
          <strong>{row.productName}</strong>
          <span className="muted">{row.categoryName ?? "Uncategorized"}</span>
        </div>
      ),
      label: "Medicine"
    },
    { header: "SKU", cell: (row) => <code className="forecast-sku">{row.sku}</code>, label: "SKU" },
    {
      header: "Historical units",
      cell: (row) => (
        <span>
          {row.totalHistoricalDemand}
          <span className="muted"> • {row.recentDemand} recent</span>
        </span>
      ),
      label: "Historical units"
    },
    {
      header: `Forecast (${horizon}d)`,
      cell: (row) =>
        row.predictedQuantity === null ? (
          <span className="muted" title="Not enough delivered-order history">—</span>
        ) : (
          <strong>{row.predictedQuantity}</strong>
        ),
      label: `Forecast (${horizon}d)`
    },
    {
      header: "Trend",
      cell: (row) => <TrendBadge row={row} />,
      label: "Trend"
    },
    {
      header: "Method",
      cell: (row) => (
        <span className="muted">
          {row.method === "NONE" ? "Not enough history" : formatStatusLabel(row.method)}
        </span>
      ),
      label: "Method"
    },
    {
      header: "Data",
      cell: (row) => <StatusChip status={row.dataSufficiency} />,
      label: "Data"
    },
    {
      header: "Actions",
      hideHeader: true,
      cell: (row) => (
        <Button className="button-secondary button-sm" type="button" onClick={() => openProduct(row)}>
          Details
        </Button>
      ),
      label: "Actions"
    }
  ];

  const topBarRows: BarRow[] = (summary?.topProducts ?? [])
    .filter((product) => product.predictedQuantity !== null)
    .slice(0, 8)
    .map((product) => ({
      id: product.productId,
      label: product.productName,
      value: product.predictedQuantity ?? 0,
      secondary: product.totalHistoricalDemand,
      secondaryLabel: "observed"
    }));

  const bandGroups = useMemo(() => {
    const groups: Record<DemandBand, ForecastRow[]> = { growth: [], stable: [], decline: [], insufficient: [] };
    for (const row of rows) {
      const band = bandOf(row);
      if (band) groups[band].push(row);
    }
    return groups;
  }, [rows]);

  const dailySpark = useMemo(
    () => (timeline ? timeline.historical.slice(-30).map((point) => ({ date: point.date, units: point.units })) : []),
    [timeline]
  );

  const donutSlices = summary
    ? [
        { id: "high", label: "High data", value: summary.dataSufficiency.HIGH_DATA_SUFFICIENCY, className: "dfc-slice-high" },
        { id: "medium", label: "Medium data", value: summary.dataSufficiency.MEDIUM_DATA_SUFFICIENCY, className: "dfc-slice-medium" },
        { id: "low", label: "Low data", value: summary.dataSufficiency.LOW_DATA_SUFFICIENCY, className: "dfc-slice-low" },
        { id: "insufficient", label: "Insufficient", value: summary.dataSufficiency.INSUFFICIENT_DATA, className: "dfc-slice-insufficient" }
      ]
    : [];

  return (
    <AdminPortalShell navigate={navigate} activePath="/admin/forecasts" title="Demand Forecast Engine">
      {/* ================= HERO / COMMAND CENTER ================= */}
      <header className="dfe-hero" role="banner">
        <div className="dfe-hero-inner">
          <p className="dfe-hero-eyebrow">
            <span className="dfe-pulse" aria-hidden="true" />
            Inventory intelligence • Oncology pharmacy
          </p>
          <h1 className="dfe-hero-title">
            Demand Forecast <span className="dfe-hero-accent">Engine</span>
          </h1>
          <p className="dfe-hero-copy">
            Statistical intelligence for oncology pharmacy demand planning. Historical
            delivered-order demand is analysed with a recency-weighted model to project
            what stock the next {horizon} days will require.
          </p>
          <dl className="dfe-hero-meta">
            <div>
              <dt>Forecast window</dt>
              <dd>
                <span className="dfe-horizon-pills" role="group" aria-label="Forecast horizon">
                  {forecastHorizons.map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={`dfe-horizon-pill${horizon === days ? " is-active" : ""}`}
                      aria-pressed={horizon === days}
                      onClick={() => changeHorizon(days)}
                    >
                      {days}d
                    </button>
                  ))}
                </span>
              </dd>
            </div>
            <div>
              <dt>Data source</dt>
              <dd>Delivered orders only</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>Recency-weighted statistical forecast</dd>
            </div>
            <div>
              <dt>Last calculated</dt>
              <dd>{summary ? formatDateTime(summary.generatedAt) : "—"}</dd>
            </div>
          </dl>
        </div>
      </header>

      {/* ================= KPI ROW ================= */}
      {summaryError ? (
        <Alert>
          {summaryError}{" "}
          <Button className="button-link" type="button" onClick={() => { beginFetch(); setReloadToken((token) => token + 1); }}>
            Try again
          </Button>
        </Alert>
      ) : null}

      {summary ? (
        <Reveal as="section" className="dfe-kpi-grid" aria-label="Forecast KPIs" delay={60}>
          <KpiCard
            label={`Forecasted units — ${horizon} days`}
            value={summary.totals.predictedUnits}
            detail={`Across ${summary.totals.productsWithForecast} forecastable medicines`}
            spark={dailySpark}
          />
          <KpiCard
            label="Average daily demand"
            value={timeline ? Math.round(timeline.stats.averageDailyUnits * 10) / 10 : 0}
            detail={`Observed across ${timeline?.historyDays ?? summary.historyDays} days of history`}
            suffix="/day"
            decimals={1}
          />
          <KpiCard
            label="High-demand medicines"
            value={summary.dataSufficiency.HIGH_DATA_SUFFICIENCY}
            detail="Backed by the deepest delivered-order history"
          />
          <KpiCard
            label="Low-stock risk"
            value={summary.dataSufficiency.INSUFFICIENT_DATA + summary.dataSufficiency.LOW_DATA_SUFFICIENCY}
            detail="Sparse history — monitor these before committing stock"
            tone="amber"
          />
          <KpiCard
            label="Forecast coverage"
            value={summary.totals.productsWithForecast}
            detail={`${summary.totals.productsWithDemandHistory} medicine(s) with any delivered-order history`}
          />
          <KpiCard
            label="Observed units (history)"
            value={summary.totals.historicalUnits}
            detail={`Delivered in the last ${summary.historyDays} days`}
            spark={dailySpark.slice(-21)}
            tone="navy"
          />
        </Reveal>
      ) : loading ? (
        <div className="dfe-kpi-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="dfe-skeleton dfe-skeleton-kpi" key={index} />
          ))}
        </div>
      ) : null}

      {/* ================= HERO CHART ================= */}
      <Reveal as="section" className="panel panel-fluid dfe-chart-panel" delay={120} aria-label="Historical demand and statistical forecast">
        <div className="detail-header">
          <div>
            <h2>Historical demand → statistical forecast</h2>
            <p className="muted">
              Delivered-order units per day, and the engine's projection for the next {horizon} days.
              The projected region is a statistical forecast — not a confidence interval.
            </p>
          </div>
          <span className="dfe-chip">Delivered orders only</span>
        </div>
        {timeline && timeline.historical.length > 0 ? (
          <ForecastTimelineChart
            key={`${horizon}-${timeline.generatedAt}`}
            historical={timeline.historical}
            forecast={timeline.forecast}
            forecastLabel={`Statistical forecast · ${horizon}d`}
            ariaLabel={`Daily delivered demand for the last ${timeline.historyDays} days and the statistical forecast for the next ${horizon} days`}
          />
        ) : loading ? (
          <div className="dfe-skeleton dfe-skeleton-chart" aria-hidden="true" />
        ) : (
          <p className="empty-state">No delivered-order history yet — charts appear as soon as delivered orders exist.</p>
        )}
        {timeline ? (
          <p className="dfe-chart-footnote">
            {timeline.stats.historicalUnits.toLocaleString()} units observed
            {timeline.stats.peak ? ` • peak ${timeline.stats.peak.units} units on ${formatDate(timeline.stats.peak.date)}` : ""}
            {` • projected ${timeline.stats.forecastUnits.toLocaleString()} units over ${horizon} days`}
            {timeline.stats.trendPerDay !== 0 ? ` • trend ${timeline.stats.trendPerDay > 0 ? "+" : ""}${timeline.stats.trendPerDay} units/day` : ""}
          </p>
        ) : null}
      </Reveal>

      {/* ================= ANALYTICS ROWS ================= */}
      <div className="dfe-grid-2">
        <Reveal as="section" className="panel panel-fluid" delay={160} aria-label="Top medicines by forecasted demand">
          <div className="detail-header">
            <h2>Top medicines by forecasted demand</h2>
            <span className="field-hint">Projected units ({horizon}d) vs observed history</span>
          </div>
          {topBarRows.length > 0 ? (
            <ForecastBarList rows={topBarRows} valueLabel={`units / ${horizon}d`} />
          ) : (
            <p className="empty-state">{loading ? "Loading…" : "No forecastable medicines yet."}</p>
          )}
        </Reveal>

        <Reveal as="section" className="panel panel-fluid" delay={200} aria-label="Forecast confidence — data sufficiency">
          <div className="detail-header">
            <h2>Forecast confidence</h2>
            <span className="field-hint">How much history backs each forecast</span>
          </div>
          <ForecastDonut
            slices={donutSlices}
            centerLabel="medicines"
            centerValue={String(summary ? summary.totals.productsWithDemandHistory : 0)}
          />
          {backtest ? (
            <div className="dfe-backtest">
              <h3>Rolling-origin backtest</h3>
              {backtest.meaningful ? (
                <p className="muted">
                  Out-of-sample WAPE <strong>{backtest.metrics.wape === null ? "—" : `${Math.round(backtest.metrics.wape * 100)}%`}</strong>
                  {" "}• MAE <strong>{backtest.metrics.mae === null ? "—" : backtest.metrics.mae.toFixed(1)}</strong>
                  {" "}over {backtest.metrics.evaluatedPairs} product-fold pairs ({backtest.folds} folds). Errors are
                  measured in units by replaying the same engine on past windows.
                </p>
              ) : (
                <p className="muted">{backtest.reason}</p>
              )}
            </div>
          ) : null}
        </Reveal>
      </div>

      <div className="dfe-grid-3">
        {(["growth", "stable", "decline"] as const).map((band) => (
          <Reveal as="section" className="panel panel-fluid dfe-band-panel" key={band} delay={220} aria-label={BAND_LABELS[band]}>
            <div className="detail-header">
              <h2>{BAND_LABELS[band]}</h2>
              <span className={`dfe-chip dfe-chip-${band}`}>{bandGroups[band].length}</span>
            </div>
            {bandGroups[band].length === 0 ? (
              <p className="empty-state">{loading ? "Loading…" : "Nothing in this band right now."}</p>
            ) : (
              <ul className="dfe-band-list">
                {bandGroups[band].slice(0, 5).map((row) => (
                  <li key={row.productId}>
                    <button type="button" className="dfe-band-item" onClick={() => openProduct(row)}>
                      <span className="dfe-band-name">{row.productName}</span>
                      <span className="dfe-band-meta">
                        <strong>{row.predictedQuantity ?? "—"}</strong> forecast ({horizon}d)
                        <TrendBadge row={row} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Reveal>
        ))}
      </div>

      {/* ================= FILTER BAR + MEDICINE TABLE ================= */}
      <Reveal as="section" className="panel panel-fluid" delay={240} aria-label="Medicine demand table">
        <div className="detail-header">
          <h2>Medicine insights</h2>
          <span className="field-hint">
            {summary ? `${summary.totals.productsWithDemandHistory} medicine(s) with delivered-order history` : null}
          </span>
        </div>

        <div className="forecast-controls">
          <AdminFilterBar onApply={applyFilters} onClear={clearFilters} applyLabel="Apply">
            <AdminSearchInput
              id="forecast-search"
              label="Search medicine or SKU"
              value={searchInput}
              placeholder="Search medicine or SKU"
              onChange={setSearchInput}
            />
            <div className="admin-filter-field">
              <label className="visually-hidden" htmlFor="forecast-sufficiency">Data sufficiency</label>
              <select
                className="input"
                id="forecast-sufficiency"
                value={sufficiency}
                aria-label="Data sufficiency"
                onChange={(event) => {
                  setSufficiency(event.target.value as DataSufficiency | "");
                  setPage(1);
                  beginFetch();
                }}
              >
                <option value="">All data levels</option>
                {dataSufficiencyValues.map((value) => (
                  <option key={value} value={value}>{formatStatusLabel(value)}</option>
                ))}
              </select>
            </div>
            <div className="admin-filter-field">
              <label className="visually-hidden" htmlFor="forecast-sort">Sort by</label>
              <select
                className="input"
                id="forecast-sort"
                value={sort}
                aria-label="Sort by"
                onChange={(event) => {
                  setSort(event.target.value as NonNullable<ForecastProductsQuery["sort"]>);
                  setPage(1);
                  beginFetch();
                }}
              >
                <option value="predictedQuantity">Forecast quantity</option>
                <option value="recentDemand">Recent demand</option>
                <option value="totalHistoricalDemand">Historical demand</option>
                <option value="sku">SKU</option>
                <option value="productName">Name</option>
              </select>
            </div>
          </AdminFilterBar>
        </div>

        {listError ? (
          <Alert>
            {listError}{" "}
            <Button className="button-link" type="button" onClick={() => { beginFetch(); setReloadToken((token) => token + 1); }}>
              Try again
            </Button>
          </Alert>
        ) : (
          <AdminTable
            columns={columns}
            rows={rows}
            getKey={(row) => row.productId}
            loading={loading}
            loadingLabel="Loading forecast..."
            emptyTitle={
              hasAnyData
                ? "No medicines match the current filters."
                : "No historical order data available yet."
            }
            emptyHint={
              hasAnyData
                ? "Try a different search or data-level filter."
                : "Forecasts appear once delivered-order history is available."
            }
            caption={`Per-medicine statistical demand forecast for the next ${horizon} days`}
          />
        )}

        <AdminPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          singular="medicine"
          plural="medicines"
          disabled={loading}
          onPrevious={() => { beginFetch(); setPage((current) => Math.max(1, current - 1)); }}
          onNext={() => { beginFetch(); setPage((current) => current + 1); }}
        />

        <p className="dfe-demo-note">
          Figures reflect the connected environment's delivered orders. Seeded demo environments
          show <strong>DEMO / ILLUSTRATIVE DATA</strong> (SKUs prefixed <code>DEMO-</code>).
        </p>
      </Reveal>

      {/* ================= DRILL-DOWN ================= */}
      {detailLoading ? <LoadingState label="Loading medicine demand profile..." /> : null}
      {detailError ? <Alert>{detailError}</Alert> : null}

      {selectedProduct ? (
        <AdminDetailPanel
          eyebrow={`Medicine demand profile • ${selectedProduct.product.sku}`}
          title={selectedProduct.product.productName}
          onClose={() => setSelectedProduct(null)}
          rows={[
            { label: "Current demand (7d)", value: `${selectedProduct.historicalDemand.recentDemand} units` },
            {
              label: `Forecast (${horizon}d)`,
              value:
                selectedProduct.forecast.predictedQuantity === null
                  ? "— insufficient data"
                  : `${selectedProduct.forecast.predictedQuantity} units`
            },
            {
              label: "Daily rate",
              value: selectedProduct.forecast.forecastDailyRate === null ? "—" : `${selectedProduct.forecast.forecastDailyRate.toFixed(2)} units/day`
            },
            { label: "Method", value: formatStatusLabel(selectedProduct.forecast.method) },
            { label: "Data sufficiency", value: <StatusChip status={selectedProduct.forecast.dataSufficiency} /> },
            {
              label: "Average historical demand",
              value: `${selectedProduct.historicalDemand.averageDailyDemand.toFixed(2)} units/day`
            },
            {
              label: "Observed window",
              value: `${formatDate(selectedProduct.historicalDemand.observedFrom)} → ${formatDate(selectedProduct.historicalDemand.windowEnd)} (${selectedProduct.historicalDemand.observedDays} days)`
            },
            { label: "Inventory coverage", value: "Unavailable — the platform does not track stock levels yet" }
          ]}
        >
          <h3 className="forecast-history-heading">Historical demand used by the engine</h3>
          {selectedProduct.historicalDemand.daily.length === 0 ? (
            <p className="empty-state">No daily demand recorded in the observed window.</p>
          ) : (
            <ForecastBarList
              rows={weeklyBars(selectedProduct)}
              valueLabel="units / week"
            />
          )}
          <p className="dfe-chart-footnote">
            Weekly delivered-demand totals over the observed window — the exact series the
            statistical engine used for this medicine's forecast.
          </p>
        </AdminDetailPanel>
      ) : null}
    </AdminPortalShell>
  );
}

function weeklyBars(detail: ForecastProductDetail): BarRow[] {
  return detail.historicalDemand.weekly.slice(-10).map((week) => ({
    id: week.weekStart,
    label: formatDate(week.weekStart),
    value: week.units
  }));
}

function TrendBadge({ row }: { row: ForecastRow }) {
  if (row.trendPerDay === null || row.predictedQuantity === null) {
    return <span className="dfe-trend dfe-trend-flat" title="Not enough history for a trend">—</span>;
  }
  if (row.trendPerDay > 0.01) {
    return <span className="dfe-trend dfe-trend-up" title={`+${row.trendPerDay.toFixed(2)} units/day`}>▲ rising</span>;
  }
  if (row.trendPerDay < -0.01) {
    return <span className="dfe-trend dfe-trend-down" title={`${row.trendPerDay.toFixed(2)} units/day`}>▼ falling</span>;
  }
  return <span className="dfe-trend dfe-trend-flat">■ stable</span>;
}

function KpiCard({
  label,
  value,
  detail,
  suffix,
  decimals = 0,
  tone = "teal",
  spark
}: {
  label: string;
  value: number;
  detail: string;
  suffix?: string;
  decimals?: number;
  tone?: "teal" | "amber" | "navy";
  spark?: SeriesPoint[];
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <article className={`dfe-kpi dfe-kpi-${tone}${entered ? " is-entered" : ""}`} data-reduced={reducedFlag()}>
      <span className="dfe-kpi-label">{label}</span>
      {decimals > 0 ? (
        <span className="dfe-kpi-value">{formatDecimal(value, decimals)}{suffix ? <span className="dfe-count-suffix">{suffix}</span> : null}</span>
      ) : (
        <span className="dfe-kpi-value"><CountUp value={value} suffix={suffix} /></span>
      )}
      {spark && spark.length > 1 ? <Sparkline points={spark} tone={tone === "amber" ? "amber" : "teal"} /> : null}
      <span className="dfe-kpi-detail">{detail}</span>
    </article>
  );
}

function reducedFlag(): string {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "true" : "false";
}

function formatDecimal(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "The forecast request could not be completed.";
}
