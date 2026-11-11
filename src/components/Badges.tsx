import { ENGINES } from '../lib/selectors';

export function Badge({ children, variant }: { children: string; variant?: 'accent' }) {
  return <span className={`badge${variant ? ` badge--${variant}` : ''}`}>{children}</span>;
}

export function EnginePips({ hit }: { hit: number }) {
  const total = ENGINES.length;
  return (
    <span
      className="pips"
      role="img"
      aria-label={`엔진 ${total}종 중 ${hit}종이 DJ Bank를 언급`}
      title="DJ Bank를 언급한 엔진 수"
    >
      {ENGINES.map((engine, index) => (
        <span key={engine} className={`pip${index < hit ? ' pip--on' : ''}`} />
      ))}
      <span className="pips-count">
        {hit}/{total}
      </span>
    </span>
  );
}
