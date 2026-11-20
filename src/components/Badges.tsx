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
      aria-label={`AI 서비스 ${total}곳 중 ${hit}곳이 DJ Bank를 언급`}
      title="DJ Bank를 말한 AI 서비스 수"
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
