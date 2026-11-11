import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { num, pct, pointGap } from '../lib/format';
import { useChartTip } from '../lib/hooks';
import { OWN_BRAND } from '../lib/selectors';
import type { RatePoint, SharePoint } from '../lib/selectors';
import { ChartTip } from './ChartTip';

const TICKS = [0, 20, 40, 60, 80, 100];

// 눈금자는 페이지를 처음 열 때 한 번만 펼쳐집니다.
let hasPlayed = false;

type Tip = ReturnType<typeof useChartTip>;

function BaseTick({ base }: { base: RatePoint | null }) {
  if (!base) return null;
  return <span className="ruler-base" aria-hidden="true" style={{ left: `${base.value * 100}%` }} />;
}

function RulerRow({
  name,
  value,
  detail,
  tip,
  onHover,
  onLeave,
  children,
}: {
  name: string;
  value: string;
  detail: string;
  tip: string;
  onHover: Tip['show'];
  onLeave: () => void;
  children: ReactNode;
}) {
  return (
    <div className="ruler-row" onMouseMove={(event) => onHover(event, tip)} onMouseLeave={onLeave}>
      <div className="ruler-caption">
        <span className="ruler-name">{name}</span>
        <span className="ruler-value">{value}</span>
        <span className="ruler-detail">{detail}</span>
      </div>
      {children}
    </div>
  );
}

const baseNote = (base: RatePoint | null) => (base ? `, 기준 ${base.wave} ${pct(base.value)}` : '');

interface HeroRulerProps {
  mention: RatePoint | null;
  mentionBase: RatePoint | null;
  share: SharePoint | null;
  shareBase: SharePoint | null;
}

/** 기준 회차는 최신 회차와 다를 때만 넘깁니다. */
export function HeroRuler({ mention, mentionBase, share, shareBase }: HeroRulerProps) {
  const { tip, show, hide } = useChartTip();
  const [animate] = useState(() => !hasPlayed);
  const grow = animate ? ' ruler-bar--grow' : '';

  useEffect(() => {
    hasPlayed = true;
  }, []);

  // 경쟁 은행 막대는 DJ Bank 뒤에 언급 횟수 순으로 붙입니다.
  const segments = share
    ? [...share.brands].sort(
        (a, b) => Number(b.brand === OWN_BRAND) - Number(a.brand === OWN_BRAND) || b.count - a.count,
      )
    : [];
  const competitors = segments.length - (share && share.k > 0 ? 1 : 0);

  return (
    <figure className="ruler" data-tip-root>
      <figcaption className="ruler-gap">
        <span className="ruler-gap-label">기준 회차 대비 언급률</span>
        <strong className="ruler-gap-value">
          {!mention ? '측정 전' : mentionBase ? pointGap(mention.value, mentionBase.value) : '기준 회차'}
        </strong>
        <span className="ruler-gap-note">
          {!mention
            ? '첫 회차가 측정되면 그 값이 기준점이 됩니다.'
            : mentionBase
              ? `${mentionBase.wave} ${pct(mentionBase.value)}에서 ${mention.wave} ${pct(mention.value)}로 바뀌었습니다.${
                  share && shareBase ? ` 같은 기간 점유율은 ${pointGap(share.value, shareBase.value)}입니다.` : ''
                }`
              : `${mention.wave}가 첫 회차라 이 값이 기준점입니다. 다음 회차부터 이 자리에 변화량이 표시됩니다.`}
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
          {mention ? (
            <RulerRow
              name="DJ Bank 언급률"
              value={pct(mention.value)}
              detail={
                mention.lo != null && mention.hi != null
                  ? `95% 신뢰구간 ${pct(mention.lo)}에서 ${pct(mention.hi)}`
                  : `${num(mention.k)}/${num(mention.n)}건`
              }
              tip={`DJ Bank 언급률 ${pct(mention.value)} (${mention.k}/${mention.n})${baseNote(mentionBase)}`}
              onHover={show}
              onLeave={hide}
            >
              <div className="ruler-track">
                <div
                  className={`ruler-bar ruler-bar--own${grow}`}
                  style={{ width: `${mention.value * 100}%` }}
                />
                <BaseTick base={mentionBase} />
              </div>
              {mention.lo != null && mention.hi != null && (
                <div className="ruler-interval" aria-hidden="true">
                  <span
                    style={{
                      left: `${mention.lo * 100}%`,
                      width: `${(mention.hi - mention.lo) * 100}%`,
                    }}
                  />
                </div>
              )}
            </RulerRow>
          ) : (
            <div className="ruler-track ruler-track--empty">
              <span>첫 회차가 측정되면 DJ Bank 언급률이 이 줄에 그려집니다</span>
            </div>
          )}

          {share && (
            <RulerRow
              name="은행 언급 중 DJ Bank 몫"
              value={pct(share.value)}
              detail={`은행 ${segments.length}곳 언급 ${num(share.n)}건 중 ${num(share.k)}건, 경쟁 ${competitors}곳 ${pct(1 - share.value)}`}
              tip={`DJ Bank 점유율 ${pct(share.value)} (${num(share.k)}/${num(share.n)}건)${baseNote(shareBase)}`}
              onHover={show}
              onLeave={hide}
            >
              <div className="ruler-track">
                <div className={`ruler-stack${grow}`}>
                  {segments.map((brand) => (
                    <span
                      key={brand.brand}
                      className={brand.brand === OWN_BRAND ? 'ruler-seg ruler-seg--own' : 'ruler-seg'}
                      style={{ width: `${(brand.count / share.n) * 100}%` }}
                      onMouseMove={(event) => {
                        event.stopPropagation();
                        show(event, `${brand.brand} ${pct(brand.count / share.n)} (${num(brand.count)}건)`);
                      }}
                    />
                  ))}
                </div>
                <BaseTick base={shareBase} />
              </div>
            </RulerRow>
          )}
        </div>
        {mentionBase && <p className="ruler-legend">세로 눈금은 기준 회차 {mentionBase.wave}의 값입니다.</p>}
      </div>
      <ChartTip tip={tip} />
    </figure>
  );
}
