import { Actions } from "./sections/Actions";
import { Controls } from "./sections/Controls";
import { Display } from "./sections/Display";
import { Feedback } from "./sections/Feedback";
import { Forms } from "./sections/Forms";
import { Inputs } from "./sections/Inputs";
import { Navigation } from "./sections/Navigation";
import { Overlays } from "./sections/Overlays";
import { SelectMenus } from "./sections/SelectMenus";
import { Tokens } from "./sections/Tokens";
import "./dev-ui.css";

// 개발 서버에서만 열리는 디자인 토큰·공통 컴포넌트 카탈로그 (routes.tsx 가 개발 모드일 때만 등록)
export function DevUiPage() {
  return (
    <main className="dev-ui" id="top">
      <header className="dev-ui-head">
        <h1>avocado UI 카탈로그</h1>
        <p className="text-secondary">개발 전용. 토큰 값은 브라우저가 계산한 결과를 읽어 보여 준다.</p>
      </header>
      <h2 className="dev-part">토큰</h2>
      <Tokens />
      <h2 className="dev-part">공통 컴포넌트</h2>
      <Actions />
      <Forms />
      <Inputs />
      <SelectMenus />
      <Controls />
      <Display />
      <Feedback />
      <Navigation />
      <Overlays />
    </main>
  );
}
