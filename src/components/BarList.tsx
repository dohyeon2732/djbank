import { useChartTip } from '../lib/hooks';
import { ChartTip } from './ChartTip';

export interface BarRow {
  key: string;
  label: string;
  value: number;
  display: string;
  tip: string;
  lo?: number | null;
  hi?: number | null;
  muted?: boolean;
}

export function BarList({ rows, max }: { rows: BarRow[]; max: number }) {
  const { tip, show, hide } = useChartTip();
  const toPercent = (value: number) => `${Math.min(100, (value / max) * 100)}%`;

  return (
    <div className="bars" data-tip-root>
      <ul className="bars-list">
        {rows.map((row) => (
          <li
            key={row.key}
            className="bars-row"
            onMouseMove={(event) => show(event, row.tip)}
            onMouseLeave={hide}
          >
            <span className="bars-label">{row.label}</span>
            <span className="bars-track">
              <span
                className={`bars-fill${row.muted ? ' bars-fill--muted' : ''}`}
                style={{ width: toPercent(row.value) }}
              />
              {row.lo != null && row.hi != null && (
                <span
                  className="bars-interval"
                  style={{ left: toPercent(row.lo), width: `${((row.hi - row.lo) / max) * 100}%` }}
                />
              )}
            </span>
            <span className="bars-value">{row.display}</span>
          </li>
        ))}
      </ul>
      <ChartTip tip={tip} />
    </div>
  );
}
