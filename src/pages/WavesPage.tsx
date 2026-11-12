import { useMemo } from 'react';
import { num } from '../lib/format';
import { ENGINES, ENGINE_NAMES, answerWaves, enginesMentioning } from '../lib/selectors';
import type { Answer, DashboardData } from '../types';

const QUESTION_PREVIEW = 34;

function HitCell({ answers, engine }: { answers: Answer[]; engine: string }) {
  const name = ENGINE_NAMES[engine] ?? engine;
  if (answers.length === 0) {
    return (
      <td className="cell cell--none" aria-label={`${name} 응답 없음`}>
        –
      </td>
    );
  }
  const hit = answers.some((a) => a.mention);
  return (
    <td className={`cell${hit ? ' cell--hit' : ' cell--miss'}`} aria-label={`${name} ${hit ? '언급' : '미언급'}`}>
      {hit ? '●' : '○'}
    </td>
  );
}

interface WavesPageProps {
  data: DashboardData;
  wave: string | null;
  onWaveChange: (wave: string) => void;
  onOpen: (questionId: string, wave: string | null) => void;
}

export function WavesPage({ data, wave, onWaveChange, onOpen }: WavesPageProps) {
  const waves = useMemo(() => answerWaves(data.answers), [data.answers]);
  const current = wave && waves.includes(wave) ? wave : (waves.at(-1) ?? null);
  const answers = useMemo(
    () => data.answers.filter((a) => a.wave === current),
    [data.answers, current],
  );

  const questionIds = new Set(answers.map((a) => a.qid));
  const hitCount = [...questionIds].filter((id) =>
    answers.some((a) => a.qid === id && a.mention),
  ).length;
  const run = data.runs.find((r) => r.wave === current);

  return (
    <div className="page">
      <section className="block">
        <h2 className="page-title">주차별 질문과 응답 현황</h2>
        <p className="note">
          회차를 고르면 질문마다 네 엔진이 DJ Bank를 언급했는지가 표로 나옵니다. 질문 ID를 누르면 상세가
          열립니다.
        </p>

        <div className="filters">
          <select
            aria-label="회차"
            value={current ?? ''}
            onChange={(event) => onWaveChange(event.target.value)}
          >
            {waves.map((id) => (
              <option key={id} value={id}>
                {id} 회차
              </option>
            ))}
          </select>
          <span className="count" role="status">
            {current
              ? `응답 ${num(answers.length)}건${run ? `, 실패 ${num(run.failed)}건` : ''}. 질문 ${questionIds.size}개 중 ${hitCount}개에서 1개 이상 엔진이 DJ Bank를 언급했습니다.`
              : '측정 전'}
          </span>
        </div>

        <div className="table-scroll table-scroll--tall">
          <table className="ledger ledger--sticky">
            <thead>
              <tr>
                <th>ID</th>
                <th>질문</th>
                <th>상품</th>
                {ENGINES.map((engine) => (
                  <th key={engine} className="center">
                    {ENGINE_NAMES[engine]}
                  </th>
                ))}
                <th className="num">언급 엔진</th>
              </tr>
            </thead>
            <tbody>
              {data.questions.map((question) => {
                const mine = answers.filter((a) => a.qid === question.id);
                const preview =
                  question.question.length > QUESTION_PREVIEW
                    ? `${question.question.slice(0, QUESTION_PREVIEW)}…`
                    : question.question;
                return (
                  <tr key={question.id} className="row-link" onClick={() => onOpen(question.id, current)}>
                    <td>
                      {/* 클릭은 행의 onClick으로 올라갑니다. 버튼은 키보드 접근용입니다. */}
                      <button type="button" className="link-button">
                        {question.id}
                      </button>
                    </td>
                    <td title={question.question}>{preview}</td>
                    <td className="nowrap">{question.product}</td>
                    {ENGINES.map((engine) => (
                      <HitCell
                        key={engine}
                        engine={engine}
                        answers={mine.filter((a) => a.engine === engine)}
                      />
                    ))}
                    <td className="num">
                      {enginesMentioning(mine)}/{ENGINES.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
