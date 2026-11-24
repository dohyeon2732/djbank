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
  // 실측이 아닌 데이터(모의, 연습 실행)는 붉은 도장으로 구분합니다.
  const isReal = run.mode === '실측';
  return (
    <div className={`seal${isReal ? ' seal--live' : ''}`}>
      {!isReal ? (
        <>
          {run.mode.includes('연습') ? '연습' : '모의'}
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
            ? `AI에게 질문 ${latestRun(data)?.questions ?? data.questions.length}개를 물어 받은 답변 ${num(mention.n)}건 중 ${num(mention.k)}건에 DJ Bank가 나왔습니다.`
            : '아직 측정한 회차가 없습니다.'}
        </h2>
        <Seal run={latestRun(data)} />
      </div>
      <p className="hero-sub">
        {share && `AI가 은행 이름을 말한 횟수 가운데 DJ Bank는 ${pct(share.value)}입니다. `}
        회차마다 숫자가 달라지는 데에는 AI 서비스 업데이트 같은 바깥 이유도 섞여 있습니다. 아래 두 비율이
        함께 오르면 DJ Bank가 실제로 더 자주 나온 것으로 봅니다.
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
        <dt>DJ Bank가 나오는 순서</dt>
        <dd className="metric-value">{fixed2(total?.rank_avg)}</dd>
        <dd className="metric-sub">3점이면 은행 중 가장 먼저, 1점이면 세 번째 이후</dd>
      </div>
      <div>
        <dt>추천하는 정도</dt>
        <dd className="metric-value">{fixed2(total?.rec_avg)}</dd>
        <dd className="metric-sub">
          {total && total.rec_avg == null
            ? '실행 탭에서 AI 채점을 하면 표시됩니다'
            : 'DJ Bank가 나온 답변 기준. 0점에서 3점, 3점이 가장 강한 추천'}
        </dd>
      </div>
      <div>
        <dt>심각하게 틀린 답변</dt>
        <dd className={`metric-value${critical ? ' metric-value--alert' : ''}`}>
          {critical == null ? '—' : `${num(critical)}건`}
        </dd>
        <dd className="metric-sub">
          {total && critical == null
            ? total.rec_avg == null
              ? '실행 탭에서 AI 채점을 하면 표시됩니다'
              : '실행 탭에 상품 사실을 적고 채점하면 표시됩니다'
            : `${critical ? '확인 필요. ' : ''}적어 둔 상품 사실과 크게 다른 답변`}
        </dd>
      </div>
      <div>
        <dt>DJ Bank 페이지를 출처로 쓴 비율</dt>
        <dd className="metric-value">{pct(total?.own_share)}</dd>
        <dd className="metric-sub">
          {total && total.own_share == null && total.total_cit
            ? '실행 탭에 자사 사이트 주소를 넣으면 계산됩니다'
            : 'AI가 참고한 출처 중 DJ Bank 페이지'}
        </dd>
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
  if (rows.length === 0) return <p className="note">이 회차의 AI 서비스별 결과가 없습니다.</p>;
  return <BarList rows={rows} max={maxWithHeadroom(rows.map((r) => r.hi ?? r.value))} />;
}

function BrandChart({ data }: { data: DashboardData }) {
  const brands = brandsOf(data, latestWave(data));
  if (brands.length === 0) return <p className="note">이 회차의 은행별 결과가 없습니다.</p>;
  const rows: BarRow[] = brands.map((row) => ({
    key: row.brand,
    label: row.brand,
    value: row.count,
    display: num(row.count),
    muted: row.brand !== 'DJ Bank',
    tip: `${row.brand}, 언급 ${num(row.count)}건`,
  }));
  return <BarList rows={rows} max={Math.max(...rows.map((r) => r.value)) * 1.05} />;
}

const PIPELINE_STEPS = (run: Run | null) => [
  { title: '질문 준비', detail: `정해 둔 질문 ${run?.questions ?? '—'}개` },
  { title: 'AI에게 질문', detail: `AI 서비스 ${run?.engines ?? '—'}곳에 모두 ${num(run?.planned)}번` },
  { title: '답변 저장', detail: '답변 전체와 AI가 참고한 출처 주소' },
  { title: '답변 확인', detail: 'DJ Bank와 다른 은행 이름, 출처를 규칙으로 찾기' },
  { title: '숫자로 정리', detail: '비율과 오차 범위 계산' },
  { title: '화면에 표시', detail: '이 대시보드에 반영' },
];

export function OverviewPage({ data }: { data: DashboardData }) {
  const wave = latestWave(data);
  const waves = waveOrder(data);
  const demand = segmentsOf(data, '수요', wave);
  const products = [...segmentsOf(data, '상품', wave)].sort(
    (a, b) => (b.mention_p ?? 0) - (a.mention_p ?? 0),
  );
  const trend: TrendSeries[] = [
    { name: '전체 답변 중 DJ Bank 비율', tone: 'primary' as const, points: mentionSeries(data) },
    { name: '은행 이름 중 DJ Bank 비율', tone: 'secondary' as const, points: shareSeries(data) },
  ].filter((s) => s.points.length > 0);

  return (
    <div className="page">
      <Hero data={data} />
      <Metrics data={data} />

      <div className="columns">
        <section className="block">
          <h2>AI 서비스별 DJ Bank 언급 비율</h2>
          <p className="note">네 AI 서비스 모두 인터넷 검색을 켠 상태로 물었습니다. 막대 아래 가는 선은 오차 범위입니다.</p>
          <EngineChart data={data} />
        </section>
        <section className="block">
          <h2>AI가 함께 말한 은행</h2>
          <p className="note">같은 질문들에서 각 은행 이름이 나온 답변 수입니다.</p>
          <BrandChart data={data} />
        </section>
      </div>

      <div className="columns columns--wide-left">
        <section className="block">
          <h2>회차별 변화</h2>
          <p className="note">
            두 선이 함께 오르면 DJ Bank가 더 자주 나온 것입니다. 파란 선만 오르면 AI가 은행 이름을 전반적으로 더
            많이 말한 것입니다.
            {waves.length < 2 && ' 회차가 두 개 이상 쌓이면 선으로 이어집니다.'}
          </p>
          {trend.length > 0 ? (
            <TrendChart waves={waves} series={trend} />
          ) : (
            <p className="note">회차를 측정하면 변화가 표시됩니다.</p>
          )}
        </section>
        <section className="block">
          <h2>질문 유형별</h2>
          <p className="note">돈을 모으는 질문과 빌리는 질문으로 나눈 결과입니다. 유형 {demand.length}개.</p>
          <div className="table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th>질문 유형</th>
                  <th className="num">DJ Bank 비율</th>
                  <th className="num">나온 답변</th>
                  <th className="num">전체</th>
                  <th className="num">은행 중 비율</th>
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
          상품 {products.length}종을 DJ Bank가 많이 나온 순서로 정렬했습니다.
        </p>
        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>상품</th>
                <th className="num">DJ Bank 비율</th>
                <th className="num">DJ Bank 답변</th>
                <th className="num">전체 답변</th>
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
        <h2>AI 답변 분석 진행 과정</h2>
        <p className="note">회차마다 이 여섯 단계가 차례로 진행됩니다. 숫자는 가장 최근 회차 기준입니다.</p>
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
                <th className="num">보낸 질문</th>
                <th className="num">받은 답변</th>
                <th className="num">실패</th>
                <th>구분</th>
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
