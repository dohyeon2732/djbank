-- DJ Bank GEO 관제센터 스키마. 여러 번 실행해도 안전합니다.
-- 모든 테이블은 RLS를 켜고 정책을 두지 않습니다: 공개 키로는 읽고 쓸 수 없고,
-- 서버(비밀 키)만 접근합니다. 화면은 서버의 /api/data, /api/runner를 거칩니다.

create table if not exists public.questions (
  id        text primary key,
  position  integer not null,
  question  text not null,
  category  text not null default '',
  demand    text not null default '',
  product   text not null default '',
  release   text not null default '',
  speaker   text not null default '',
  "group"   text not null default '',
  rationale text not null default ''
);

-- 회차. status가 done인 회차만 대시보드에 나옵니다. running은 실행 중이거나 중단된 회차입니다.
create table if not exists public.runs (
  wave          text primary key,
  date          date not null default current_date,
  planned       integer not null default 0,
  succeeded     integer not null default 0,
  failed        integer not null default 0,
  engines       integer not null default 0,
  questions     integer not null default 0,
  judge_version text not null default '',
  mode          text not null default '',
  status        text not null default 'running' check (status in ('running', 'done')),
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- 응답 한 건. 받는 즉시 저장해서, 실행이 끊겨도 받은 데까지 남습니다.
create table if not exists public.responses (
  wave          text not null references public.runs (wave) on delete cascade,
  qid           text not null,
  engine        text not null,
  rep           integer not null default 1,
  mention       boolean not null default false,
  rank          integer,
  rec           integer,
  sentiment     text,
  brands        jsonb not null default '[]'::jsonb,
  cites         integer not null default 0,
  own_cites     integer not null default 0,
  excerpt       text,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (wave, qid, engine, rep)
);

-- 응답 원문과 인용 주소. 나중에 AI 채점을 붙일 때 다시 읽습니다.
create table if not exists public.response_raw (
  wave        text not null,
  qid         text not null,
  engine      text not null,
  rep         integer not null default 1,
  answer_text text not null default '',
  citations   jsonb not null default '[]'::jsonb,
  primary key (wave, qid, engine, rep),
  foreign key (wave, qid, engine, rep) references public.responses (wave, qid, engine, rep) on delete cascade
);

create table if not exists public.segments (
  wave      text not null references public.runs (wave) on delete cascade,
  dim       text not null,
  name      text not null,
  "group"   text not null default '',
  mention_p double precision,
  lo        double precision,
  hi        double precision,
  k         integer not null default 0,
  n         integer not null default 0,
  rank_avg  double precision,
  rec_avg   double precision,
  sov       double precision,
  acc_rate  double precision,
  critical  integer,
  sent_net  double precision,
  own_cit   integer,
  total_cit integer,
  own_share double precision,
  primary key (wave, dim, name)
);

create table if not exists public.brands (
  wave  text not null references public.runs (wave) on delete cascade,
  brand text not null,
  count integer not null default 0,
  primary key (wave, brand)
);

-- 실행 탭 설정. 한 줄만 둡니다.
create table if not exists public.runner_config (
  id         integer primary key default 1 check (id = 1),
  config     jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.questions     enable row level security;
alter table public.runs          enable row level security;
alter table public.responses     enable row level security;
alter table public.response_raw  enable row level security;
alter table public.segments      enable row level security;
alter table public.brands        enable row level security;
alter table public.runner_config enable row level security;
