import { useEffect, useState } from 'react';
import { pct, pointGap } from '../lib/format';
import { useChartTip } from '../lib/hooks';
import { GROUP } from '../lib/selectors';
import type { GroupPoint } from '../lib/selectors';
import { ChartTip } from './ChartTip';

const TICKS = [0, 20, 40, 60, 80, 100];

// 눈금자는 페이지를 처음 열 때 한 번만 펼쳐집니다.
let hasPlayed = false;

interface GapRulerProps {
  content: GroupPoint | null;
  control: GroupPoint | null;
  unreleased: GroupPoint | null;
}

function RulerRow({
  name,
  point,
  tone,
  animate,
  onHover,
  onLeave,
}: {
  name: string;
  point: GroupPoint | null;
  tone: 'content' | 'control' | 'unreleased';
  animate: boolean;
  onHover: ReturnType<typeof useChartTip>['show'];
  onLeave: () => void;
}) {
  if (!point) {
    return (
      <div className="ruler-row">
        <div className="ruler-caption">
          <span className="ruler-name">{name}</span>
          <span className="ruler-detail">측정값 없음</span>
        </div>
        <div className="ruler-track ruler-track--empty">
          <span>이 그룹의 질문이 측정되면 막대가 이 줄에 그려집니다</span>
        </div>
      </div>
    );
  }

  const label = `${name}, ${pct(point.mention_p)} (${point.k}/${point.n})`;

  return (
    <div
      className="ruler-row"
      onMouseMove={(event) => onHover(event, label)}
      onMouseLeave={onLeave}
    >
      <div className="ruler-caption">
        <span className="ruler-name">{name}</span>
        <span className="ruler-value">{pct(point.mention_p)}</span>
        <span className="ruler-detail">
          95% 신뢰구간 {pct(point.lo)}에서 {pct(point.hi)}
        </span>
      </div>
      <div className="ruler-track">
        <div
          className={`ruler-bar ruler-bar--${tone}${animate ? ' ruler-bar--grow' : ''}`}
          style={{ width: `${point.mention_p * 100}%` }}
        />
      </div>
      <div className="ruler-interval" aria-hidden="true">
        <span
          style={{ left: `${point.lo * 100}%`, width: `${(point.hi - point.lo) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function GapRuler({ content, control, unreleased }: GapRulerProps) {
  const { tip, show, hide } = useChartTip();
  const [animate] = useState(() => !hasPlayed);

  useEffect(() => {
    hasPlayed = true;
  }, []);

  const gap = content && control ? pointGap(content.mention_p, control.mention_p) : null;
  const span =
    content && control
      ? {
          left: Math.min(content.mention_p, control.mention_p) * 100,
          width: Math.abs(content.mention_p - control.mention_p) * 100,
        }
      : null;

  return (
    <figure className="ruler" data-tip-root>
      <figcaption className="ruler-gap">
        <span className="ruler-gap-label">콘텐츠 대상과 통제 상품의 격차</span>
        <strong className="ruler-gap-value">{gap ?? '판정 대기'}</strong>
        <span className="ruler-gap-note">
          {gap
            ? '첫 회차 값이 기준점이고, 이후 이 수가 커지는 만큼이 콘텐츠의 순효과입니다.'
            : '통제 상품이 측정되면 두 막대 사이의 거리가 여기에 표시됩니다.'}
        </span>
      </figcaption>

      <div className="ruler-plot">
        <div className="ruler-scale" aria-hidden="true">
          {TICKS.map((tick) => (
            <span key={tick} style={{ left: `${tick}%` }}>
              {tick}%
            </span>
          ))}
        </div>
        <div className="ruler-rows">
          {span && (
            <div
              className="ruler-span"
              aria-hidden="true"
              style={{ left: `${span.left}%`, width: `${span.width}%` }}
            />
          )}
          <RulerRow
            name={GROUP.content}
            point={content}
            tone="content"
            animate={animate}
            onHover={show}
            onLeave={hide}
          />
          <RulerRow
            name={GROUP.control}
            point={control}
            tone="control"
            animate={animate}
            onHover={show}
            onLeave={hide}
          />
          {unreleased && (
            <RulerRow
              name={GROUP.unreleased}
              point={unreleased}
              tone="unreleased"
              animate={animate}
              onHover={show}
              onLeave={hide}
            />
          )}
        </div>
      </div>
      <ChartTip tip={tip} />
    </figure>
  );
}
