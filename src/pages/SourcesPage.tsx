import { Fragment, useMemo, useState } from 'react';
import { Badge } from '../components/Badges';
import { BarList } from '../components/BarList';
import type { BarRow } from '../components/BarList';
import { num, pct } from '../lib/format';
import { ENGINES, ENGINE_NAMES, OWN_BRAND, waveOrder } from '../lib/selectors';
import { KIND_NAMES, KIND_ORDER } from '../lib/sources';
import type { SourceKind } from '../lib/sources';
import type { DashboardData, SourceRow } from '../types';

/** 금융사 단위로 묶어 볼 유형. */
const FINANCIAL: SourceKind[] = ['own', 'bank', 'savings', 'finance'];

interface Site {
  domain: string;
  owner: string;
  kind: SourceKind;
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
  const [kind, setKind] = useState<SourceKind | ''>('');
  const [open, setOpen] = useState<string | null>(null);

  const sites = useMemo(
    () => toSites(data.sources.filter((row) => row.wave === current)),
    [data.sources, current],
  );
  const answers = data.answers.filter((a) => a.wave === current);
  const cited = answers.filter((a) => a.cites > 0).length;
  const total = sum(sites.map((s) => s.cites));
  const bankCites = sum(sites.filter((s) => s.kind === 'bank' || s.kind === 'own').map((s) => s.cites));
  const ownCites = sum(sites.filter((s) => s.kind === 'own').map((s) => s.cites));
  const kinds = KIND_ORDER.filter((k) => sites.some((s) => s.kind === k));
  const shown = kind ? sites.filter((s) => s.kind === kind) : sites;
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
          엔진이 웹검색으로 참고한 출처 주소를 사이트 단위로 묶고, 어느 은행이나 매체의 사이트인지 규칙으로
          분류했습니다. 한 답변 안의 같은 주소는 한 번만 셉니다.
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
            <p className="note">유형별 인용 수입니다. 막대에 올리면 전체에서 차지하는 비율이 나옵니다.</p>
            <KindChart sites={sites} total={total} />
          </section>
          <section className="block">
            <h2>금융사별</h2>
            <p className="note">
              은행, 저축은행, 증권사 등 금융사 사이트의 인용 수입니다. DJ Bank는 실행 탭에 자사 도메인을 넣어야
              집계됩니다.
            </p>
            <OwnerChart sites={sites} />
          </section>
        </div>
      )}

      <section className="block">
        <h2>사이트별 정리</h2>
        <p className="note">
          행을 누르면 인용된 페이지와 질문이 펼쳐집니다. ChatGPT와 Claude는 답변에 인용 표시를 붙인 출처만,
          Perplexity는 검색해 온 결과 전체를, Gemini는 검색 근거 목록을 돌려주므로 엔진 사이 숫자를 그대로
          비교하면 안 됩니다.
        </p>

        <div className="filters">
          <select aria-label="출처 유형" value={kind} onChange={(event) => setKind(event.target.value as SourceKind | '')}>
            <option value="">모든 유형</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_NAMES[k]}
              </option>
            ))}
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
                        <Badge variant={site.kind === 'own' ? 'accent' : undefined}>{KIND_NAMES[site.kind]}</Badge>
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
