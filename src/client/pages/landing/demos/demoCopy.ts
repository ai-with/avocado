// 기능 데모 문구(guide, upload, transcript). 인물·브랜드는 실명 없이 쓴다
export const INFLUENCERS = ["인플루언서 A", "인플루언서 B", "인플루언서 C"];
export const REEL_SRC = "/videos/hero-reel";

export const DEMO_COPY = {
  guide: {
    label: "가이드 만들기",
    url: "https://brand.example/products/glow-serum",
    fetch: "가져오기",
    draft: "초안 만들기",
    fields: [
      { label: "제품 이름", value: "Glow Serum 30ml" },
      { label: "핵심 효능", value: "광채, 보습" },
      { label: "사용감", value: "가볍게 스며드는 제형" },
    ],
    scenes: [
      { time: "0~3초", title: "훅", line: "Okay, this serum made my skin glow." },
      { time: "3~8초", title: "사용 장면", line: "Just one drop is enough." },
      { time: "8~12초", title: "결과", line: "Look how fresh it feels." },
      { time: "12~15초", title: "마무리", line: "Link in my bio, #ad" },
    ],
    linksTitle: "인플루언서별 링크",
    opened: "열람함",
  },
  upload: {
    label: "업로드 받기",
    phoneTitle: "Glow Serum 캠페인",
    join: "참여하기",
    consent: "처리 방식과 2차 활용 범위에 동의합니다",
    pick: "영상 선택",
    file: "glow-serum-final.mp4",
    uploading: "업로드 중",
    uploaded: "업로드 완료",
    inboxTitle: "받은 영상",
    previewHint: "행을 누르면 미리보기가 열립니다",
    noVideo: "아직 올라온 영상이 없습니다",
    status: { uploading: "업로드 중", processing: "처리 중", review: "검수 대기", waiting: "업로드 전" },
  },
  transcript: {
    label: "자막·번역",
    showKo: "한국어 보기",
    hideKo: "영어만 보기",
    lines: [
      { at: 0.3, en: "Okay, this serum", ko: "자, 이 세럼" },
      { at: 1.2, en: "made my skin glow", ko: "피부가 빛나게 해 줬어요" },
      { at: 2.0, en: "in just a week.", ko: "단 일주일 만에요." },
      { at: 3.5, en: "Just one drop is enough.", ko: "한 방울이면 충분해요." },
      { at: 5.5, en: "It sinks in so fast.", ko: "정말 빨리 스며들어요." },
    ],
  },
};
