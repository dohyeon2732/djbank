import { useState } from 'react';
import { pct } from '../lib/format';
import { useElementWidth } from '../lib/hooks';
import type { RatePoint } from '../lib/selectors';

export interface TrendSeries {
  name: string;
  tone: 'primary' | 'secondary';
  points: RatePoint[];
}

const HEIGHT = 220;
const MARGIN = { top: 12, bottom: 28, left: 42 };
const GRID = [0, 0.25, 0.5, 0.75, 1];
const MIN_LABEL_GAP = 16;

export function TrendChart({ waves, series }: { waves: string[]; series: TrendSeries[] }) {
  const [ref, measured] = useElementWidth<HTMLDivElement>();
  const [hoverWave, setHoverWave] = useState<string | null>(null);

  const width = measured || 320;
  const wide = width >= 440;
  const right = wide ? 132 : 16;
  const plotWidth = width - MARGIN.left - right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const step = waves.length > 1 ? plotWidth / (waves.length - 1 + 0.6) : plotWidth;

  const x = (wave: string) =>
    waves.length > 1
      ? MARGIN.left + step * 0.3 + waves.indexOf(wave) * step
      : MARGIN.left + plotWidth / 2;
  const y = (value: number) => MARGIN.top + (1 - value) * plotHeight;

  // 끝점 라벨이 겹치지 않도록 아래쪽 라벨을 밀어냅니다.
  const endLabels = series
    .flatMap((s) => {
      const last = s.points.at(-1);
      return last ? [{ series: s, last, labelY: y(last.value) + 4 }] : [];
    })
    .sort((a, b) => a.labelY - b.labelY);
  endLabels.forEach((label, index) => {
    const previous = endLabels[index - 1];
    if (previous && label.labelY - previous.labelY < MIN_LABEL_GAP) {
      label.labelY = previous.labelY + MIN_LABEL_GAP;
    }
  });

  const hovered = hoverWave
    ? series.flatMap((s) => {
        const point = s.points.find((p) => p.wave === hoverWave);
        return point ? [{ name: s.name, point }] : [];
      })
    : [];

  const summary = series
    .map((s) => `${s.name}: ${s.points.map((p) => `${p.wave} ${pct(p.value)}`).join(', ')}`)
    .join('. ');

  return (
    <div className="trend">
      {series.length > 1 && (
        <ul className="legend">
          {series.map((s) => (
            <li key={s.name}>
              <span className={`legend-mark legend-mark--${s.tone}`} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div className="trend-plot" ref={ref}>
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`회차별 언급률. ${summary}`}
        >
          {GRID.map((value) => (
            <g key={value}>
              <line
                className="trend-grid"
                x1={MARGIN.left}
                x2={width - right}
                y1={y(value)}
                y2={y(value)}
              />
              <text className="trend-axis" x={MARGIN.left - 8} y={y(value) + 4} textAnchor="end">
                {value * 100}%
              </text>
            </g>
          ))}

          {waves.map((wave) => (
            <text key={wave} className="trend-axis" x={x(wave)} y={HEIGHT - 8} textAnchor="middle">
              {wave}
            </text>
          ))}

          {hoverWave && (
            <line
              className="trend-crosshair"
              x1={x(hoverWave)}
              x2={x(hoverWave)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
            />
          )}

          {series.map((s) => (
            <g key={s.name} className={`trend-series trend-series--${s.tone}`}>
              {s.points.length > 1 && (
                <polyline
                  points={s.points.map((p) => `${x(p.wave)},${y(p.value)}`).join(' ')}
                />
              )}
              {s.points.map((p) => (
                <circle key={p.wave} cx={x(p.wave)} cy={y(p.value)} r={p.wave === hoverWave ? 5.5 : 4} />
              ))}
            </g>
          ))}

          {wide &&
            endLabels.map(({ series: s, last, labelY }) => (
              <text key={s.name} className="trend-label" x={x(last.wave) + 10} y={labelY}>
                {s.name} {pct(last.value)}
              </text>
            ))}

          {waves.map((wave, index) => {
            const left = index === 0 ? MARGIN.left : (x(waves[index - 1] ?? wave) + x(wave)) / 2;
            const next = waves[index + 1];
            const end = next ? (x(wave) + x(next)) / 2 : width - right;
            return (
              <rect
                key={wave}
                className="trend-hit"
                x={left}
                y={MARGIN.top}
                width={end - left}
                height={plotHeight}
                onMouseEnter={() => setHoverWave(wave)}
                onMouseLeave={() => setHoverWave(null)}
              />
            );
          })}
        </svg>

        {hoverWave && hovered.length > 0 && (
          <div
            className={`chart-tip${x(hoverWave) > width * 0.6 ? ' chart-tip--flip' : ''}`}
            style={{ left: x(hoverWave), top: MARGIN.top + 8 }}
            role="presentation"
          >
            <b>{hoverWave}</b>
            {hovered.map(({ name, point }) => (
              <div key={name}>
                {name} {pct(point.value)} ({point.k}/{point.n})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
