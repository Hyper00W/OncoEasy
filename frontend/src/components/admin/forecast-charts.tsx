import type { ReactNode } from "react";

import { useCountUp, useInViewOnce } from "../../motion/hooks";

/**
 * Demand Forecast Engine — hand-built SVG charts.
 *
 * Why not a chart library: the project has zero chart dependencies, and every
 * series this page draws is small (90–120 points, top-10 bars). Dependency-free
 * SVG keeps the bundle flat, styling under the design system, and animation
 * under the existing motion language. Accessibility: every chart carries a
 * text table of its own values (visually-hidden), and reduced motion renders
 * final-state immediately.
 *
 * Honesty rule: charts draw ONLY values the forecast API returned. The
 * forecast region is the engine's own statistical projection — it is labelled
 * "Statistical forecast", never "confidence", because the backend computes a
 * deterministic rate, not an interval.
 */

export type SeriesPoint = { date: string; units: number };

function reduced(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function formatDateLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatDateLabelLong(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Day-over-day-suffix tick label generator: ~6 evenly spaced ticks. */
function pickTicks(count: number): number[] {
  if (count <= 1) return [0];
  const ticks: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    ticks.push(Math.round((i * (count - 1)) / 5));
  }
  return [...new Set(ticks)];
}

/* -------------------------------------------------------------------------- */
/*  Historic → forecast time series (the hero chart)                          */
/* -------------------------------------------------------------------------- */

export type TimelineChartProps = {
  historical: SeriesPoint[];
  forecast: SeriesPoint[];
  /** Short label for the forecast region, e.g. "Statistical forecast · 14d". */
  forecastLabel: string;
  ariaLabel: string;
};

/**
 * The centerpiece: historical delivered demand (solid line + soft area) and
 * the statistical forecast (dashed, in the forecast band). The transition
 * point between observed and projected data is marked with a vertical rule.
 * The forecast path draws itself with a stroke-dash animation on first reveal;
 * horizon changes re-trigger the draw via the key prop at the call site.
 */
export function ForecastTimelineChart({ historical, forecast, forecastLabel, ariaLabel }: TimelineChartProps) {
  const { ref, inView } = useInViewOnce<HTMLDivElement>(0.2);
  const reducedMotion = reduced();
  const width = 960;
  const height = 320;
  const padX = 46;
  const padTop = 18;
  const padBottom = 30;

  const all = [...historical, ...forecast];
  const maxUnits = Math.max(1, ...all.map((point) => point.units));
  const yMax = Math.ceil(maxUnits * 1.15);
  const histCount = historical.length;
  const totalCount = all.length;

  const x = (index: number): number =>
    padX + (index / Math.max(1, totalCount - 1)) * (width - padX - 12);
  const y = (units: number): number =>
    padTop + (1 - units / yMax) * (height - padTop - padBottom);

  const histPath = historical
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.units).toFixed(1)}`)
    .join(" ");
  const histArea = histCount > 0
    ? `${histPath} L${x(histCount - 1).toFixed(1)},${(height - padBottom).toFixed(1)} L${padX},${(height - padBottom).toFixed(1)} Z`
    : "";
  // The forecast line is visually connected: it starts at the last observed
  // point, then follows the engine's projected daily rate.
  const forecastD = [
    ...(histCount > 0
      ? [`M${x(histCount - 1).toFixed(1)},${y(historical[histCount - 1].units).toFixed(1)}`]
      : []),
    ...forecast.map((point, index) => {
      const xIndex = histCount + index - (histCount > 0 ? 1 : 0);
      return `L${x(xIndex).toFixed(1)},${y(point.units).toFixed(1)}`;
    })
  ].join(" ");

  const revealed = inView || reducedMotion;
  const gridLines = [0.25, 0.5, 0.75, 1].map((fraction) => padTop + fraction * (height - padTop - padBottom));
  const xTicks = pickTicks(histCount).map((index) => ({ index, label: formatDateLabel(historical[index].date) }));
  const fTicks = forecast.length > 1 ? [{ index: histCount + forecast.length - 1, label: formatDateLabel(forecast[forecast.length - 1].date) }] : [];

  return (
    <div className={`dfc-chart${revealed ? " is-revealed" : ""}`} ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="dfc-svg"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        {gridLines.map((lineY) => (
          <line key={lineY} x1={padX} x2={width - 12} y1={lineY} y2={lineY} className="dfc-grid" />
        ))}

        {/* Forecast region band */}
        {histCount > 0 ? (
          <rect
            x={x(histCount - 1)}
            y={padTop}
            width={Math.max(0, width - 12 - x(histCount - 1))}
            height={height - padTop - padBottom}
            className="dfc-forecast-band"
          />
        ) : null}

        {/* Historical area + line */}
        {histArea ? <path d={histArea} className="dfc-area" /> : null}
        <path d={histPath} className="dfc-line dfc-line-historical" style={revealed ? undefined : { strokeDasharray: "1", strokeDashoffset: "1" }} />

        {/* Transition marker */}
        {histCount > 0 ? (
          <line x1={x(histCount - 1)} x2={x(histCount - 1)} y1={padTop} y2={height - padBottom} className="dfc-transition" />
        ) : null}

        {/* Forecast dashed line */}
        {forecast.length > 0 ? (
          <path d={forecastD} className="dfc-line dfc-line-forecast" style={revealed ? undefined : { strokeDasharray: "1", strokeDashoffset: "1" }} />
        ) : null}

        {/* Peak marker on history */}
        {historical.length > 0
          ? historical.map((point, index) =>
              point.units === Math.max(...historical.map((candidate) => candidate.units)) && point.units > 0 ? (
                <circle key={`peak-${point.date}`} cx={x(index)} cy={y(point.units)} r={3.5} className="dfc-peak-dot" />
              ) : null
            )
          : null}

        {/* Axis labels */}
        {xTicks.map((tick) => (
          <text key={`x-${tick.index}`} x={x(tick.index)} y={height - 8} className="dfc-axis-label" textAnchor="middle">
            {tick.label}
          </text>
        ))}
        {fTicks.map((tick) => (
          <text key={`fx-${tick.index}`} x={x(tick.index)} y={height - 8} className="dfc-axis-label dfc-axis-label-forecast" textAnchor="end">
            {tick.label}
          </text>
        ))}
        {[0, yMax].map((value) => (
          <text key={`y-${value}`} x={padX - 8} y={y(value) + 4} className="dfc-axis-label" textAnchor="end">
            {value}
          </text>
        ))}

        {/* Region caption — right-aligned inside the viewBox so it can never
        extend past the chart edge when the historical series is short. */}
        {histCount > 0 ? (
          <text x={width - 4} y={padTop + 12} className="dfc-region-label" textAnchor="end">
            {forecastLabel}
          </text>
        ) : null}
      </svg>

      {/* Accessible data table — wrapped so its intrinsic width can never
      widen the chart panel (visually-hidden alone is not absolutely positioned). */}
      <div className="dfc-data-table">
        <table className="visually-hidden">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Units</th>
            <th scope="col">Series</th>
          </tr>
        </thead>
        <tbody>
          {historical.map((point) => (
            <tr key={`h-${point.date}`}>
              <td>{formatDateLabelLong(point.date)}</td>
              <td>{point.units}</td>
              <td>Historical delivered demand</td>
            </tr>
          ))}
          {forecast.map((point) => (
            <tr key={`f-${point.date}`}>
              <td>{formatDateLabelLong(point.date)}</td>
              <td>{Math.round(point.units)}</td>
              <td>{forecastLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="dfc-legend" aria-hidden="true">
        <span className="dfc-legend-item"><span className="dfc-swatch dfc-swatch-history" /> Historical delivered demand</span>
        <span className="dfc-legend-item"><span className="dfc-swatch dfc-swatch-forecast" /> {forecastLabel}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Horizontal bars (top medicines)                                           */
/* -------------------------------------------------------------------------- */

export type BarRow = {
  id: string;
  label: string;
  value: number;
  secondary?: number;
  secondaryLabel?: string;
  caption?: ReactNode;
};

export function ForecastBarList({ rows, valueLabel }: { rows: BarRow[]; valueLabel: string }) {
  const { ref, inView } = useInViewOnce<HTMLDivElement>(0.2);
  const reducedMotion = reduced();
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <div className={`dfc-bars${inView || reducedMotion ? " is-revealed" : ""}`} ref={ref}>
      {rows.map((row) => (
        <div className="dfc-bar-row" key={row.id}>
          <div className="dfc-bar-meta">
            <span className="dfc-bar-label" title={row.label}>{row.label}</span>
            <span className="dfc-bar-value">
              <strong>{row.value.toLocaleString()}</strong>
              <span className="dfc-bar-value-label">{valueLabel}</span>
              {row.secondary !== undefined ? (
                <span className="dfc-bar-secondary">
                  {row.secondaryLabel}: {row.secondary.toLocaleString()}
                </span>
              ) : null}
            </span>
          </div>
          <div className="dfc-bar-track" role="presentation">
            <div className="dfc-bar-fill" style={{ width: `${Math.max(2, Math.round((row.value / max) * 100))}%` }} />
          </div>
          {row.caption ? <div className="dfc-bar-caption">{row.caption}</div> : null}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Donut (data sufficiency distribution)                                     */
/* -------------------------------------------------------------------------- */

export type DonutSlice = { id: string; label: string; value: number; className: string };

export function ForecastDonut({ slices, centerLabel, centerValue }: { slices: DonutSlice[]; centerLabel: string; centerValue: string }) {
  const { ref, inView } = useInViewOnce<HTMLDivElement>(0.3);
  const reducedMotion = reduced();
  const revealed = inView || reducedMotion;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offsetAccumulator = 0;

  return (
    <div className={`dfc-donut${revealed ? " is-revealed" : ""}`} ref={ref}>
      <svg viewBox="0 0 140 140" className="dfc-donut-svg" role="img" aria-label={`${centerLabel}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join(", ")}`}>
        <circle cx="70" cy="70" r={radius} className="dfc-donut-track" />
        {total > 0
          ? slices.map((slice) => {
              if (slice.value === 0) return null;
              const fraction = slice.value / total;
              const dash = fraction * circumference;
              const element = (
                <circle
                  key={slice.id}
                  cx="70"
                  cy="70"
                  r={radius}
                  className={`dfc-donut-slice ${slice.className}`}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offsetAccumulator}
                />
              );
              offsetAccumulator += dash;
              return element;
            })
          : null}
        <text x="70" y="66" className="dfc-donut-value" textAnchor="middle">{centerValue}</text>
        <text x="70" y="84" className="dfc-donut-label" textAnchor="middle">{centerLabel}</text>
      </svg>
      <ul className="dfc-donut-legend">
        {slices.map((slice) => (
          <li key={slice.id}>
            <span className={`dfc-swatch ${slice.className}`} aria-hidden="true" />
            {slice.label}
            <strong>{slice.value.toLocaleString()}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sparkline (KPI cards)                                                     */
/* -------------------------------------------------------------------------- */

export function Sparkline({ points, tone = "teal" }: { points: SeriesPoint[]; tone?: "teal" | "amber" }) {
  if (points.length < 2) return null;
  const width = 120;
  const height = 34;
  const max = Math.max(1, ...points.map((point) => point.units));
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - 3 - (point.units / max) * (height - 6);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`dfc-spark dfc-spark-${tone}`} aria-hidden="true" preserveAspectRatio="none">
      <path d={area} className="dfc-spark-area" />
      <path d={path} className="dfc-spark-line" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Count-up number (KPI)                                                     */
/* -------------------------------------------------------------------------- */

export function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const { ref, display } = useCountUp(value, 950);
  return (
    <span ref={ref as React.Ref<HTMLSpanElement>} className="dfc-count">
      {display}
      {suffix ? <span className="dfc-count-suffix">{suffix}</span> : null}
    </span>
  );
}
