import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  ENGINES,
  ENGINE_NAMES,
  SENTIMENT_NAMES,
  answerWaves,
  enginesMentioning,
} from '../lib/selectors';
import type { Answer, DashboardData, Question } from '../types';
import { Badge, EnginePips } from './Badges';

const EXCERPT_LIMIT = 600;

function EngineAnswer({ engine, answers }: { engine: string; answers: Answer[] }) {
  const first = answers[0];
  if (!first) return null;
  const isHit = answers.some((a) => a.mention);
  const excerpt = first.excerpt
    ? `${first.excerpt}${first.excerpt.length >= EXCERPT_LIMIT ? '…' : ''}`
    : '이 응답은 발췌본이 저장되지 않았습니다.';

  return (
    <article className="answer">
      <header className="answer-head">
        <h4>{ENGINE_NAMES[engine] ?? engine}</h4>
        <Badge variant={isHit ? 'accent' : undefined}>{isHit ? 'DJ 언급' : '미언급'}</Badge>
        {isHit && first.rank != null && <Badge>{`순위 ${first.rank}/3`}</Badge>}
        {isHit && first.rec != null && <Badge>{`추천 강도 ${first.rec}/3`}</Badge>}
        {isHit && first.sentiment && (
          <Badge>{SENTIMENT_NAMES[first.sentiment] ?? first.sentiment}</Badge>
        )}
        {first.brands.length > 0 && <Badge>{`경쟁 언급 ${first.brands.length}곳`}</Badge>}
      </header>
      <p className="answer-text">{excerpt}</p>
      {first.brands.length > 0 && (
        <p className="answer-brands">함께 언급된 브랜드: {first.brands.join(', ')}</p>
      )}
    </article>
  );
}

function QuestionDetail({
  question,
  answers,
  wave,
}: {
  question: Question;
  answers: Answer[];
  wave: string | null;
}) {
  const mine = useMemo(() => answers.filter((a) => a.qid === question.id), [answers, question.id]);
  const waves = useMemo(() => answerWaves(answers), [answers]);
  // 주차별 현황에서 열면 그 회차를, 아니면 최근 회차를 먼저 보여 줍니다. 추이의 회차를 누르면 바뀝니다.
  const [picked, setPicked] = useState(wave);
  const shownWave = picked && waves.includes(picked) ? picked : waves.at(-1);
  const shown = mine.filter((a) => a.wave === shownWave);

  return (
    <>
      <div className="tag-row">
        <b>{question.id}</b>
        <Badge>{question.demand}</Badge>
        <Badge>{`${question.category}형`}</Badge>
        <Badge>{question.release}</Badge>
        <Badge>{question.speaker}</Badge>
      </div>
      <h3 className="drawer-question">{question.question}</h3>
      <dl className="drawer-facts">
        <div>
          <dt>상품</dt>
          <dd>{question.product}</dd>
        </div>
        {question.rationale && (
          <div>
            <dt>설계 의도</dt>
            <dd>{question.rationale}</dd>
          </div>
        )}
      </dl>

      <section className="drawer-section">
        <h4>회차별 언급 추이</h4>
        {waves.length === 0 ? (
          <p className="note">아직 측정 전입니다.</p>
        ) : (
          <ul className="wave-trend">
            {waves.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="link-button"
                  aria-pressed={id === shownWave}
                  onClick={() => setPicked(id)}
                >
                  {id}
                </button>
                <EnginePips hit={enginesMentioning(mine.filter((a) => a.wave === id))} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {shownWave && (
        <section className="drawer-section">
          <h4>엔진별 응답, {shownWave} 회차</h4>
          {shown.length === 0 && <p className="note">{shownWave} 회차에는 이 질문을 묻지 않았습니다.</p>}
          {ENGINES.map((engine) => (
            <EngineAnswer key={engine} engine={engine} answers={shown.filter((a) => a.engine === engine)} />
          ))}
        </section>
      )}
    </>
  );
}

interface QuestionDrawerProps {
  data: DashboardData;
  questionId: string | null;
  /** 먼저 보여 줄 회차. 없으면 최근 회차. */
  wave?: string | null;
  onClose: () => void;
}

export function QuestionDrawer({ data, questionId, wave = null, onClose }: QuestionDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const question = data.questions.find((q) => q.id === questionId);
  const isOpen = Boolean(question);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === ref.current) onClose();
  };

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label="질문 상세"
      onClose={onClose}
      onClick={closeOnBackdrop}
    >
      <div className="drawer-body">
        <div className="drawer-top">
          <h2 className="drawer-title">질문 상세</h2>
          <button type="button" className="button" onClick={onClose}>
            닫기
          </button>
        </div>
        {question && (
          <QuestionDetail key={`${question.id}:${wave ?? ''}`} question={question} answers={data.answers} wave={wave} />
        )}
      </div>
    </dialog>
  );
}
