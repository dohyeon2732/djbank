export const NO_VALUE = '—';

type Maybe = number | null | undefined;

export const pct = (value: Maybe): string =>
  value == null ? NO_VALUE : `${(value * 100).toFixed(1)}%`;

export const num = (value: Maybe): string =>
  value == null ? NO_VALUE : value.toLocaleString('en-US');

export const fixed2 = (value: Maybe): string => (value == null ? NO_VALUE : value.toFixed(2));

/** 두 비율의 차이를 %p로 표시합니다. */
export function pointGap(a: number, b: number): string {
  const diff = (a - b) * 100;
  return `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)}%p`;
}
