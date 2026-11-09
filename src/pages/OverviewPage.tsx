import { BarList } from '../components/BarList';
import type { BarRow } from '../components/BarList';
import { GroupBadge } from '../components/Badges';
import { GapRuler } from '../components/GapRuler';
import { TrendChart } from '../components/TrendChart';
import type { TrendSeries } from '../components/TrendChart';
import { fixed2, num, pct } from '../lib/format';
import {
  ENGINE_NAMES,
  GROUP,
  brandsOf,
  findSegment,
  groupAtLatest,
  groupSeries,
  latestRun,
  latestWave,
  segmentsOf,
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

function Hero({ data }: { data: DashboardData }) {
  const content = groupAtLatest(data, GROUP.content);
  const control = groupAtLatest(data, GROUP.control);
  const unreleased = groupAtLatest(data, GROUP.unreleased);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-head">
        <h2 id="hero-title" className="hero-title">
          {content
            ? `콘텐츠를 발행한 질문의 AI 답변 ${num(content.n)}건 중 ${num(content.k)}건이 DJ Bank를 언급했습니다.`
            : '아직 측정된 회차가 없습니다.'}
        </h2>
        <Seal run={latestRun(data)} />
      </div>
      <p className="hero-sub">
        {control
          ? `발행하지 않은 통제 상품은 ${num(control.n)}건 중 ${num(control.k)}건입니다. 이 격차가 회차를 거치며 벌어지면 콘텐츠가 효과를 낸 것입니다.`
          : '통제 상품이 아직 측정되지 않아 콘텐츠의 효과는 판정할 수 없습니다.'}
      </p>
      <GapRuler content={content} control={control} unreleased={unreleased} />
    </section>
  );
}

function Metrics({ data }: { data: DashboardData }) {
  const wave = latestWave(data);
  const content = groupAtLatest(data, GROUP.content);
  const total = findSegment(data, '전체', '전체', wave);
  const brandCount = brandsOf(data, wave).length;
  const critical = total?.critical;

  return (
    <dl className="metrics" aria-label="핵심 지표">
      <div>
        <dt>콘텐츠 대상 언급률</dt>
        <dd className="metric-value">{pct(content?.mention_p)}</dd>
        <dd className="metric-sub">
          {content ? `${content.k}/${content.n}건, 95% 구간 ${pct(content.lo)}–${pct(content.hi)}` : '측정 전'}
        </dd>
      </div>
      <div>
        <dt>{brandCount}개사 언급 중 점유율</dt>
        <dd className="metric-value">{pct(total?.sov)}</dd>
        <dd className="metric-sub">브랜드 언급 횟수 기준</dd>
      </div>
      <div>
        <dt>언급 순위 평균</dt>
        <dd className="metric-value">{fixed2(total?.rank_avg)}</dd>
        <dd className="metric-sub">0에서 3, 3이 첫 번째 언급</dd>
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
  { title: '집계', detail: '지표 7종, 신뢰구간, 이중차분' },
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
    { name: GROUP.content, tone: 'content' as const, points: groupSeries(data, GROUP.content) },
    { name: GROUP.control, tone: 'control' as const, points: groupSeries(data, GROUP.control) },
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
            기준 회차 이후 두 선의 간격이 벌어지는 만큼이 순효과입니다.
            {waves.length < 2 && ' 회차가 두 개 이상 쌓이면 선으로 이어집니다.'}
          </p>
          {trend.length > 0 ? (
            <TrendChart waves={waves} series={trend} />
          ) : (
            <p className="note">그룹별 측정값이 들어오면 추이가 표시됩니다.</p>
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
          상품 {products.length}종을 언급률 순으로 정렬했습니다. 그룹이 콘텐츠 대상인 상품만 발행 효과
          판정에 들어갑니다.
        </p>
        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>상품</th>
                <th>그룹</th>
                <th className="num">언급률</th>
                <th className="num">언급</th>
                <th className="num">표본</th>
              </tr>
            </thead>
            <tbody>
              {products.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.group ? <GroupBadge group={row.group} /> : '—'}</td>
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
