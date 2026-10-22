import { escapeHtml } from "./html";

// 인플루언서에게 가는 메일 문구. 인플루언서 언어가 en 이면 영어, 아니면 한국어
type Mail = { subject: string; text: string; html: string };
type Who = { brand: string; name: string; en: boolean; url: string };

export function guideInviteMail({ brand, name, en, url }: Who): Mail {
  return {
    subject: en ? `[${brand}] Video guide for you` : `[${brand}] 영상 가이드가 도착했어요`,
    text: en ? `Hi ${name},\nHere is your video guide from ${brand}.\n${url}` : `${name}님, ${brand}의 영상 가이드입니다.\n${url}`,
    html: en
      ? `<p>Hi ${escapeHtml(name)},</p><p>Here is your video guide from <b>${escapeHtml(brand)}</b>.</p><p><a href="${url}">Open the guide</a></p>`
      : `<p>${escapeHtml(name)}님, <b>${escapeHtml(brand)}</b>의 영상 가이드입니다.</p><p><a href="${url}">가이드 열기</a></p>`,
  };
}

export function feedbackRoundMail({ brand, name, en, url }: Who, guideName: string, count: number): Mail {
  return {
    subject: en ? `[${brand}] Feedback on your video (${count})` : `[${brand}] 영상 피드백 ${count}건이 도착했어요`,
    text: en ? `Hi ${name},\n${brand} left ${count} comments on "${guideName}".\n${url}` : `${name}님, ${brand}에서 "${guideName}" 영상에 코멘트 ${count}건을 남겼어요.\n${url}`,
    html: en
      ? `<p>Hi ${escapeHtml(name)},</p><p><b>${escapeHtml(brand)}</b> left ${count} comments on your video.</p><p><a href="${url}">See feedback</a></p>`
      : `<p>${escapeHtml(name)}님, <b>${escapeHtml(brand)}</b>에서 코멘트 ${count}건을 남겼어요.</p><p><a href="${url}">피드백 보기</a></p>`,
  };
}

export function approvedMail({ brand, en, url }: Who, guideName: string): Mail {
  return {
    subject: en ? `[${brand}] Your video is approved` : `[${brand}] 영상이 최종 승인됐어요`,
    text: en ? `Your video for "${guideName}" is approved. After you post it, paste the post URL here: ${url}` : `"${guideName}" 영상이 최종 승인됐어요. 게시한 뒤 게시물 주소를 여기에 붙여 넣어 주세요: ${url}`,
    html: en
      ? `<p>Your video for "${escapeHtml(guideName)}" is approved.</p><p>After you post it, <a href="${url}">paste the post URL here</a>.</p>`
      : `<p>"${escapeHtml(guideName)}" 영상이 최종 승인됐어요.</p><p>게시한 뒤 <a href="${url}">여기에 게시물 주소를 붙여 넣어 주세요</a>.</p>`,
  };
}
