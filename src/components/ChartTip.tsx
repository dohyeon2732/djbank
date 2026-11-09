import type { useChartTip } from '../lib/hooks';

export function ChartTip({ tip }: { tip: ReturnType<typeof useChartTip>['tip'] }) {
  if (!tip) return null;
  return (
    <div
      className={`chart-tip${tip.flip ? ' chart-tip--flip' : ''}`}
      style={{ left: tip.x, top: tip.y }}
      role="presentation"
    >
      {tip.content}
    </div>
  );
}
