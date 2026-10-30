// 화장품 광고 법규 기본 금지어 (TASK-079). DB 행이 아니라 코드 상수다. 브랜드별로 끄기만 한다
// 근거: 화장품법 제13조(부당한 표시·광고 행위 등의 금지), 같은 법 시행규칙 제22조 별표 5, 식약처 「화장품 표시·광고 관리 지침」
// 아래 공개 자료에서 금지·부적절 예시로 직접 확인한 표현만 넣었다. 법률 자문 전 초안이라 최종 판단은 사람이 한다
//   S1 정책브리핑(2011.06.24) 화장품 표시·광고 관리 가이드라인 제정: https://www.korea.kr/news/policyNewsView.do?newsId=148714097
//   S2 CNC뉴스(2020.12.27) 식약처 화장품 자주하는 질문집: https://www.cncnews.co.kr/news/article.html?no=5739
//   S3 코스모닝(2025.01.21) 화장품 표시·광고 관리 지침 개정: https://www.cosmorning.com/mobile/article.html?no=49744
//   S4 코스인코리아(2026.01.16) 광고업무정지 행정처분: https://www.cosinkorea.com/mobile/article.html?no=56638
//   S5 CNC뉴스(2025.08.06) 부당광고 83건 처분 예고: https://www.cncnews.co.kr/news/article.html?no=10295
//   S6 코스모닝(2017.06.22) 적발 광고 문구 취재: https://cosmorning.com/news/article_print.html?no=15823

export const LEGAL_CATEGORIES = ["disease", "medical", "drug", "functional", "absolute", "misleading"] as const;
export type LegalCategory = (typeof LEGAL_CATEGORIES)[number];

export const LEGAL_CATEGORY_LABELS: Record<LegalCategory, string> = {
  disease: "질병명",
  medical: "의학적 효능",
  drug: "의약품 오인",
  functional: "기능성화장품 오인",
  absolute: "절대·최상급 표현",
  misleading: "사실 오인·과장",
};

export type LegalTerm = { id: string; term: string; variants: string[]; category: LegalCategory; suggestion: string | null; basis: string };

const LAW_DRUG = "화장품법 제13조 제1항 제1호 (의약품 오인)";
const LAW_FUNCTIONAL = "화장품법 제13조 제1항 제2호 (기능성화장품 오인, 기능성 심사·보고 제품은 예외)";
const LAW_MISLEAD = "화장품법 제13조 제1항 제4호 (소비자 오인)";

type Row = [id: string, term: string, variants: string[], category: LegalCategory, suggestion: string | null, law: string, source: string];

const ROWS: Row[] = [
  ["atopy", "아토피", ["atopic"], "disease", "건조한 피부에", LAW_DRUG, "S1, S2"],
  ["acne_cure", "여드름 치료", ["여드름치료", "여드름 없애"], "disease", "여드름성 피부에 사용 적합(입증 자료가 있을 때)", LAW_DRUG, "S1"],
  ["psoriasis", "건선", ["psoriasis"], "disease", null, LAW_DRUG, "S1, S2"],
  ["demodex", "모낭충", [], "disease", null, LAW_DRUG, "S2"],
  ["senile_pruritus", "노인소양증", [], "disease", null, LAW_DRUG, "S2"],
  ["diaper_rash", "기저귀 발진", [], "disease", null, LAW_DRUG, "S2"],
  ["anti_inflammatory", "항염", ["anti-inflammatory", "염증 완화", "염증완화"], "medical", "피부를 진정시켜 주는", LAW_DRUG, "S2, S5"],
  ["analgesic", "진통", ["통증 경감", "통증 완화"], "medical", null, LAW_DRUG, "S2"],
  ["sterilize", "살균", ["소독"], "medical", "깨끗하게 씻어 주는", LAW_DRUG, "S2"],
  ["detox", "해독", ["디톡스"], "medical", null, LAW_DRUG, "S2"],
  ["diuretic", "이뇨", [], "medical", null, LAW_DRUG, "S2"],
  ["anticancer", "항암", [], "medical", null, LAW_DRUG, "S2"],
  ["antifungal", "항진균", [], "medical", null, LAW_DRUG, "S2"],
  ["antiviral", "항바이러스", [], "medical", null, LAW_DRUG, "S2"],
  ["muscle_relax", "근육 이완", [], "medical", null, LAW_DRUG, "S2"],
  ["immunity", "면역 강화", ["면역력 강화"], "medical", null, LAW_DRUG, "S2"],
  ["anti_allergy", "항알레르기", [], "medical", null, LAW_DRUG, "S2"],
  ["burn_cure", "화상 치료", ["화상 회복"], "medical", null, LAW_DRUG, "S2"],
  ["fatigue", "피로회복", ["피로 회복", "심신피로 회복"], "medical", null, LAW_DRUG, "S2, S4"],
  ["joint", "관절", [], "medical", null, LAW_DRUG, "S2, S4"],
  ["skin_regen", "피부재생", ["피부 재생", "세포 재생"], "medical", "피부를 매끄럽게 가꿔 주는", LAW_DRUG, "S5"],
  ["self_heal", "피부 자생", [], "medical", null, LAW_DRUG, "S6"],
  ["circulation", "혈액순환", ["혈액 순환", "신진대사"], "medical", null, LAW_DRUG, "S6"],
  ["swelling", "붓기완화", ["붓기 완화", "붓기진정"], "medical", null, LAW_DRUG, "S6"],
  ["med", "메드", [], "drug", null, LAW_DRUG, "S2"],
  ["disinfectant", "소독제", [], "drug", null, LAW_DRUG, "S2"],
  ["hospital_use", "병원용", ["피부과 추천", "의사 추천"], "drug", null, LAW_DRUG, "S3"],
  ["doctor_made", "의사가 개발", [], "drug", null, LAW_DRUG, "S6"],
  ["needle", "마이크로니들", ["니들", "바늘"], "misleading", null, LAW_MISLEAD, "S2, S3"],
  ["whitening", "미백", ["화이트닝", "whitening"], "functional", "맑고 환한 피부 표현(메이크업 효과)", LAW_FUNCTIONAL, "S6"],
  ["wrinkle", "주름개선", ["주름 개선", "주름 완화"], "functional", null, LAW_FUNCTIONAL, "S6"],
  ["uv_block", "자외선 차단", ["자외선차단"], "functional", null, LAW_FUNCTIONAL, "S6"],
  ["best", "최고", [], "absolute", null, LAW_MISLEAD, "S2"],
  ["supreme", "최상", [], "absolute", null, LAW_MISLEAD, "S2"],
  ["optimal", "최적", [], "absolute", null, LAW_MISLEAD, "S2"],
  ["industry_first", "업계 최초", ["동종 업계 최초"], "absolute", null, LAW_MISLEAD, "S6"],
  ["no_side_effect", "부작용 전혀 없", ["부작용 없음", "부작용 제로"], "misleading", "자극을 줄인", LAW_MISLEAD, "S1"],
  ["edible", "먹을 수 있", [], "misleading", null, LAW_MISLEAD, "S1"],
  ["cellulite", "셀룰라이트", [], "misleading", null, LAW_MISLEAD, "S1"],
  ["bust", "가슴 확대", [], "misleading", null, LAW_MISLEAD, "S1"],
  ["hair_growth", "발모", ["양모"], "misleading", null, LAW_MISLEAD, "S1"],
  ["hair_loss", "탈모 방지", [], "misleading", null, LAW_MISLEAD, "S1"],
  ["diet", "다이어트 효과", [], "misleading", null, LAW_MISLEAD, "S1"],
  ["skin_age", "피부 나이", ["피부나이"], "misleading", null, LAW_MISLEAD, "S3"],
  ["exosome", "엑소좀", ["exosome"], "misleading", null, LAW_MISLEAD, "S3"],
  ["fine_dust", "미세먼지 철벽", ["미세먼지 차단"], "misleading", null, LAW_MISLEAD, "S6"],
];

export const COSMETIC_AD_TERMS: LegalTerm[] = ROWS.map(([id, term, variants, category, suggestion, law, source]) => ({ id, term, variants, category, suggestion, basis: `${law}. 출처 ${source}` }));

export const LEGAL_SOURCES: { id: string; label: string; url: string }[] = [
  { id: "S1", label: "정책브리핑 2011.06.24, 화장품 표시·광고 관리 가이드라인 제정", url: "https://www.korea.kr/news/policyNewsView.do?newsId=148714097" },
  { id: "S2", label: "CNC뉴스 2020.12.27, 식약처 화장품 자주하는 질문집", url: "https://www.cncnews.co.kr/news/article.html?no=5739" },
  { id: "S3", label: "코스모닝 2025.01.21, 화장품 표시·광고 관리 지침 개정", url: "https://www.cosmorning.com/mobile/article.html?no=49744" },
  { id: "S4", label: "코스인코리아 2026.01.16, 광고업무정지 행정처분", url: "https://www.cosinkorea.com/mobile/article.html?no=56638" },
  { id: "S5", label: "CNC뉴스 2025.08.06, 부당광고 83건 처분 예고", url: "https://www.cncnews.co.kr/news/article.html?no=10295" },
  { id: "S6", label: "코스모닝 2017.06.22, 적발 광고 문구 취재", url: "https://cosmorning.com/news/article_print.html?no=15823" },
];
