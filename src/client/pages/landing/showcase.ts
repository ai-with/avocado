// "이렇게 씁니다" 섹션의 소개 영상. 파일은 public/videos/<file>.{webm,mp4,jpg}
// (영상 원본 장면: .agent_work/scratch/038/scenes, 렌더: render.mjs)
export type ShowcaseVideo = { file: string; title: string; desc: string };

export const SHOWCASE = {
  id: "showcase",
  title: "이렇게 써요",
  videos: [
    { file: "guide", title: "가이드는 링크 하나로", desc: "인플루언서는 휴대폰에서 가이드를 열고 바로 참여해요." },
    { file: "review", title: "고칠 장면만 보면 돼요", desc: "규정을 어긴 듯한 장면과 지킨 장면을 시간 순서로 짚어 줘요." },
    { file: "feedback", title: "장면 위에 바로 써요", desc: "프레임에 표시하고 코멘트를 달아 그대로 보내요." },
  ] satisfies ShowcaseVideo[],
};
