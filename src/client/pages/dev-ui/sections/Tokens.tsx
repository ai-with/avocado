import { useMemo } from "react";
import { readRootTokens, type TokenEntry } from "../tokenProbe";
import { Group } from "../Showcase";

function useTokens(prefix: string): TokenEntry[] {
  return useMemo(() => readRootTokens(prefix), [prefix]);
}

function TokenLabel({ name, value }: TokenEntry) {
  return (
    <div className="dev-token-label">
      <code>{name}</code>
      <span className="text-caption">{value}</span>
    </div>
  );
}

function ColorTokens() {
  return (
    <Group title="색" note="의미 토큰(--color-*). 값은 브라우저가 계산한 결과">
      {useTokens("--color-").map((t) => (
        <div key={t.name} className="dev-token">
          <span className="dev-swatch" style={{ background: `var(${t.name})` }} />
          <TokenLabel {...t} />
        </div>
      ))}
    </Group>
  );
}

function TypeTokens() {
  const all = useTokens("--text-");
  const lineHeights = new Map(all.map((t) => [t.name, t.value]));
  return (
    <Group title="글자 단계" note="크기 / 줄 높이. 화면 폭에 따라 값이 바뀌는 단계가 있다">
      {all.filter((t) => t.name.endsWith("-size")).map((t) => {
        const lh = t.name.replace(/-size$/, "-lh");
        return (
          <div key={t.name} className="dev-token dev-token-wide">
            <span className="dev-type-sample" style={{ fontSize: `var(${t.name})`, lineHeight: `var(${lh})` }}>
              가나다 Aa 글자 단계
            </span>
            <TokenLabel name={t.name} value={`${t.value} / ${lineHeights.get(lh) ?? "-"}`} />
          </div>
        );
      })}
    </Group>
  );
}

function SpaceTokens() {
  return (
    <Group title="간격 단계" note="막대 길이가 --space-* 값">
      {useTokens("--space-").map((t) => (
        <div key={t.name} className="dev-token dev-token-wide">
          <span className="dev-space-bar" style={{ width: `var(${t.name})` }} />
          <TokenLabel {...t} />
        </div>
      ))}
    </Group>
  );
}

function ShapeTokens() {
  const shadows = useTokens("--shadow-").filter((t) => t.value.includes("px"));
  return (
    <>
      <Group title="모서리">
        {useTokens("--radius-").map((t) => (
          <div key={t.name} className="dev-token">
            <span className="dev-shape" style={{ borderRadius: `var(${t.name})` }} />
            <TokenLabel {...t} />
          </div>
        ))}
      </Group>
      <Group title="그림자">
        {shadows.map((t) => (
          <div key={t.name} className="dev-token">
            <span className="dev-shape" style={{ boxShadow: `var(${t.name})` }} />
            <TokenLabel {...t} />
          </div>
        ))}
      </Group>
    </>
  );
}

export function Tokens() {
  return (
    <>
      <ColorTokens />
      <TypeTokens />
      <SpaceTokens />
      <ShapeTokens />
    </>
  );
}
