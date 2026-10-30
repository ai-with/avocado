import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { Icon, type IconName } from "./icons";
import "./Button.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "xl";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

// size: sm(표·줄 안) md(기본) lg·xl(공개 화면 휴대폰 주 동작, TDS large·xlarge)
// loading: 누를 수 없고(aria-busy), 글자 자리에 TDS처럼 점 3개가 차례로 깜빡인다. 글자는 숨기기만 해서 버튼 폭이 변하지 않는다
export function Button({ variant = "primary", size = "md", className = "", type = "button", loading, disabled, children, ...rest }: Props) {
  const cls = `btn btn-${variant} btn-${size} ${loading ? "btn-loading" : ""} ${className}`;
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <><span className="btn-label">{children}</span><span className="btn-dots" aria-hidden="true"><span /><span /><span /></span></> : children}
    </button>
  );
}

type IconButtonProps = Omit<Props, "children" | "aria-label"> & { icon: IconName; label: string };

// 아이콘만 보이는 버튼. 화면 낭독기용 이름(label)을 빠뜨릴 수 없게 필수로 받는다
export function IconButton({ icon, label, variant = "ghost", className = "", ...rest }: IconButtonProps) {
  return (
    <Button variant={variant} className={`btn-icon ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </Button>
  );
}

type Look = { variant?: Variant; size?: Size };

// 버튼 모양의 앱 안 이동 링크
export function ButtonLink({ variant = "secondary", size = "md", className = "", ...rest }: LinkProps & Look) {
  return <Link className={`btn btn-${variant} btn-${size} ${className}`} {...rest} />;
}

// 버튼 모양의 외부 주소·내려받기 링크
export function ButtonAnchor({ variant = "secondary", size = "md", className = "", ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & Look) {
  return <a className={`btn btn-${variant} btn-${size} ${className}`} {...rest} />;
}
