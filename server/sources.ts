import { citationDomain, classifySite } from '../src/lib/sources.js';
import type { SourceRow } from '../src/types.js';
import type { Citation } from './engines.js';

/** 저장된 응답 한 건의 출처 목록. */
export interface CitedAnswer {
  wave: string;
  qid: string;
  engine: string;
  rep: number;
  citations: Citation[];
}

const TOP_PAGES = 5;

/**
 * 답변별 출처를 (회차, 엔진, 사이트) 단위로 묶습니다.
 * 한 답변 안에서 같은 주소는 한 번만 셉니다(채점의 인용 수와 같은 기준).
 */
export function summarizeSources(answers: CitedAnswer[], ownDomains: string[]): SourceRow[] {
  const groups = new Map<
    string,
    { row: SourceRow; answerKeys: Set<string>; qids: Set<string>; pages: Map<string, { url: string; title: string | null; n: number }> }
  >();

  for (const answer of answers) {
    const unique = [...new Map((answer.citations ?? []).map((c) => [c.url, c])).values()];
    for (const citation of unique) {
      if (!citation?.url) continue;
      const domain = citationDomain(citation.url, citation.title ?? null);
      const key = `${answer.wave}\u0000${answer.engine}\u0000${domain}`;
      let group = groups.get(key);
      if (!group) {
        const info = classifySite(domain, ownDomains);
        group = {
          row: { wave: answer.wave, engine: answer.engine, domain, owner: info.owner, kind: info.kind, cites: 0, answers: 0, qids: [], pages: [] },
          answerKeys: new Set(),
          qids: new Set(),
          pages: new Map(),
        };
        groups.set(key, group);
      }
      group.row.cites += 1;
      group.answerKeys.add(`${answer.qid}\u0000${answer.rep}`);
      group.qids.add(answer.qid);
      const page = group.pages.get(citation.url);
      if (page) page.n += 1;
      else group.pages.set(citation.url, { url: citation.url, title: citation.title ?? null, n: 1 });
    }
  }

  return [...groups.values()]
    .map(({ row, answerKeys, qids, pages }) => ({
      ...row,
      answers: answerKeys.size,
      qids: [...qids].sort(),
      pages: [...pages.values()].sort((a, b) => b.n - a.n).slice(0, TOP_PAGES),
    }))
    .sort((a, b) => b.cites - a.cites);
}
