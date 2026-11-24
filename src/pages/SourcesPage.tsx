import { Fragment, useMemo, useState } from 'react';
import { Badge } from '../components/Badges';
import { BarList } from '../components/BarList';
import type { BarRow } from '../components/BarList';
import { num, pct } from '../lib/format';
import { ENGINES, ENGINE_NAMES, OWN_BRAND, waveOrder } from '../lib/selectors';
import { BANK_TIERS, KIND_NAMES, KIND_ORDER } from '../lib/sources';
import type { BankTier, SourceKind } from '../lib/sources';
import type { DashboardData, SourceRow } from '../types';

/** 금융사 단위로 묶어 볼 유형. */
const FINANCIAL: SourceKind[] = ['own', 'bank', 'savings', 'finance'];

interface Site {
  domain: string;
  owner: string;
  kind: SourceKind;
  tier?: BankTier;
  cites: number;
  answers: number;
  byEngine: Record<string, number>;
  qids: string[];
  pages: SourceRow['pages'];
}

/** 엔진별 행을 사이트 하나로 합칩니다. */
function toSites(rows: SourceRow[]): Site[] {
  const sites = new Map<string, Site>();
  for (const row of rows) {
    const site = sites.get(row.domain) ?? {
      domain: row.domain,
      owner: row.owner,
      kind: row.kind,
      tier: row.tier,
      cites: 0,
      answers: 0,
      byEngine: {},
      qids: [],
      pages: [],
    };
    site.cites += row.cites;
    site.answers += row.answers;
    site.byEngine[row.engine] = (site.byEngine[row.engine] ?? 0) + row.cites;
    site.qids = [...new Set([...site.qids, ...row.qids])].sort();
    for (const page of row.pages) {
      const same = site.pages.find((p) => p.url === page.url);
      if (same) same.n += page.n;
      else site.pages.push({ ...page });
    }
    sites.set(row.domain, site);
  }
  return [...sites.values()]
    .map((site) => ({ ...site, pages: [...site.pages].sort((a, b) => b.n - a.n).slice(0, 5) }))
    .sort((a, b) => b.cites - a.cites || a.owner.localeCompare(b.owner, 'ko'));
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

function KindChart({ sites, total }: { sites: Site[]; total: number }) {
  const rows: BarRow[] = KIND_ORDER.flatMap((kind) => {
    const mine = sites.filter((s) => s.kind === kind);
    const cites = sum(mine.map((s) => s.cites));
    if (cites === 0) return [];
    return [
      {
        key: kind,
        label: KIND_NAMES[kind],
        value: cites,
        display: num(cites),
        muted: kind === 'other',
        tip: `${KIND_NAMES[kind]}, 사이트 ${mine.length}곳, 인용 ${num(cites)}건, 전체의 ${pct(cites / total)}`,
      },
    ];
  });
  return <BarList rows={rows} max={Math.max(...rows.map((r) => r.value)) * 1.05} />;
}

/** 은행 공식 사이트를 시중은행, 지방은행, 인터넷전문은행 등으로 나눈 인용 수. */
function TierChart({ sites }: { sites: Site[] }) {
  const banks = sites.filter((s) => s.kind === 'bank');
  const total = sum(banks.map((s) => s.cites));
  if (total === 0) return <p className="note">이 회차에는 은행 공식 사이트 인용이 없습니다.</p>;
  const rows: BarRow[] = BANK_TIERS.flatMap((tier) => {
    const mine = banks.filter((s) => s.tier === tier);
    const cites = sum(mine.map((s) => s.cites));
    if (cites === 0) return [];
    const names = [...new Set(mine.map((s) => s.owner))].join(', ');
    return [
      {
        key: tier,
        label: tier,
        value: cites,
        display: num(cites),
        muted: tier === '기타 은행',
        tip: `${tier}, 인용 ${num(cites)}건, 은행 공식 인용의 ${pct(cites / total)}. ${names}`,
      },
    ];
  });
  return <BarList rows={rows} max={Math.max(...rows.map((r) => r.value)) * 1.05} />;
}

function OwnerChart({ sites }: { sites: Site[] }) {
  const byOwner = new Map<string, number>([[OWN_BRAND, 0]]);
  for (const site of sites) {
    if (!FINANCIAL.includes(site.kind)) continue;
    byOwner.set(site.owner, (byOwner.get(site.owner) ?? 0) + site.cites);
  }
  const rows: BarRow[] = [...byOwner]
    .sort((a, b) => b[1] - a[1])
    .map(([owner, cites]) => ({
      key: owner,
      label: owner,
      value: cites,
      display: num(cites),
      muted: owner !== OWN_BRAND,
      tip: `${owner}, 인용 ${num(cites)}건`,
    }));
  return <BarList rows={rows} max={Math.max(1, ...rows.map((r) => r.value)) * 1.05} />;
}

function SiteDetail({ site, columns }: { site: Site; columns: number }) {
  return (
    <tr className="source-detail">
      <td colSpan={columns}>
        <p className="source-detail-meta">인용한 질문: {site.qids.join(', ')}</p>
        <ul className="source-pages">
          {site.pages.map((page) => (
            <li key={page.url}>
              <a href={page.url} target="_blank" rel="noreferrer noopener">
                {page.title && page.title !== site.domain ? page.title : page.url}
              </a>
              <span className="count">{num(page.n)}회</span>
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

interface SourcesPageProps {
  data: DashboardData;
  wave: string | null;
  onWaveChange: (wave: string) => void;
}

export function SourcesPage({ data, wave, onWaveChange }: SourcesPageProps) {
  const waves = useMemo(() => waveOrder(data), [data]);
  const current = wave && waves.includes(wave) ? wave : (waves.at(-1) ?? null);
  // 유형 필터. 은행 세부 분류는 'bank:시중은행' 형태로 담습니다.
  const [kind, setKind] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const sites = useMemo(
    () => toSites(data.sources.filter((row) => row.wave === current)),
    [data.sources, current],
  );
  const answers = data.answers.filter((a) => a.wave === current);
  const cited = answers.filter((a) => a.cites > 0).length;
  const total = sum(sites.map((s) => s.cites));
  // 자사 사이트는 따로 세므로 은행 공식에는 넣지 않습니다. 아래 차트의 '은행 공식' 막대와 같은 숫자입니다.
  const bankCites = sum(sites.filter((s) => s.kind === 'bank').map((s) => s.cites));
  const ownCites = sum(sites.filter((s) => s.kind === 'own').map((s) => s.cites));
  const kinds = KIND_ORDER.filter((k) => sites.some((s) => s.kind === k));
  const tiers = BANK_TIERS.filter((t) => sites.some((s) => s.kind === 'bank' && s.tier === t));
  const shown = !kind
    ? sites
    : kind.startsWith('bank:')
      ? sites.filter((s) => s.kind === 'bank' && s.tier === kind.slice(5))
      : sites.filter((s) => s.kind === kind);
  const columns = 5 + ENGINES.length;

  if (data.sources.length === 0) {
    return (
      <div className="page">
        <section className="block">
          <h2 className="page-title">인용 출처</h2>
          <p className="note">
            아직 정리할 출처가 없습니다. 출처는 데이터베이스에 저장된 실측 회차에서만 집계됩니다. 실행 탭에서
            회차를 저장하면 이 화면에 나타납니다.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="block">
        <h2 className="page-title">AI가 답변에 인용한 사이트</h2>
        <p className="note">
          AI가 답하면서 참고한 인터넷 주소를 사이트별로 모으고, 어느 은행이나 언론사의 사이트인지 나눴습니다.
          한 답변 안에서 같은 주소는 한 번만 셉니다.
        </p>

        <div className="filters">
          <select aria-label="회차" value={current ?? ''} onChange={(event) => onWaveChange(event.target.value)}>
            {waves.map((id) => (
              <option key={id} value={id}>
                {id} 회차
              </option>
            ))}
          </select>
          <span className="count" role="status">
            답변 {num(answers.length)}건 중 {num(cited)}건에 출처가 붙었습니다. 사이트 {num(sites.length)}곳, 인용{' '}
            {num(total)}건이고 그중 은행 공식 사이트가 {num(bankCites)}건({pct(total > 0 ? bankCites / total : null)}),
            DJ Bank 자사 사이트가 {num(ownCites)}건입니다.
          </span>
        </div>
      </section>

      {total > 0 && (
        <div className="columns">
          <section className="block">
            <h2>출처 유형별</h2>
            <p className="note">어떤 종류의 사이트가 출처로 많이 쓰였는지입니다. 막대에 마우스를 올리면 비율이 나옵니다.</p>
            <KindChart sites={sites} total={total} />
            <h2 className="block-subhead">은행 종류별</h2>
            <p className="note">은행 공식 사이트 인용을 시중은행, 지방은행, 인터넷전문은행 등으로 나눴습니다.</p>
            <TierChart sites={sites} />
          </section>
          <section className="block">
            <h2>금융사별</h2>
            <p className="note">
              은행, 저축은행, 증권사 같은 금융회사 사이트가 출처로 쓰인 횟수입니다.
            </p>
            <OwnerChart sites={sites} />
          </section>
        </div>
      )}

      <section className="block">
        <h2>사이트별 정리</h2>
        <p className="note">
          행을 누르면 출처로 쓰인 페이지와 질문이 펼쳐집니다. AI 서비스마다 출처를 알려 주는 방식이 달라서
          (Perplexity는 검색한 결과 전부, ChatGPT는 답변에 표시한 것만) 서비스끼리 숫자를 그대로 비교하면 안
          됩니다.
        </p>

        <div className="filters">
          <select aria-label="출처 유형" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">모든 유형</option>
            {kinds.flatMap((k) => [
              <option key={k} value={k}>
                {KIND_NAMES[k]}
              </option>,
              ...(k === 'bank'
                ? tiers.map((t) => (
                    <option key={t} value={`bank:${t}`}>
                      {`은행 공식 · ${t}`}
                    </option>
                  ))
                : []),
            ])}
          </select>
          <span className="count" role="status">
            사이트 {num(shown.length)}곳, 인용 {num(sum(shown.map((s) => s.cites)))}건
          </span>
        </div>

        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>사이트</th>
                <th>도메인</th>
                <th>유형</th>
                {ENGINES.map((engine) => (
                  <th key={engine} className="num">
                    {ENGINE_NAMES[engine]}
                  </th>
                ))}
                <th className="num">인용</th>
                <th className="num">답변</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((site) => {
                const expanded = open === site.domain;
                return (
                  <Fragment key={site.domain}>
                    <tr className="row-link" onClick={() => setOpen(expanded ? null : site.domain)}>
                      <td>
                        <button type="button" className="link-button" aria-expanded={expanded}>
                          {site.owner}
                        </button>
                      </td>
                      <td className="nowrap">{site.domain || '—'}</td>
                      <td>
                        <Badge variant={site.kind === 'own' ? 'accent' : undefined}>
                          {site.tier ? `${KIND_NAMES[site.kind]} · ${site.tier}` : KIND_NAMES[site.kind]}
                        </Badge>
                      </td>
                      {ENGINES.map((engine) => (
                        <td key={engine} className={`num${site.byEngine[engine] ? '' : ' cell--none'}`}>
                          {site.byEngine[engine] ? num(site.byEngine[engine]) : '–'}
                        </td>
                      ))}
                      <td className="num">{num(site.cites)}</td>
                      <td className="num">{num(site.answers)}</td>
                    </tr>
                    {expanded && <SiteDetail site={site} columns={columns} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
