// public/data의 질문셋과 실측 회차를 Supabase로 옮깁니다. 여러 번 실행해도 같은 결과입니다.
// 사용: npm run db:seed  (djbank.env의 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = parseEnv(readFileSync('djbank.env', 'utf8'));
const base = `${(env.SUPABASE_URL ?? '').replace(/\/+$/, '')}/rest/v1`;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!env.SUPABASE_URL || !key) throw new Error('djbank.env에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');

const read = (file) => JSON.parse(readFileSync(`public/data/${file}.json`, 'utf8'));
async function upsert(table, rows, onConflict) {
  if (rows.length === 0) return;
  const response = await fetch(`${base}/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`${table}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  console.log(`${table}: ${rows.length}행`);
}

await upsert('questions', read('questions').map((q, index) => ({ ...q, position: index + 1 })), 'id');

// 모의 데이터와 연습 실행은 옮기지 않습니다.
const runs = read('runs').filter((r) => r.mode === '실측');
const waves = new Set(runs.map((r) => r.wave));
const mine = (rows) => rows.filter((row) => waves.has(row.wave));
await upsert('runs', runs.map((r) => ({ ...r, status: 'done', finished_at: new Date().toISOString() })), 'wave');
await upsert(
  'responses',
  mine(read('responses')).map((r) => ({ ...r, mention: r.mention === true || r.mention === 'True', own_cites: 0 })),
  'wave,qid,engine,rep',
);
await upsert('segments', mine(read('segments')), 'wave,dim,name');
await upsert('brands', mine(read('brands')), 'wave,brand');

// 응답 원문: 로컬 실행이 archive/에 남긴 기록에서 회차별 가장 최근 것을 옮깁니다.
if (existsSync('archive')) {
  const raw = new Map();
  const tokens = [];
  for (const file of readdirSync('archive').filter((f) => f.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(`archive/${file}`, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      if (!waves.has(r.wave)) continue;
      const id = { wave: r.wave, qid: r.qid, engine: r.engine, rep: r.rep };
      raw.set(JSON.stringify(id), { ...id, answer_text: r.text ?? '', citations: r.citations ?? [] });
      tokens.push({ ...id, model: r.model, input_tokens: r.inputTokens ?? 0, output_tokens: r.outputTokens ?? 0, own_cites: r.verdict?.ownCites ?? 0 });
    }
  }
  await upsert('response_raw', [...raw.values()], 'wave,qid,engine,rep');
  // 모델 이름과 토큰 수도 채웁니다(행마다 열이 같아야 한꺼번에 올릴 수 있습니다).
  const latest = [...new Map(tokens.map((t) => [`${t.wave}|${t.qid}|${t.engine}|${t.rep}`, t])).values()];
  for (const t of latest) {
    const { wave, qid, engine, rep, ...values } = t;
    const filter = `wave=eq.${encodeURIComponent(wave)}&qid=eq.${encodeURIComponent(qid)}&engine=eq.${engine}&rep=eq.${rep}`;
    const response = await fetch(`${base}/responses?${filter}`, {
      method: 'PATCH',
      headers: { apikey: key, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify(values),
    });
    if (!response.ok) throw new Error(`responses 갱신: ${response.status}`);
  }
  console.log(`responses 모델·토큰 갱신: ${latest.length}행`);
}
