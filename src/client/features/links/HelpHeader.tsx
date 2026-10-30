import { IconButton, Tooltip } from "../../ui";
import "./lead-tools.css";

// 표 머리글 + 물음표 설명. 표는 가로 스크롤 안이라 위로 띄우면 잘려서 아래로 띄운다
export function HelpHeader({ label, help }: { label: string; help: string }) {
  return (
    <span className="help-header">
      {label}
      <Tooltip content={help} placement="bottom"><IconButton icon="circle-help" label={`${label} 설명`} size="sm" /></Tooltip>
    </span>
  );
}
