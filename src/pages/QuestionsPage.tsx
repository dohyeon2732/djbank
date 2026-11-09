import { useMemo } from 'react';
import { Badge, EnginePips, GroupBadge } from '../components/Badges';
import {
  CATEGORY_NAMES,
  answerWaves,
  enginesMentioning,
  filterOptions,
  filterQuestions,
} from '../lib/selectors';
import { EMPTY_FILTERS } from '../types';
import type { DashboardData, QuestionFilters } from '../types';

interface QuestionsPageProps {
  data: DashboardData;
  filters: QuestionFilters;
  onFiltersChange: (filters: QuestionFilters) => void;
  onOpen: (questionId: string) => void;
}

export function QuestionsPage({ data, filters, onFiltersChange, onOpen }: QuestionsPageProps) {
  const options = useMemo(() => filterOptions(data.questions), [data.questions]);
  const visible = useMemo(() => filterQuestions(data.questions, filters), [data.questions, filters]);
  const lastWave = answerWaves(data.answers).at(-1);
  const latestAnswers = useMemo(
    () => data.answers.filter((a) => a.wave === lastWave),
    [data.answers, lastWave],
  );

  const set = (patch: Partial<QuestionFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="page">
      <section className="block">
        <h2 className="page-title">질문셋</h2>
        <p className="note">
          측정에 쓰는 고정 질문 전체입니다. 질문을 누르면 회차별 응답과 추이를 볼 수 있습니다. 문구와
          ID는 측정 기간 동안 바뀌지 않습니다.
        </p>

        <div className="filters">
          <select aria-label="그룹" value={filters.group} onChange={(e) => set({ group: e.target.value })}>
            <option value="">모든 그룹</option>
            {options.groups.map((group) => (
              <option key={group}>{group}</option>
            ))}
          </select>
          <select aria-label="수요" value={filters.demand} onChange={(e) => set({ demand: e.target.value })}>
            <option value="">모든 수요</option>
            {options.demands.map((demand) => (
              <option key={demand}>{demand}</option>
            ))}
          </select>
          <select aria-label="유형" value={filters.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">모든 유형</option>
            {options.categories.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_NAMES[category] ?? category}
              </option>
            ))}
          </select>
          <input
            type="search"
            aria-label="검색"
            placeholder="질문, 상품, ID 검색"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
          <span className="count" role="status">
            {visible.length} / {data.questions.length}문항
          </span>
        </div>

        {visible.length === 0 ? (
          <div className="empty">
            <p>조건에 맞는 질문이 없습니다. 필터를 풀거나 검색어를 바꿔 보세요.</p>
            <button type="button" className="button" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
              필터 지우기
            </button>
          </div>
        ) : (
          <ul className="entries">
            {visible.map((question) => {
              const mine = latestAnswers.filter((a) => a.qid === question.id);
              return (
                <li key={question.id}>
                  <button type="button" className="entry" onClick={() => onOpen(question.id)}>
                    <span className="entry-id">{question.id}</span>
                    <span className="entry-text">{question.question}</span>
                    <span className="entry-tags">
                      <Badge>{question.demand}</Badge>
                      <Badge>{`${question.category}형`}</Badge>
                      <GroupBadge group={question.group} />
                    </span>
                    <span className="entry-product">{question.product}</span>
                    <span className="entry-hits">
                      {mine.length > 0 ? <EnginePips hit={enginesMentioning(mine)} /> : '측정 전'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
