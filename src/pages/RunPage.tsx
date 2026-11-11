import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '../components/Badges';
import { num } from '../lib/format';
import { runInBrowser } from '../runner/browserJob';
import { RunnerLocked, RunnerUnavailable, runner } from '../runner/client';
import type {
  BrandRule,
  EngineId,
  EngineSettings,
  EngineTestResult,
  JobStatus,
  RunnerConfig,
  RunnerOverview,
} from '../runner/types';

/** 화면에서 고치는 값. 목록은 쉼표와 줄바꿈으로 적는 글자 그대로 들고 있다가 저장할 때 풉니다. */
interface Form {
  engines: Record<EngineId, EngineSettings>;
  repetitions: number;
  concurrency: number;
  ownAliases: string;
  competitors: string;
  ownDomains: string;
}

const splitList = (text: string) =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toForm = (config: RunnerConfig): Form => ({
  engines: config.engines,
  repetitions: config.repetitions,
  concurrency: config.concurrency,
  ownAliases: config.ownBrand.aliases.join(', '),
  competitors: config.competitors.map((c) => `${c.name}: ${c.aliases.join(', ')}`).join('\n'),
  ownDomains: config.ownDomains.join(', '),
});

function toConfig(form: Form, base: RunnerConfig): RunnerConfig {
  const competitors: BrandRule[] = form.competitors.split('\n').flatMap((line) => {
    const [name = '', aliases = ''] = line.split(':');
    if (!name.trim()) return [];
    const list = splitList(aliases);
    return [{ name: name.trim(), aliases: list.length > 0 ? list : [name.trim()] }];
  });
  return {
    engines: form.engines,
    repetitions: form.repetitions,
    concurrency: form.concurrency,
    ownBrand: { name: base.ownBrand.name, aliases: splitList(form.ownAliases) },
    competitors,
    ownDomains: splitList(form.ownDomains),
  };
}

const IDLE: JobStatus = {
  state: 'idle',
  wave: null,
  startedAt: null,
  finishedAt: null,
  engines: [],
  message: null,
};

const isBusy = (job: JobStatus) => job.state === 'running' || job.state === 'cancelling';

const STATE_LABELS: Record<JobStatus['state'], string> = {
  idle: '',
  running: '실행 중',
  cancelling: '멈추는 중',
  done: '저장 완료',
  cancelled: '중지됨',
  failed: '실패',
};

interface RunPageProps {
  /** 새 회차가 저장되면 대시보드 데이터를 다시 읽게 합니다. */
  onSaved: () => void;
  onShowOverview: () => void;
}

export function RunPage({ onSaved, onShowOverview }: RunPageProps) {
  const [overview, setOverview] = useState<RunnerOverview | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [wave, setWave] = useState('');
  const [limit, setLimit] = useState(0);
  const [job, setJob] = useState<JobStatus>(IDLE);
  const [tests, setTests] = useState<Partial<Record<EngineId, EngineTestResult | 'pending'>>>({});
  const [confirming, setConfirming] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [locked, setLocked] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const abort = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lastState = useRef<JobStatus['state']>('idle');

  const apply = useCallback((next: RunnerOverview) => {
    setOverview(next);
    setForm(toForm(next.config));
    setWave(next.nextWave);
  }, []);

  const fail = useCallback((reason: unknown) => {
    if (reason instanceof RunnerUnavailable) setUnavailable(true);
    else if (reason instanceof RunnerLocked) setLocked(true);
    else setError((reason as Error).message);
  }, []);

  const load = useCallback(async () => {
    const next = await runner.overview();
    apply(next);
    setLocked(false);
    // 로컬 모드에서는 탭을 다시 열어도 진행 중인 실행을 이어서 보여 줍니다.
    if (next.mode === 'local') {
      const status = await runner.status();
      setJob(status);
      lastState.current = status.state;
    }
  }, [apply]);

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  // 실행 중에는 1초마다 진행 상황을 읽습니다.
  const busy = isBusy(job);
  const hosted = overview?.mode === 'hosted';
  useEffect(() => {
    if (!busy || hosted) return;
    const timer = window.setInterval(() => {
      runner.status().then(setJob).catch(fail);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy, hosted, fail]);

  // 실행이 저장까지 끝난 순간 한 번, 대시보드와 다음 회차 이름을 새로 읽습니다.
  useEffect(() => {
    if (lastState.current !== 'done' && job.state === 'done') {
      onSaved();
      runner.overview().then(apply).catch(fail);
    }
    lastState.current = job.state;
  }, [job.state, onSaved, apply, fail]);

  if (unavailable) {
    return (
      <div className="page">
        <section className="block">
          <h2 className="page-title">측정 실행</h2>
          <div className="empty">
            <p>
              실행은 이 컴퓨터에서 개발 서버로 연 화면에서만 할 수 있습니다. 터미널에서 <code>npm run dev</code>
              를 실행한 뒤 열리는 주소에서 이 탭을 다시 여세요.
            </p>
          </div>
        </section>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="page">
        <section className="block">
          <h2 className="page-title">측정 실행</h2>
          <p className="note">
            실행하면 API 요금이 나가므로 허용된 계정으로 로그인해야 합니다. 로그인은 이 탭을 닫으면 풀립니다.
          </p>
          <form
            className="run-login"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              runner
                .login(email.trim(), password)
                .then(load)
                .catch((reason: unknown) => {
                  if (reason instanceof RunnerLocked) setError(reason.message);
                  else fail(reason);
                });
            }}
          >
            <label className="field">
              <span>이메일</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span>비밀번호</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" className="button button--primary" disabled={!email || !password}>
              로그인
            </button>
          </form>
          {error && (
            <p className="run-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    );
  }

  if (!overview || !form) {
    return (
      <p className="status-line" role="status">
        {error ?? '실행 설정을 불러오는 중입니다.'}
      </p>
    );
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(overview.config));
  const active = overview.engines.filter(
    (engine) => form.engines[engine.id].enabled && (engine.keyPresent || overview.fakeMode),
  );
  const questionCount = limit > 0 ? Math.min(limit, overview.questionCount) : overview.questionCount;
  const planned = questionCount * active.length * form.repetitions;
  const waveTaken = !overview.replacesMock && overview.existingWaves.includes(wave.trim());
  const unfinished = overview.unfinished.find((u) => u.wave === wave.trim());

  const setEngine = (id: EngineId, patch: Partial<EngineSettings>) =>
    setForm({ ...form, engines: { ...form.engines, [id]: { ...form.engines[id], ...patch } } });

  /** 고친 값이 있으면 저장합니다. 테스트와 실행은 저장된 설정으로 돕니다. */
  const saveIfDirty = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const next = await runner.saveConfig(toConfig(form, overview.config));
      setOverview(next);
      setForm(toForm(next.config));
    } finally {
      setSaving(false);
    }
  };

  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch(fail);
  };

  const test = (id: EngineId) =>
    run(async () => {
      setTests((current) => ({ ...current, [id]: 'pending' }));
      try {
        const result = await runner.test(id, toConfig(form, overview.config));
        setTests((current) => ({ ...current, [id]: result }));
      } catch (reason) {
        setTests((current) => ({ ...current, [id]: undefined }));
        throw reason;
      }
    });

  const start = () =>
    run(async () => {
      setConfirming(false);
      if (!hosted) {
        await saveIfDirty();
        setJob(await runner.start(wave, limit));
        return;
      }
      // 배포 모드: 저장하지 않은 설정도 이번 실행에 그대로 적용합니다.
      abort.current = new AbortController();
      await runInBrowser({
        wave: wave.trim(),
        config: toConfig(form, overview.config),
        engines: active.map((engine) => engine.id),
        questionIds: overview.questionIds.slice(0, questionCount),
        signal: abort.current.signal,
        onUpdate: setJob,
      });
      // 멈추거나 실패한 회차가 "이어서 실행" 안내에 바로 나타나도록 현황을 다시 읽습니다.
      setOverview(await runner.overview());
    });

  return (
    <div className="page">
      <section className="block">
        <h2 className="page-title">측정 실행</h2>
        <p className="note">
          질문셋을 엔진에 실제로 묻고 결과를 새 회차로 저장합니다.{' '}
          {hosted && '응답은 받는 즉시 데이터베이스에 저장되고, 중간에 끊겨도 같은 회차로 이어서 실행할 수 있습니다. '}
          {overview.envFile
            ? `API 키는 이 컴퓨터의 ${overview.envFile} 파일에서 읽고, 화면에는 연결 여부만 표시합니다.`
            : hosted
              ? 'API 키는 서버 환경변수에서 읽고, 화면에는 연결 여부만 표시합니다.'
              : '키 파일을 찾지 못했습니다. 프로젝트 폴더에 djbank.env 파일을 넣으면 바로 반영됩니다.'}
        </p>
        {hosted && runner.signedInAs() && (
          <p className="note">
            {runner.signedInAs()} 계정으로 로그인했습니다.{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                runner.logout();
                setLocked(true);
              }}
            >
              로그아웃
            </button>
          </p>
        )}
        {overview.fakeMode && (
          <p className="load-error" role="status">
            연습 모드입니다. 실제 API를 호출하지 않고 가짜 답변으로 화면과 저장 흐름만 확인합니다.
          </p>
        )}

        <fieldset className="run-form" disabled={busy}>
          <h3 className="run-heading">엔진</h3>
          <div className="table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th>사용</th>
                  <th>엔진</th>
                  <th>키</th>
                  <th>모델</th>
                  <th>연결 테스트</th>
                </tr>
              </thead>
              <tbody>
                {overview.engines.map((engine) => {
                  const settings = form.engines[engine.id];
                  const result = tests[engine.id];
                  return (
                    <tr key={engine.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${engine.name} 사용`}
                          checked={settings.enabled}
                          onChange={(e) => setEngine(engine.id, { enabled: e.target.checked })}
                        />
                      </td>
                      <td className="nowrap">{engine.name}</td>
                      <td className="nowrap">
                        {engine.keyPresent ? (
                          <Badge variant="accent">연결됨</Badge>
                        ) : (
                          <span title={`${engine.keyName} 값이 키 파일에 없습니다`}>
                            <Badge>키 없음</Badge>
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          className="input input--model"
                          aria-label={`${engine.name} 모델`}
                          value={settings.model}
                          spellCheck={false}
                          onChange={(e) => setEngine(engine.id, { model: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button"
                          disabled={result === 'pending'}
                          onClick={() => test(engine.id)}
                        >
                          {result === 'pending' ? '확인 중' : '테스트'}
                        </button>
                        {result && result !== 'pending' && (
                          <span className={`test-result${result.ok ? '' : ' test-result--fail'}`} role="status">
                            {result.ok
                              ? `연결됨, ${result.model}, ${(result.ms / 1000).toFixed(1)}초`
                              : result.message}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="note">
            Perplexity는 모델 대신 검색 강도 단계를 적습니다: fast, low, medium, high.
          </p>

          <h3 className="run-heading">실행 범위</h3>
          <div className="run-fields">
            <label className="field">
              <span>회차 이름</span>
              <input
                className="input"
                value={wave}
                spellCheck={false}
                onChange={(e) => setWave(e.target.value)}
              />
            </label>
            <label className="field">
              <span>시험 실행, 앞에서부터 몇 문항만</span>
              <input
                className="input"
                type="number"
                min={0}
                max={overview.questionCount}
                placeholder={`비우면 전체 ${overview.questionCount}문항`}
                value={limit || ''}
                onChange={(e) => setLimit(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="field">
              <span>질문당 반복 횟수</span>
              <input
                className="input"
                type="number"
                min={1}
                max={5}
                value={form.repetitions}
                onChange={(e) => setForm({ ...form, repetitions: Number(e.target.value) || 1 })}
              />
            </label>
            <label className="field">
              <span>엔진별 동시 호출 수</span>
              <input
                className="input"
                type="number"
                min={1}
                max={8}
                value={form.concurrency}
                onChange={(e) => setForm({ ...form, concurrency: Number(e.target.value) || 1 })}
              />
            </label>
          </div>

          <details className="run-rules">
            <summary>판정 기준</summary>
            <p className="note">
              답변 글에 아래 표기가 있으면 언급으로 셉니다. 대소문자는 구분하지 않습니다. 추천 강도, 감성,
              치명 환각은 아직 판정하지 않아 화면에 —로 나옵니다.
            </p>
            <label className="field">
              <span>DJ Bank로 세는 표기, 쉼표로 구분</span>
              <input
                className="input"
                value={form.ownAliases}
                onChange={(e) => setForm({ ...form, ownAliases: e.target.value })}
              />
            </label>
            <label className="field">
              <span>경쟁 은행, 한 줄에 하나씩 "이름: 표기, 표기"</span>
              <textarea
                className="input"
                rows={Math.max(4, form.competitors.split('\n').length)}
                value={form.competitors}
                onChange={(e) => setForm({ ...form, competitors: e.target.value })}
              />
            </label>
            <label className="field">
              <span>자사 도메인, 쉼표로 구분. 비워 두면 자사 인용 점유율은 계산하지 않습니다</span>
              <input
                className="input"
                placeholder="예: djbank.co.kr"
                value={form.ownDomains}
                spellCheck={false}
                onChange={(e) => setForm({ ...form, ownDomains: e.target.value })}
              />
            </label>
          </details>
        </fieldset>

        <div className="run-summary">
          <p className="run-count">
            질문 {questionCount}개 × 엔진 {active.length}곳 × {form.repetitions}회 ={' '}
            <strong>{num(planned)}건</strong> 호출
          </p>
          {overview.replacesMock && (
            <p className="note">
              지금 화면의 모의 데이터는 archive 폴더로 옮겨지고, 이 실행부터 새로 쌓입니다.
            </p>
          )}
          {limit > 0 && limit < overview.questionCount && (
            <p className="note">
              시험 실행입니다. 일부 문항만 물어 이 회차로 저장합니다.{' '}
              {hosted
                ? '나중에 같은 회차 이름으로 전체를 실행하면 나머지 문항만 추가로 묻습니다.'
                : '나중에 같은 회차 이름으로 전체를 다시 실행하면 이 값을 덮어씁니다.'}
            </p>
          )}
          {waveTaken && (
            <p className="note">
              {wave.trim()} 회차가 이미 있습니다.{' '}
              {hosted
                ? '실행하면 받아 둔 응답은 그대로 두고 빠진 문항만 추가로 묻습니다.'
                : '실행하면 그 회차 값을 새 값으로 바꿉니다.'}
            </p>
          )}
          {unfinished && (
            <p className="note">
              {unfinished.wave} 회차는 응답 {unfinished.answered}건을 받은 채 멈춰 있습니다. 실행하면 이어서 진행합니다.{' '}
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => run(async () => apply(await runner.discard(unfinished.wave)))}
              >
                받아 둔 응답 버리기
              </button>
            </p>
          )}
          {active.length === 0 && (
            <p className="note">실행할 엔진이 없습니다. 키가 연결된 엔진을 하나 이상 켜세요.</p>
          )}

          {confirming ? (
            <div className="run-confirm" role="alertdialog" aria-label="실행 확인">
              <p>
                {overview.fakeMode
                  ? `연습 모드로 ${num(planned)}건을 가짜 답변으로 채웁니다.`
                  : `실제 API를 ${num(planned)}건 호출하며, 엔진마다 요금이 나갑니다.`}
              </p>
              <button type="button" className="button button--primary" onClick={start}>
                {num(planned)}건 실행
              </button>
              <button type="button" className="button" onClick={() => setConfirming(false)}>
                취소
              </button>
            </div>
          ) : (
            <div className="run-actions">
              <button
                type="button"
                className="button button--primary"
                disabled={busy || planned === 0 || saving}
                onClick={() => setConfirming(true)}
              >
                실행 시작
              </button>
              <button
                type="button"
                className="button"
                disabled={!dirty || busy || saving}
                onClick={() => run(saveIfDirty)}
              >
                {saving ? '저장 중' : dirty ? '설정 저장' : '설정 저장됨'}
              </button>
            </div>
          )}
          {error && (
            <p className="run-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      {job.state !== 'idle' && (
        <section className="block">
          <h2>
            {job.wave} 회차, {STATE_LABELS[job.state]}
          </h2>
          <p className="note" role="status">
            {job.message ?? '엔진별로 차례대로 묻고 있습니다. 이 탭을 닫아도 실행은 계속됩니다.'}
          </p>
          <div className="table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th>엔진</th>
                  <th>모델</th>
                  <th>진행</th>
                  <th className="num">DJ 언급</th>
                  <th className="num">실패</th>
                  <th className="num">토큰, 입력 / 출력</th>
                </tr>
              </thead>
              <tbody>
                {job.engines.map((engine) => {
                  const name = overview.engines.find((e) => e.id === engine.id)?.name ?? engine.id;
                  return (
                    <tr key={engine.id}>
                      <td className="nowrap">{name}</td>
                      <td className="nowrap">{engine.model}</td>
                      <td>
                        <div className="progress">
                          <progress
                            max={engine.planned}
                            value={engine.done}
                            aria-label={`${name} 진행`}
                          />
                          <span>
                            {engine.done}/{engine.planned}
                          </span>
                        </div>
                        {engine.lastError && <p className="run-error">최근 오류: {engine.lastError}</p>}
                      </td>
                      <td className="num">{num(engine.mentioned)}</td>
                      <td className="num">{num(engine.failed)}</td>
                      <td className="num">
                        {num(engine.inputTokens)} / {num(engine.outputTokens)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="run-actions">
            {job.state === 'running' && (
              <button
                type="button"
                className="button"
                onClick={() => (hosted ? abort.current?.abort() : run(async () => setJob(await runner.cancel())))}
              >
                실행 중지
              </button>
            )}
            {job.state === 'done' && (
              <button type="button" className="button button--primary" onClick={onShowOverview}>
                개요에서 결과 보기
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
