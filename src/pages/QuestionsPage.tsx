import { useMemo } from 'react';
import { Badge, EnginePips } from '../components/Badges';
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
  /** 주차별 현황과 함께 쓰는 선택 회차. null이면 최근 회차. */
  wave: string | null;
  onWaveChange: (wave: string) => void;
  onOpen: (questionId: string, wave: string | null) => void;
}

export function QuestionsPage({ data, filters, onFiltersChange, wave, onWaveChange, onOpen }: QuestionsPageProps) {
  const options = useMemo(() => filterOptions(data.questions), [data.questions]);
  const visible = useMemo(() => filterQuestions(data.questions, filters), [data.questions, filters]);
  const waves = useMemo(() => answerWaves(data.answers), [data.answers]);
  const lastWave = wave && waves.includes(wave) ? wave : waves.at(-1);
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
          측정에 쓰는 고정 질문 전체입니다. 오른쪽 표시는 고른 회차에서 DJ Bank를 언급한 엔진 수이고, 질문을 누르면
          그 회차의 응답과 추이를 볼 수 있습니다. 문구와
          ID는 측정 기간 동안 바뀌지 않습니다.
        </p>

        <div className="filters">
          {waves.length > 0 && (
            <select aria-label="회차" value={lastWave ?? ''} onChange={(e) => onWaveChange(e.target.value)}>
              {waves.map((id) => (
                <option key={id} value={id}>
                  {id} 회차
                </option>
              ))}
            </select>
          )}
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
                  <button type="button" className="entry" onClick={() => onOpen(question.id, lastWave ?? null)}>
                    <span className="entry-id">{question.id}</span>
                    <span className="entry-text">{question.question}</span>
                    <span className="entry-tags">
                      <Badge>{question.demand}</Badge>
                      <Badge>{`${question.category}형`}</Badge>
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
