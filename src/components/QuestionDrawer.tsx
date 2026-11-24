import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ENGINES,
  ENGINE_NAMES,
  CATEGORY_SHORT,
  SENTIMENT_NAMES,
  answerWaves,
  enginesMentioning,
} from '../lib/selectors';
import { loadFullAnswers } from '../data/api';
import type { Answer, DashboardData, FullAnswer, Question } from '../types';
import { Badge, EnginePips } from './Badges';

const EXCERPT_LIMIT = 600;

/** AI 채점이 상품 사실과 비교한 결과. */
const ACCURACY_NAMES: Record<string, string> = {
  none: '사실과 맞음',
  minor: '조금 다름',
  critical: '심각하게 틀림',
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 접혀 있을 때 보여 줄 첫머리. AI가 쓴 서식 기호와 링크 주소는 뺍니다. */
function previewOf(text: string): string {
  return text
    .replace(/\(?\[([^\]]*)\]\([^)]*\)\)?/g, '')
    .replace(/[*#`>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

const MARKDOWN_PLUGINS = [remarkGfm];

function EngineAnswer({
  engine,
  answers,
  full,
  loading,
}: {
  engine: string;
  answers: Answer[];
  full: FullAnswer | undefined;
  loading: boolean;
}) {
  const first = answers[0];
  if (!first) return null;
  const isHit = answers.some((a) => a.mention);
  // 전문을 읽어 오기 전이나 읽지 못했을 때는 함께 저장해 둔 앞부분을 보여 줍니다.
  const cut = !full?.text && (first.excerpt?.length ?? 0) >= EXCERPT_LIMIT;
  const text = full?.text || (first.excerpt ? `${first.excerpt}${cut ? '…' : ''}` : '이 답변은 내용이 저장되지 않았습니다.');
  const cites = full?.citations ?? [];
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <article className="answer">
      <header className="answer-head">
        <h4>{ENGINE_NAMES[engine] ?? engine}</h4>
        <Badge variant={isHit ? 'accent' : undefined}>{isHit ? 'DJ 언급' : '미언급'}</Badge>
        {isHit && first.rank != null && <Badge>{`순위 ${first.rank}/3`}</Badge>}
        {isHit && first.rec != null && <Badge>{`추천 정도 ${first.rec}/3`}</Badge>}
        {isHit && first.sentiment && (
          <Badge>{SENTIMENT_NAMES[first.sentiment] ?? first.sentiment}</Badge>
        )}
        {first.accuracy && <Badge>{ACCURACY_NAMES[first.accuracy] ?? first.accuracy}</Badge>}
        {first.brands.length > 0 && <Badge>{`경쟁 언급 ${first.brands.length}곳`}</Badge>}
      </header>
      {first.judge_note && (
        <p className={`answer-judge${first.accuracy === 'critical' ? ' answer-judge--alert' : ''}`}>
          AI 채점: {first.judge_note}
        </p>
      )}
      {open ? (
        <div className="answer-text answer-rich" id={bodyId}>
          <Markdown
            remarkPlugins={MARKDOWN_PLUGINS}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {text}
          </Markdown>
        </div>
      ) : (
        <p className="answer-text answer-preview">{previewOf(text)}</p>
      )}
      <button
        type="button"
        className="link-button answer-toggle"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen(!open)}
      >
        {open ? '답변 접기' : '답변 전체 보기'}
      </button>
      {open && cut && (
        <p className="answer-brands">
          {loading ? '답변 전체를 불러오는 중입니다.' : '답변 전체를 불러오지 못해 앞부분만 보여 줍니다.'}
        </p>
      )}
      {open && cites.length > 0 && (
        <details className="answer-cites">
          <summary>AI가 참고한 출처 {cites.length}건</summary>
          <ol>
            {cites.map((cite, index) => (
              <li key={`${cite.url}:${index}`}>
                <a href={cite.url} target="_blank" rel="noreferrer">
                  {cite.title || hostOf(cite.url)}
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
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

  // 답변 전문은 양이 많아, 질문을 열었을 때 그 회차 것만 읽습니다.
  const [full, setFull] = useState<{ key: string; rows: FullAnswer[] | null } | null>(null);
  const fullKey = shownWave ? `${shownWave}:${question.id}` : null;
  useEffect(() => {
    if (!shownWave) return;
    let stale = false;
    const key = `${shownWave}:${question.id}`;
    void loadFullAnswers(shownWave, question.id).then((rows) => {
      if (!stale) setFull({ key, rows });
    });
    return () => {
      stale = true;
    };
  }, [shownWave, question.id]);
  const fullRows = full && full.key === fullKey ? full.rows : undefined;

  return (
    <>
      <div className="tag-row">
        <b>{question.id}</b>
        <Badge>{question.demand}</Badge>
        <Badge>{CATEGORY_SHORT[question.category] ?? question.category}</Badge>
        {question.release && <Badge>{question.release}</Badge>}
        {question.speaker && <Badge>{question.speaker}</Badge>}
        {question.group && <Badge>{question.group}</Badge>}
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
          <h4>AI 서비스별 답변, {shownWave} 회차</h4>
          {shown.length === 0 && <p className="note">{shownWave} 회차에는 이 질문을 묻지 않았습니다.</p>}
          {ENGINES.map((engine) => (
            <EngineAnswer
              key={engine}
              engine={engine}
              answers={shown.filter((a) => a.engine === engine)}
              full={fullRows?.find((row) => row.engine === engine)}
              loading={fullRows === undefined}
            />
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
