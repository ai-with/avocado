// 테스트 페이지 동작. 브랜드 사이트가 하는 호출을 흉내 낸다
const avocado = (...args) => window.avocado(...args);

document.getElementById("buy").addEventListener("click", () => {
  avocado("conversion", { type: "purchase", value: 39000, currency: "KRW", orderId: `T-${Date.now()}` });
});
document.getElementById("signup").addEventListener("click", () => avocado("identify", { email: "tester@example.com" }));
document.getElementById("optin").addEventListener("click", () => avocado("consent", "granted"));
document.getElementById("optout").addEventListener("click", () => avocado("optOut"));
document.getElementById("lead-form").addEventListener("submit", (event) => event.preventDefault());

for (const link of document.querySelectorAll("[data-route]")) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    history.pushState(null, "", link.getAttribute("href"));
  });
}
avocado("track", "test_page_loaded", { from: "stub" });
