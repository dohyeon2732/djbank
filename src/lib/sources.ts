/**
 * 인용 출처 주소를 사이트(도메인)로 묶고, 누구의 사이트인지와 유형을 규칙으로 판정합니다.
 * 서버 집계(server/sources.ts)와 화면이 같은 규칙을 씁니다. 규칙에 없는 도메인은 '미분류'로 남깁니다.
 */

export type SourceKind =
  | 'own'
  | 'bank'
  | 'savings'
  | 'finance'
  | 'public'
  | 'press'
  | 'fintech'
  | 'community'
  | 'wiki'
  | 'other';

export const KIND_NAMES: Record<SourceKind, string> = {
  own: 'DJ Bank 자사',
  bank: '은행 공식',
  savings: '저축은행',
  finance: '증권·기타 금융사',
  public: '공공·협회',
  press: '언론',
  fintech: '비교·핀테크',
  community: '블로그·커뮤니티',
  wiki: '백과·위키',
  other: '미분류',
};

export const KIND_ORDER: SourceKind[] = [
  'own',
  'bank',
  'savings',
  'finance',
  'public',
  'press',
  'fintech',
  'community',
  'wiki',
  'other',
];

export interface SiteInfo {
  owner: string;
  kind: SourceKind;
}

const site = (owner: string, kind: SourceKind): SiteInfo => ({ owner, kind });

/** 도메인별 소유자와 유형. 새 도메인이 '미분류'로 나오면 여기에 한 줄 추가합니다. */
const SITES: Record<string, SiteInfo> = {
  // 은행
  'kbstar.com': site('KB국민은행', 'bank'),
  'shinhan.com': site('신한은행', 'bank'),
  'hanabank.com': site('하나은행', 'bank'),
  'kebhana.com': site('하나은행', 'bank'),
  'wooribank.com': site('우리은행', 'bank'),
  'nonghyup.com': site('NH농협은행', 'bank'),
  'nhbank.com': site('NH농협은행', 'bank'),
  'ibk.co.kr': site('IBK기업은행', 'bank'),
  'kdb.co.kr': site('KDB산업은행', 'bank'),
  'kakaobank.com': site('카카오뱅크', 'bank'),
  'kbanknow.com': site('케이뱅크', 'bank'),
  'tossbank.com': site('토스뱅크', 'bank'),
  'standardchartered.co.kr': site('SC제일은행', 'bank'),
  'citibank.co.kr': site('한국씨티은행', 'bank'),
  'suhyup-bank.com': site('Sh수협은행', 'bank'),
  'busanbank.co.kr': site('BNK부산은행', 'bank'),
  'knbank.co.kr': site('BNK경남은행', 'bank'),
  'imbank.co.kr': site('iM뱅크', 'bank'),
  'dgb.co.kr': site('iM뱅크', 'bank'),
  'kjbank.com': site('광주은행', 'bank'),
  'jbbank.co.kr': site('전북은행', 'bank'),
  'jejubank.co.kr': site('제주은행', 'bank'),
  'epostbank.go.kr': site('우체국예금', 'bank'),
  'bankofamerica.co.id': site('Bank of America', 'bank'),
  'bankofamerica.com': site('Bank of America', 'bank'),

  // 저축은행
  'ibksb.co.kr': site('IBK저축은행', 'savings'),
  'woorisavingsbank.com': site('우리금융저축은행', 'savings'),
  'sbisb.co.kr': site('SBI저축은행', 'savings'),
  'oksavingsbank.com': site('OK저축은행', 'savings'),
  'welcomebank.co.kr': site('웰컴저축은행', 'savings'),
  'pepperbank.kr': site('페퍼저축은행', 'savings'),
  'kbsavings.com': site('KB저축은행', 'savings'),
  'shinhansavings.com': site('신한저축은행', 'savings'),
  'hanasavings.com': site('하나저축은행', 'savings'),
  'fsb.or.kr': site('저축은행중앙회', 'savings'),

  // 증권·기타 금융사
  'shinhansec.com': site('신한투자증권', 'finance'),
  'kbsec.com': site('KB증권', 'finance'),
  'truefriend.com': site('한국투자증권', 'finance'),
  'miraeasset.com': site('미래에셋증권', 'finance'),
  'samsungpop.com': site('삼성증권', 'finance'),
  'nhqv.com': site('NH투자증권', 'finance'),
  'kiwoom.com': site('키움증권', 'finance'),
  'kbthink.com': site('KB금융 (KB Think)', 'finance'),
  'kbfg.com': site('KB금융그룹', 'finance'),
  'shinhangroup.com': site('신한금융그룹', 'finance'),
  'hanafn.com': site('하나금융그룹', 'finance'),
  'woorifg.com': site('우리금융그룹', 'finance'),
  'funddoctor.co.kr': site('펀드닥터', 'finance'),
  'nexusfmi.com': site('넥서스FMI', 'finance'),

  // 공공·협회
  'fsc.go.kr': site('금융위원회', 'public'),
  'fss.or.kr': site('금융감독원', 'public'),
  'kfb.or.kr': site('은행연합회', 'public'),
  'kdic.or.kr': site('예금보험공사', 'public'),
  'kinfa.or.kr': site('서민금융진흥원', 'public'),
  'bok.or.kr': site('한국은행', 'public'),
  'kofia.or.kr': site('금융투자협회', 'public'),
  'korea.kr': site('대한민국 정책브리핑', 'public'),

  // 언론
  'chosun.com': site('조선일보', 'press'),
  'joongang.co.kr': site('중앙일보', 'press'),
  'donga.com': site('동아일보', 'press'),
  'hani.co.kr': site('한겨레', 'press'),
  'khan.co.kr': site('경향신문', 'press'),
  'hankyung.com': site('한국경제', 'press'),
  'mk.co.kr': site('매일경제', 'press'),
  'mt.co.kr': site('머니투데이', 'press'),
  'edaily.co.kr': site('이데일리', 'press'),
  'sedaily.com': site('서울경제', 'press'),
  'fnnews.com': site('파이낸셜뉴스', 'press'),
  'asiae.co.kr': site('아시아경제', 'press'),
  'heraldcorp.com': site('헤럴드경제', 'press'),
  'yna.co.kr': site('연합뉴스', 'press'),
  'einfomax.co.kr': site('연합인포맥스', 'press'),
  'newsis.com': site('뉴시스', 'press'),
  'news1.kr': site('뉴스1', 'press'),
  'newspim.com': site('뉴스핌', 'press'),
  'etnews.com': site('전자신문', 'press'),
  'zdnet.co.kr': site('지디넷코리아', 'press'),
  'dt.co.kr': site('디지털타임스', 'press'),
  'ajunews.com': site('아주경제', 'press'),
  'etoday.co.kr': site('이투데이', 'press'),
  'ebn.co.kr': site('EBN', 'press'),
  'fntimes.com': site('한국금융신문', 'press'),
  'joseilbo.com': site('조세일보', 'press'),
  'tf.co.kr': site('더팩트', 'press'),
  'megaeconomy.co.kr': site('메가경제', 'press'),
  'greenpostkorea.co.kr': site('그린포스트코리아', 'press'),
  'newsprime.co.kr': site('프라임경제', 'press'),
  'sisajournal-e.com': site('시사저널e', 'press'),
  'sisajournal.com': site('시사저널', 'press'),
  'businesspost.co.kr': site('비즈니스포스트', 'press'),
  'thebell.co.kr': site('더벨', 'press'),
  'bloter.net': site('블로터', 'press'),
  'moneys.co.kr': site('머니S', 'press'),
  'newneek.co': site('뉴닉', 'press'),
  'news.naver.com': site('네이버 뉴스', 'press'),
  'v.daum.net': site('다음 뉴스', 'press'),

  // 비교·핀테크
  'banksalad.com': site('뱅크샐러드', 'fintech'),
  'toss.im': site('토스', 'fintech'),
  'finda.co.kr': site('핀다', 'fintech'),
  'kakaopay.com': site('카카오페이', 'fintech'),
  'pay.naver.com': site('네이버페이', 'fintech'),

  // 블로그·커뮤니티
  'blog.naver.com': site('네이버 블로그', 'community'),
  'cafe.naver.com': site('네이버 카페', 'community'),
  'post.naver.com': site('네이버 포스트', 'community'),
  'tistory.com': site('티스토리', 'community'),
  'brunch.co.kr': site('브런치', 'community'),
  'velog.io': site('벨로그', 'community'),
  'medium.com': site('미디엄', 'community'),
  'youtube.com': site('유튜브', 'community'),
  'reddit.com': site('레딧', 'community'),
  'clien.net': site('클리앙', 'community'),
  'dcinside.com': site('디시인사이드', 'community'),

  // 백과·위키
  'namu.wiki': site('나무위키', 'wiki'),
  'wikipedia.org': site('위키백과', 'wiki'),
};

/** 서브도메인이 서비스 자체를 가르는 곳. 최상위 도메인으로 합치지 않습니다. */
const KEEP_HOSTS = [
  'blog.naver.com',
  'cafe.naver.com',
  'post.naver.com',
  'news.naver.com',
  'pay.naver.com',
  'v.daum.net',
];

/** co.kr처럼 두 칸이 한 덩어리인 접미사의 둘째 칸. */
const SECOND_LEVEL = new Set(['co', 'or', 'go', 'ne', 'ac', 're', 'pe', 'com', 'net', 'org']);

/** Gemini가 원래 주소 대신 주는 경유 링크의 호스트. 이때는 제목에 담긴 도메인을 씁니다. */
const REDIRECT_HOSTS = ['vertexaisearch.cloud.google.com'];

const looksLikeDomain = (value: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 호스트를 사이트 단위로 줄입니다. biz.hanabank.com → hanabank.com, m.blog.naver.com → blog.naver.com */
export function siteDomain(host: string): string {
  const kept = KEEP_HOSTS.find((keep) => host === keep || host.endsWith(`.${keep}`));
  if (kept) return kept;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const tld = labels.at(-1) ?? '';
  const second = labels.at(-2) ?? '';
  const size = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-size).join('.');
}

/** 인용 한 건이 가리키는 사이트 도메인. 알 수 없으면 빈 문자열. */
export function citationDomain(url: string, title: string | null): string {
  const host = hostOf(url);
  if (REDIRECT_HOSTS.includes(host)) {
    const hint = (title ?? '').trim().toLowerCase();
    return looksLikeDomain(hint) ? siteDomain(hint) : '';
  }
  return host ? siteDomain(host) : '';
}

export function classifySite(domain: string, ownDomains: string[] = []): SiteInfo {
  if (!domain) return site('주소를 알 수 없음', 'other');
  if (ownDomains.some((own) => domain === own || domain.endsWith(`.${own}`))) return site('DJ Bank', 'own');
  const known = SITES[domain];
  if (known) return known;

  // 표에 없는 도메인은 이름과 접미사로 유형만 추정하고, 소유자는 도메인 그대로 둡니다.
  const name = domain.split('.')[0] ?? '';
  if (/savingsbank|저축/.test(domain) || /sb$/.test(name)) return site(domain, 'savings');
  if (/bank/.test(name)) return site(domain, 'bank');
  if (/\.go\.kr$|\.or\.kr$|\.gov$/.test(domain)) return site(domain, 'public');
  if (/news|ilbo|daily|times|press|journal|economy|biz$/.test(name)) return site(domain, 'press');
  if (/blog|cafe|wiki/.test(name)) return site(domain, /wiki/.test(name) ? 'wiki' : 'community');
  return site(domain, 'other');
}
