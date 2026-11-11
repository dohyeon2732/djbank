import { BarList } from '../components/BarList';
import type { BarRow } from '../components/BarList';
import { HeroRuler } from '../components/HeroRuler';
import { TrendChart } from '../components/TrendChart';
import type { TrendSeries } from '../components/TrendChart';
import { fixed2, num, pct } from '../lib/format';
import {
  ENGINE_NAMES,
  brandsOf,
  findSegment,
  latestRun,
  latestWave,
  mentionSeries,
  segmentsOf,
  shareSeries,
  waveOrder,
} from '../lib/selectors';
import type { DashboardData, Run } from '../types';

function Seal({ run }: { run: Run | null }) {
  if (!run) return null;
  const isMock = run.mode.includes('모의');
  return (
    <div className={`seal${isMock ? '' : ' seal--live'}`}>
      {isMock ? (
        <>
          모의
          <br />
          데이터
        </>
      ) : (
        <>
          실측
          <br />
          {run.wave}
        </>
      )}
    </div>
  );
}

/** 최신 회차와 다른 첫 회차를 기준점으로 씁니다. */
function baseOf<T extends { wave: string }>(series: T[]): T | null {
  const first = series[0];
  return first && series.length > 1 ? first : null;
}

function Hero({ data }: { data: DashboardData }) {
  const mentions = mentionSeries(data);
  const shares = shareSeries(data);
  const wave = latestWave(data);
  const mention = mentions.find((p) => p.wave === wave) ?? null;
  const share = shares.find((p) => p.wave === wave) ?? null;

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-head">
        <h2 id="hero-title" className="hero-title">
          {mention
            ? `측정 질문 ${data.questions.length}개에 대한 AI 답변 ${num(mention.n)}건 중 ${num(mention.k)}건이 DJ Bank를 언급했습니다.`
            : '아직 측정된 회차가 없습니다.'}
        </h2>
        <Seal run={latestRun(data)} />
      </div>
      <p className="hero-sub">
        {share && `은행 이름이 나온 답변에서 DJ Bank의 몫은 ${pct(share.value)}입니다. `}
        비교군을 따로 두지 않아 회차 사이 변화에는 엔진 업데이트나 시장 흐름도 섞여 있습니다. 점유율이
        함께 오르는지로 DJ Bank만의 변화인지 가늠합니다.
      </p>
      <HeroRuler
        mention={mention}
        mentionBase={mention ? baseOf(mentions) : null}
        share={share}
        shareBase={share ? baseOf(shares) : null}
      />
    </section>
  );
}

function Metrics({ data }: { data: DashboardData }) {
  const total = findSegment(data, '전체', '전체', latestWave(data));
  const critical = total?.critical;

  return (
    <dl className="metrics" aria-label="핵심 지표">
      <div>
        <dt>언급 순위 평균</dt>
        <dd className="metric-value">{fixed2(total?.rank_avg)}</dd>
        <dd className="metric-sub">0에서 3, 3이 첫 번째 언급</dd>
      </div>
      <div>
        <dt>추천 강도 평균</dt>
        <dd className="metric-value">{fixed2(total?.rec_avg)}</dd>
        <dd className="metric-sub">0에서 3, 3이 가장 강한 추천</dd>
      </div>
      <div>
        <dt>치명 환각</dt>
        <dd className={`metric-value${critical ? ' metric-value--alert' : ''}`}>
          {critical == null ? '—' : `${num(critical)}건`}
        </dd>
        <dd className="metric-sub">
          {critical ? '확인 필요. ' : ''}운영주체, 지위, 미존재 상품 오류
        </dd>
      </div>
      <div>
        <dt>자사 인용 점유율</dt>
        <dd className="metric-value">{pct(total?.own_share)}</dd>
        <dd className="metric-sub">응답이 인용한 출처 중 자사 도메인</dd>
      </div>
    </dl>
  );
}

function maxWithHeadroom(values: number[]): number {
  return Math.min(1, Math.max(...values, 0) * 1.15) || 1;
}

function EngineChart({ data }: { data: DashboardData }) {
  const rows: BarRow[] = segmentsOf(data, '엔진', latestWave(data)).map((row) => {
    const label = ENGINE_NAMES[row.name] ?? row.name;
    return {
      key: row.name,
      label,
      value: row.mention_p ?? 0,
      display: pct(row.mention_p),
      lo: row.lo,
      hi: row.hi,
      tip: `${label}, ${pct(row.mention_p)} (${row.k}/${row.n})`,
    };
  });
  if (rows.length === 0) return <p className="note">이 회차의 엔진별 집계가 없습니다.</p>;
  return <BarList rows={rows} max={maxWithHeadroom(rows.map((r) => r.hi ?? r.value))} />;
}

function BrandChart({ data }: { data: DashboardData }) {
  const brands = brandsOf(data, latestWave(data));
  if (brands.length === 0) return <p className="note">이 회차의 브랜드 집계가 없습니다.</p>;
  const rows: BarRow[] = brands.map((row) => ({
    key: row.brand,
    label: row.brand,
    value: row.count,
    display: num(row.count),
    muted: row.brand !== 'DJ Bank',
    tip: `${row.brand}, ${num(row.count)}회 언급`,
  }));
  return <BarList rows={rows} max={Math.max(...rows.map((r) => r.value)) * 1.05} />;
}

const PIPELINE_STEPS = (run: Run | null) => [
  { title: '질문셋', detail: `${run?.questions ?? '—'}문항, 문구와 ID 고정` },
  { title: '질의 러너', detail: `엔진 ${run?.engines ?? '—'}종, 질의 ${num(run?.planned)}건` },
  { title: '원본 보관', detail: '응답 전문과 인용 주소, 모델 버전' },
  { title: '채점', detail: `${run?.judge_version ?? '—'}, 20%는 사람이 재채점` },
  { title: '집계', detail: '지표 7종, 신뢰구간' },
  { title: '산출', detail: '이 페이지와 엑셀 리포트 갱신' },
];

export function OverviewPage({ data }: { data: DashboardData }) {
  const wave = latestWave(data);
  const waves = waveOrder(data);
  const demand = segmentsOf(data, '수요', wave);
  const products = [...segmentsOf(data, '상품', wave)].sort(
    (a, b) => (b.mention_p ?? 0) - (a.mention_p ?? 0),
  );
  const trend: TrendSeries[] = [
    { name: 'DJ Bank 언급률', tone: 'primary' as const, points: mentionSeries(data) },
    { name: 'DJ Bank 점유율', tone: 'secondary' as const, points: shareSeries(data) },
  ].filter((s) => s.points.length > 0);

  return (
    <div className="page">
      <Hero data={data} />
      <Metrics data={data} />

      <div className="columns">
        <section className="block">
          <h2>엔진별 언급률</h2>
          <p className="note">네 엔진 모두 웹검색을 켠 상태로 묻습니다. 막대 아래 선은 95% 신뢰구간입니다.</p>
          <EngineChart data={data} />
        </section>
        <section className="block">
          <h2>경쟁 지도</h2>
          <p className="note">같은 질문에서 AI가 함께 꺼낸 브랜드의 언급 총량입니다. 점유율의 분모가 됩니다.</p>
          <BrandChart data={data} />
        </section>
      </div>

      <div className="columns columns--wide-left">
        <section className="block">
          <h2>회차 추이</h2>
          <p className="note">
            두 선이 함께 오르면 DJ Bank 쪽의 변화이고, 언급률만 오르고 점유율이 그대로면 은행 언급이 전반적으로
            늘어난 것입니다.
            {waves.length < 2 && ' 회차가 두 개 이상 쌓이면 선으로 이어집니다.'}
          </p>
          {trend.length > 0 ? (
            <TrendChart waves={waves} series={trend} />
          ) : (
            <p className="note">회차가 측정되면 추이가 표시됩니다.</p>
          )}
        </section>
        <section className="block">
          <h2>수요 순간별</h2>
          <p className="note">측정 중인 수요 순간 {demand.length}개입니다.</p>
          <div className="table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th>수요</th>
                  <th className="num">언급률</th>
                  <th className="num">언급</th>
                  <th className="num">표본</th>
                  <th className="num">점유율</th>
                </tr>
              </thead>
              <tbody>
                {demand.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td className="num">{pct(row.mention_p)}</td>
                    <td className="num">{num(row.k)}</td>
                    <td className="num">{num(row.n)}</td>
                    <td className="num">{pct(row.sov)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="block">
        <h2>상품별</h2>
        <p className="note">
          상품 {products.length}종을 언급률 순으로 정렬했습니다.
        </p>
        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>상품</th>
                <th className="num">언급률</th>
                <th className="num">언급</th>
                <th className="num">표본</th>
              </tr>
            </thead>
            <tbody>
              {products.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className="num">{pct(row.mention_p)}</td>
                  <td className="num">{num(row.k)}</td>
                  <td className="num">{num(row.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <h2>측정 파이프라인</h2>
        <p className="note">회차마다 이 여섯 단계가 자동으로 이어집니다. 숫자는 최근 회차의 실행 기록입니다.</p>
        <ol className="rail">
          {PIPELINE_STEPS(latestRun(data)).map((step, index) => (
            <li key={step.title}>
              <span className="rail-dot">{index + 1}</span>
              <b>{step.title}</b>
              <span className="rail-detail">{step.detail}</span>
            </li>
          ))}
        </ol>
        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>회차</th>
                <th>실행일</th>
                <th className="num">계획</th>
                <th className="num">성공</th>
                <th className="num">실패</th>
                <th>모드</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.wave}>
                  <td>{run.wave}</td>
                  <td>{run.date}</td>
                  <td className="num">{num(run.planned)}</td>
                  <td className="num">{num(run.succeeded)}</td>
                  <td className="num">{num(run.failed)}</td>
                  <td>{run.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
