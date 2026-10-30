import "./Feedback.css";

type Props = { name: string; src?: string; size?: "sm" | "md" | "lg" };

const initial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "";

// 사람·워크스페이스 첫 글자 원(사진이 있으면 사진). 장식이라 화면 낭독기는 건너뛴다. 옆에 이름 글자를 꼭 같이 둔다
export function Avatar({ name, src, size = "md" }: Props) {
  return (
    <span className={`avatar-ui avatar-ui-${size}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initial(name)}
    </span>
  );
}
