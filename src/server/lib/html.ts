// 이메일·HTML 응답에 사용자 입력을 넣을 때 쓴다
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
