const MAX_SELECTOR_DEPTH = 5;
const MAX_CLASSES_PER_LEVEL = 2;
// 해시 클래스(css-1x2y3z 등)도 그대로 남지만, 공백·특수문자가 있는 클래스는 선택자를 깨뜨리므로 뺀다
const SAFE_CLASS = /^[A-Za-z_][\w-]*$/;
const EXCLUDED = ".avc-no-capture, [data-avc-no-capture]";
const SENSITIVE = "input[type=password], [autocomplete^=cc-]";

/** 제외 클래스 하위이거나 비밀번호·카드 필드면 수집하지 않는다 (docs/14 3-1 제외 규칙) */
export function isExcluded(element: Element): boolean {
  return element.closest(EXCLUDED) !== null || element.matches(SENSITIVE);
}

function levelSelector(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const classes = [...element.classList].filter((name) => SAFE_CLASS.test(name)).slice(0, MAX_CLASSES_PER_LEVEL);
  return [element.localName, ...classes].join(".");
}

/** 최대 5단계 선택자. id를 만나면 거기서 멈춘다 */
export function cssPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement && parts.length < MAX_SELECTOR_DEPTH) {
    const part = levelSelector(current);
    parts.unshift(part);
    if (part.startsWith("#") || current === document.body) break;
    current = current.parentElement;
  }
  return parts.join(" > ");
}
