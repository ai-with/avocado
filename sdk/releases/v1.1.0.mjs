// src/config.ts
var e = [
	2e3,
	8e3,
	3e4
], t = 864e5, n = [
	25,
	50,
	75,
	100
], r = "avc_attr", i = "avc_q", a = "avc_id", o = "avc_off", s = "avc_member", c = [
	"granted",
	"denied",
	"pending",
	"require"
];
function l(e) {
	return e && c.includes(e) ? e : null;
}
function u(e) {
	if (e == null) return [...n];
	let t = typeof e == "string" ? e.split(",").map(Number) : e;
	return n.filter((e) => t.includes(e));
}
function d(e) {
	try {
		return e != null && e.src ? new URL(e.src).origin : location.origin;
	} catch {
		return location.origin;
	}
}
function f(e) {
	var t, n, r, i;
	let a = (t = e == null ? void 0 : e.dataset) == null ? {} : t, o = Number(a.attributionDays);
	return {
		site: (n = a.site) == null ? "" : n,
		api: ((r = a.api) == null ? d(e) : r).replace(/\/+$/, ""),
		autocapture: a.autocapture !== "false",
		consent: l(a.consent),
		consentMode: a.consent === "require" ? "require" : "auto",
		scrollThresholds: u(a.scroll),
		sampleRate: 1,
		cookieDomain: (i = a.cookieDomain) == null ? null : i,
		hashEmail: a.hashEmail !== "false",
		attributionDays: o >= 1 && o <= 90 ? o : 30
	};
}
function p(e, t) {
	var n, r;
	let i = { ...e };
	for (let e of [
		"autocapture",
		"cookieDomain",
		"hashEmail",
		"attributionDays"
	]) t[e] !== void 0 && Object.assign(i, { [e]: t[e] });
	let a = l(t.consent);
	return a && (i.consent = a), a === "require" && (i.consentMode = "require"), i.scrollThresholds = u((n = t.scrollThresholds) == null ? e.scrollThresholds : n), i.sampleRate = Math.min(1, Math.max(0, Number((r = t.sampleRate) == null ? e.sampleRate : r))), i;
}
function m(e) {
	let t = e.currentScript;
	return t instanceof HTMLScriptElement && t.dataset.site ? t : e.querySelector("script[data-site]");
}
// src/attribution.ts
var h = 864e5, ee = "avc_optout", te = [
	"source",
	"medium",
	"campaign",
	"content",
	"term"
], ne = /^[A-Za-z0-9_-]{1,40}$/;
function re(e, t) {
	try {
		let n = new URL(e).hostname;
		return n && n !== t ? n : null;
	} catch {
		return null;
	}
}
function ie(e, t, n) {
	let r = e.searchParams.get("avc"), i = r && ne.test(r) ? r : null, a = {};
	for (let t of te) {
		let n = e.searchParams.get(`utm_${t}`);
		n && (a[t] = n);
	}
	return !i && Object.keys(a).length === 0 ? null : {
		clickId: i,
		utm: a,
		referrerHost: re(t, e.hostname),
		landingPath: e.pathname,
		at: n
	};
}
function g(e, t, n, r) {
	var i;
	let a = e && e.expiresAt > n ? e : null;
	return t ? {
		first: (i = a == null ? void 0 : a.first) == null ? t : i,
		last: t,
		expiresAt: n + r * h
	} : a;
}
function _(e, t) {
	let n = e.getJson(r);
	return n && n.expiresAt > t ? n : (n && e.remove(r), null);
}
function ae(e, t, n, i) {
	let a = g(_(e, n), t, n, i);
	return a && t && e.setJson(r, a), a;
}
function oe(e) {
	let t = new URL(e);
	return !t.searchParams.has("avc") && !t.searchParams.has("avc_optout") ? null : (t.searchParams.delete("avc"), t.searchParams.delete(ee), t.toString());
}
function v(e) {
	let t = new URL(e), n = new URLSearchParams();
	t.searchParams.forEach((e, t) => {
		(t === "avc" || t.startsWith("utm_")) && n.append(t, e);
	});
	let r = n.toString();
	return `${t.origin}${t.pathname}${r ? `?${r}` : ""}`;
}
// src/capture/dom.ts
var se = 5, ce = 2, le = /^[A-Za-z_][\w-]*$/, ue = ".avc-no-capture, [data-avc-no-capture]", de = "input[type=password], [autocomplete^=cc-]";
function y(e) {
	return e.closest(ue) !== null || e.matches(de);
}
function fe(e) {
	if (e.id) return `#${CSS.escape(e.id)}`;
	let t = [...e.classList].filter((e) => le.test(e)).slice(0, ce);
	return [e.localName, ...t].join(".");
}
function b(e) {
	let t = [], n = e;
	for (; n && n !== document.documentElement && t.length < se;) {
		let e = fe(n);
		if (t.unshift(e), e.startsWith("#") || n === document.body) break;
		n = n.parentElement;
	}
	return t.join(" > ");
}
// src/capture/click.ts
var pe = "a, button, [role=button], input[type=submit], [data-avc-track]", me = 80, he = 768, ge = 1024, _e = 1e3, ve = 30, ye = 3;
function x(e) {
	return (e == null ? "" : e).replace(/\s+/g, " ").trim().slice(0, me);
}
function S(e, t) {
	return t <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, e / t)) * 1e3) / 1e3;
}
function be(e) {
	return e < he ? "m" : e < ge ? "t" : "d";
}
function C(e) {
	if (!(e instanceof HTMLAnchorElement) || !e.href) return null;
	try {
		let t = new URL(e.href);
		return `${t.origin}${t.pathname}`;
	} catch {
		return null;
	}
}
function w(e) {
	return e instanceof HTMLInputElement ? x(e.value) : x(e.textContent || e.getAttribute("aria-label"));
}
function T() {
	let e = [];
	return (t) => (e = e.filter((e) => t.at - e.at <= _e && Math.hypot(t.x - e.x, t.y - e.y) <= ve), e.push(t), e.length >= ye);
}
function E({ autocapture: e, emit: t }) {
	let n = T(), r = (r) => {
		let i = r.target instanceof Element ? r.target.closest(pe) : null;
		if (!i || y(i)) return;
		let a = i.getAttribute("data-avc-track");
		if (a && t({
			t: "track",
			name: a,
			props: {}
		}), !e) return;
		let o = document.documentElement, s = n({
			x: r.pageX,
			y: r.pageY,
			at: Date.now()
		});
		t({
			t: "click",
			sel: b(i),
			text: w(i),
			href: C(i),
			x: S(r.pageX, o.scrollWidth),
			y: S(r.pageY, o.scrollHeight),
			vw: be(window.innerWidth),
			...s ? { rage: !0 } : {}
		});
	};
	return document.addEventListener("click", r, {
		capture: !0,
		passive: !0
	}), () => document.removeEventListener("click", r, { capture: !0 });
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/typeof.js
function D(e) {
	"@babel/helpers - typeof";
	return D = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
		return typeof e;
	} : function(e) {
		return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
	}, D(e);
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/toPrimitive.js
function O(e, t) {
	if (D(e) != "object" || !e) return e;
	var n = e[Symbol.toPrimitive];
	if (n !== void 0) {
		var r = n.call(e, t || "default");
		if (D(r) != "object") return r;
		throw TypeError("@@toPrimitive must return a primitive value.");
	}
	return (t === "string" ? String : Number)(e);
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/toPropertyKey.js
function k(e) {
	var t = O(e, "string");
	return D(t) == "symbol" ? t : t + "";
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/defineProperty.js
function A(e, t, n) {
	return (t = k(t)) in e ? Object.defineProperty(e, t, {
		value: n,
		enumerable: !0,
		configurable: !0,
		writable: !0
	}) : e[t] = n, e;
}
// src/capture/dwell.ts
var j = class {
	constructor(e, t) {
		A(this, "visibleMs", 0), A(this, "visibleSince", void 0), this.visibleSince = t ? e : null;
	}
	onVisibilityChange(e, t) {
		t ? this.visibleSince != null || (this.visibleSince = e) : (this.visibleSince !== null && (this.visibleMs += e - this.visibleSince), this.visibleSince = null);
	}
	take(e) {
		let t = this.visibleMs + (this.visibleSince === null ? 0 : e - this.visibleSince);
		return this.visibleMs = 0, this.visibleSince !== null && (this.visibleSince = e), t;
	}
}, M = [
	"hidden",
	"submit",
	"button",
	"reset",
	"image"
];
function N(e) {
	return [...e.elements].filter((e) => e instanceof HTMLInputElement ? !M.includes(e.type) : e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement).length;
}
function xe(e) {
	let t = (t) => {
		let n = t.target;
		n instanceof HTMLFormElement && !y(n) && e({
			t: "form_submit",
			sel: b(n),
			fields: N(n)
		});
	};
	return document.addEventListener("submit", t, {
		capture: !0,
		passive: !0
	}), () => document.removeEventListener("submit", t, { capture: !0 });
}
// src/capture/pageview.ts
function Se(e) {
	let t = v(location.href), n = () => {
		let n = v(location.href);
		n !== t && (t = n, e());
	}, r = {
		pushState: history.pushState,
		replaceState: history.replaceState
	}, i = (e) => {
		let t = r[e];
		history[e] = function(...e) {
			t.apply(this, e), n();
		};
	};
	return i("pushState"), i("replaceState"), window.addEventListener("popstate", n), () => {
		history.pushState = r.pushState, history.replaceState = r.replaceState, window.removeEventListener("popstate", n);
	};
}
// src/capture/scroll.ts
var Ce = 200;
function we() {
	var e, t;
	let n = document.documentElement, r = Math.max(n.scrollHeight, (e = (t = document.body) == null ? void 0 : t.scrollHeight) == null ? 0 : e);
	return r <= 0 ? 100 : Math.min(100, (window.scrollY + window.innerHeight) / r * 100);
}
function Te(e, t) {
	let n = /* @__PURE__ */ new Set(), r, i = () => {
		let r = we();
		for (let i of e) r < i || n.has(i) || (n.add(i), t({
			t: "scroll",
			depth: i
		}));
	}, a = () => {
		r != null || (r = setTimeout(() => {
			r = void 0, i();
		}, Ce));
	};
	return window.addEventListener("scroll", a, { passive: !0 }), {
		reset: () => n.clear(),
		check: i,
		schedule: a,
		uninstall: () => {
			clearTimeout(r), window.removeEventListener("scroll", a);
		}
	};
}
// src/commands.ts
var P = 64, Ee = 20, De = 200, F = 100, Oe = [
	"purchase",
	"signup",
	"apply",
	"custom"
], ke = /^[A-Za-z]{3}$/;
function Ae(e) {
	return typeof e == "string" || typeof e == "boolean" || typeof e == "number" && Number.isFinite(e);
}
function je(e) {
	let t = {};
	if (!e || typeof e != "object") return t;
	let n = 0;
	for (let [r, i] of Object.entries(e)) {
		if (n >= Ee) break;
		Ae(i) && (t[r.slice(0, P)] = typeof i == "string" ? i.slice(0, De) : i, n++);
	}
	return t;
}
function Me(e, t) {
	return typeof e != "string" || !e.trim() ? null : {
		t: "track",
		name: e.trim().slice(0, P),
		props: je(t)
	};
}
function Ne(e) {
	var t;
	let n = e == null ? {} : e, r = {
		t: "conversion",
		kind: (t = Oe.find((e) => e === n.type)) == null ? "custom" : t
	};
	return typeof n.name == "string" && (r.name = n.name.slice(0, P)), typeof n.value == "number" && Number.isFinite(n.value) && (r.value = n.value), typeof n.currency == "string" && ke.test(n.currency) && (r.currency = n.currency.toUpperCase()), n.orderId != null && n.orderId !== "" && (r.orderId = String(n.orderId).slice(0, F)), r;
}
var Pe = new TextEncoder();
async function Fe(e) {
	var t;
	if (!((t = globalThis.crypto) != null && t.subtle)) return null;
	let n = await crypto.subtle.digest("SHA-256", Pe.encode(e.trim().toLowerCase()));
	return [...new Uint8Array(n)].map((e) => e.toString(16).padStart(2, "0")).join("");
}
async function Ie(e, t) {
	let n = e == null ? {} : e, r = { t: "identify" };
	if (typeof n.email == "string" && n.email.includes("@")) {
		let e = t ? await Fe(n.email) : null;
		e ? r.emailHash = e : t || (r.email = n.email.trim());
	}
	return typeof n.externalId == "string" && n.externalId && (r.externalId = n.externalId.slice(0, F)), typeof n.name == "string" && n.name && (r.name = n.name.slice(0, F)), r.email || r.emailHash || r.externalId ? r : null;
}
// src/consent.ts
function I(e) {
	return e.doNotTrack === "1" || e.globalPrivacyControl === !0;
}
function L(e, t, n, r = "auto") {
	let i = r === "require" || e === "require";
	return n || I(t) ? {
		state: "denied",
		requireConsent: i
	} : e === "require" || !e && i ? {
		state: "pending",
		requireConsent: i
	} : {
		state: e == null ? "granted" : e,
		requireConsent: i
	};
}
function R(e) {
	return e.state === "granted" || e.state === "pending" && !e.requireConsent;
}
function z(e) {
	return e.state === "granted";
}
// src/ids.ts
var Le = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", Re = 16, ze = 16;
function B(e = 12) {
	let t = crypto.getRandomValues(new Uint8Array(e)), n = "";
	for (let e of t) n += Le[e % 62];
	return n;
}
function Be(e) {
	let t = e.getJson(a);
	return t && typeof t.a == "string" && typeof t.s == "string" ? t : null;
}
function V(e, t, n) {
	var r;
	let i = Be(e), o = i && n - i.t < 18e5 ? {
		...i,
		t: n
	} : {
		a: (r = i == null ? void 0 : i.a) == null ? B(Re) : r,
		s: B(ze),
		t: n,
		k: Math.random() < t
	};
	return e.setJson(a, o), {
		anon: o.a,
		session: o.s,
		sampled: o.k
	};
}
// src/storage.ts
var Ve = 864e5, H = { [r]: "_avc" }, He = [
	r,
	a,
	i,
	s
];
function U() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
function W(e) {
	let t = `${e}=`, n = document.cookie.split("; ").find((e) => e.startsWith(t)), r = n == null ? void 0 : n.slice(t.length);
	return r ? decodeURIComponent(r) : null;
}
function G(e, t, n, r) {
	let i = location.protocol === "https:" ? "; Secure" : "", a = r ? `; domain=${r}` : "";
	document.cookie = `${e}=${encodeURIComponent(t)}; path=/; max-age=${n}; SameSite=Lax${i}${a}`;
}
function Ue(e) {
	let t = e.split(".");
	for (let e = 2; e <= t.length; e++) {
		let n = t.slice(-e).join(".");
		if (G("_avc_t", "1", 10, n), W("_avc_t")) return G("_avc_t", "", 0, n), n;
	}
	return null;
}
var K = class {
	constructor(e, t) {
		A(this, "configuredCookieDomain", void 0), A(this, "cookieDays", void 0), A(this, "memory", /* @__PURE__ */ new Map()), A(this, "persistent", !1), A(this, "cookieDomain", void 0), this.configuredCookieDomain = e, this.cookieDays = t;
	}
	isPersistent() {
		return this.persistent;
	}
	setPersistent(e) {
		if (e !== this.persistent && (this.persistent = e, e)) for (let [e, t] of this.memory) this.get(e) === null && this.writeDisk(e, t);
	}
	clear() {
		this.memory.clear(), this.clearDisk();
	}
	clearDisk() {
		for (let e of He) this.removeDisk(e);
	}
	get(e) {
		var t, n, r;
		if (!this.persistent) return (t = this.memory.get(e)) == null ? null : t;
		let i = H[e];
		return (n = (r = U()) == null ? void 0 : r.getItem(e)) == null ? i ? W(i) : null : n;
	}
	set(e, t) {
		this.memory.set(e, t), this.persistent && this.writeDisk(e, t);
	}
	remove(e) {
		this.memory.delete(e), this.removeDisk(e);
	}
	getJson(e) {
		let t = this.get(e);
		if (!t) return null;
		try {
			return JSON.parse(t);
		} catch {
			return null;
		}
	}
	setJson(e, t) {
		this.set(e, JSON.stringify(t));
	}
	domain() {
		if (this.cookieDomain === void 0) {
			var e;
			this.cookieDomain = (e = this.configuredCookieDomain) == null ? Ue(location.hostname) : e;
		}
		return this.cookieDomain;
	}
	writeDisk(e, t) {
		try {
			var n;
			(n = U()) == null || n.setItem(e, t);
		} catch {}
		let r = H[e];
		r && G(r, t, this.cookieDays * Ve / 1e3, this.domain());
	}
	removeDisk(e) {
		try {
			var t;
			(t = U()) == null || t.removeItem(e);
		} catch {}
		let n = H[e];
		if (n && W(n) !== null) {
			G(n, "", 0, this.configuredCookieDomain);
			let e = location.hostname.split(".");
			for (let t = 2; t <= e.length; t++) G(n, "", 0, e.slice(-t).join("."));
		}
	}
}, We = "text/plain;charset=UTF-8", Ge = new TextEncoder(), Ke = class {
	constructor(e) {
		A(this, "options", void 0), A(this, "queue", []), A(this, "generation", 0), A(this, "requests", /* @__PURE__ */ new Set()), A(this, "timer", void 0), A(this, "retries", /* @__PURE__ */ new Set()), this.options = e;
	}
	enqueue(e, t = !1) {
		var n, r;
		((n = (r = this.options).canSend) == null ? void 0 : n.call(r)) !== !1 && (this.queue.push(e), t || this.queue.length >= 20 ? this.flush() : this.timer === void 0 && (this.timer = setTimeout(() => this.flush(), 5e3)));
	}
	flush() {
		var e, t;
		if (((e = (t = this.options).canSend) == null ? void 0 : e.call(t)) === !1) this.clear();
		else for (let e of this.takeBatches(this.queue.splice(0))) this.post(e, 0, this.generation);
	}
	flushBeacon() {
		var e, t;
		if (((e = (t = this.options).canSend) == null ? void 0 : e.call(t)) === !1) {
			this.clear();
			return;
		}
		let n = [...this.retries].flatMap((e) => (clearTimeout(e.timer), e.events));
		this.retries.clear();
		for (let e of this.takeBatches([...n, ...this.queue.splice(0)])) typeof navigator.sendBeacon == "function" && navigator.sendBeacon(this.options.endpoint, this.serialize(e)) || this.saveOffline(e);
	}
	clear() {
		this.generation++;
		for (let e of this.requests) e.abort();
		this.requests.clear(), clearTimeout(this.timer), this.timer = void 0;
		for (let e of this.retries) clearTimeout(e.timer);
		this.retries.clear(), this.queue = [];
	}
	restoreOffline() {
		if (!this.options.canPersist()) return;
		let e = this.readOffline();
		this.options.storage.remove(i), e.length !== 0 && (this.queue.unshift(...e), this.flush());
	}
	takeBatches(e) {
		clearTimeout(this.timer), this.timer = void 0;
		let t = [];
		for (let n = 0; n < e.length; n += 50) t.push(...this.splitBySize(e.slice(n, n + 50)));
		return t;
	}
	splitBySize(e) {
		if (Ge.encode(this.serialize(e)).length <= 61440) return [e];
		if (e.length === 1) return [];
		let t = Math.ceil(e.length / 2);
		return [...this.splitBySize(e.slice(0, t)), ...this.splitBySize(e.slice(t))];
	}
	serialize(e) {
		return JSON.stringify(this.options.buildEnvelope(e));
	}
	async post(t, n, r) {
		var i, a, o, s;
		if (r !== this.generation || ((i = (a = this.options).canSend) == null ? void 0 : i.call(a)) === !1) return;
		let c = new AbortController();
		this.requests.add(c);
		let l;
		try {
			var u;
			let e = await fetch(this.options.endpoint, {
				method: "POST",
				body: this.serialize(t),
				headers: { "Content-Type": We },
				keepalive: !0,
				redirect: "error",
				signal: c.signal,
				credentials: "omit"
			});
			l = e.status >= 500, (u = e.body) == null || u.cancel().catch(() => {});
		} catch {
			l = !0;
		} finally {
			this.requests.delete(c);
		}
		if (!l || r !== this.generation || ((o = (s = this.options).canSend) == null ? void 0 : o.call(s)) === !1) return;
		let d = e[n];
		if (d === void 0) {
			this.saveOffline(t);
			return;
		}
		let f = {
			events: t,
			timer: setTimeout(() => {
				this.retries.delete(f), this.post(t, n + 1, r);
			}, d)
		};
		this.retries.add(f);
	}
	readOffline() {
		let e = this.options.storage.getJson(i), n = Date.now() - t;
		return Array.isArray(e) ? e.filter((e) => e.ts > n) : [];
	}
	saveOffline(e) {
		if (!this.options.canPersist()) return;
		let t = [...this.readOffline(), ...e].slice(-200);
		this.options.storage.setJson(i, t);
	}
}, qe = 1;
function q(e) {
	var t;
	return ((t = U()) == null ? void 0 : t.getItem(e)) === "1";
}
function J(e, t) {
	try {
		var n, r;
		t ? (n = U()) == null || n.setItem(e, "1") : (r = U()) == null || r.removeItem(e);
	} catch {}
}
function Je(e) {
	try {
		return e ? v(e) : null;
	} catch {
		return null;
	}
}
function Y(e) {
	return e.searchParams.get("avc_optout") === "1" || q("avc_member");
}
var Ye = class {
	constructor(e, t, n = !1) {
		A(this, "config", void 0), A(this, "policy", void 0), A(this, "storage", void 0), A(this, "transport", void 0), A(this, "dwell", new j(Date.now(), document.visibilityState === "visible")), A(this, "member", void 0), A(this, "pageTouch", void 0), A(this, "generation", 0), A(this, "destroyed", !1), A(this, "attribution", null), A(this, "identity", null), A(this, "referrer", void 0), A(this, "lastUrl", void 0), A(this, "scroll", null), A(this, "uninstallers", []), this.config = e;
		let r = new URL(location.href);
		this.storage = new K(e.cookieDomain, e.attributionDays), this.member = Y(r), this.referrer = Je(document.referrer), this.pageTouch = n ? null : ie(r, document.referrer, Date.now());
		let i = navigator;
		t === "optOut" && J(o, !0), t === "granted" && !I(i) && J(o, !1), this.policy = L(t === "optOut" ? "denied" : t == null ? e.consent : t, i, q(o), e.consentMode), this.transport = new Ke({
			endpoint: `${e.api}/collect`,
			storage: this.storage,
			buildEnvelope: (e) => this.envelope(e),
			canPersist: () => !this.destroyed && z(this.policy) && !I(navigator),
			canSend: () => !this.destroyed && R(this.policy) && !I(navigator)
		}), this.applyConsent();
		let a = oe(location.href);
		a && history.replaceState(history.state, "", a), this.lastUrl = v(location.href);
	}
	start() {
		if (this.destroyed || this.uninstallers.length) return;
		let e = (e) => this.emit(e);
		this.scroll = Te(this.config.scrollThresholds, e), this.uninstallers = [
			this.scroll.uninstall,
			E({
				autocapture: this.config.autocapture,
				emit: e
			}),
			Se(() => this.onRouteChange()),
			this.listenVisibility()
		], this.config.autocapture && this.uninstallers.push(xe(e)), this.page(!0);
	}
	destroy() {
		this.destroyed = !0, this.generation++;
		for (let e of this.uninstallers) e();
		this.uninstallers = [], this.transport.clear();
	}
	page(e = !1) {
		var t;
		this.emit({
			t: "pageview",
			title: document.title
		}, e), (t = this.scroll) == null || t.schedule();
	}
	track(e, t) {
		let n = Me(e, t);
		n && this.emit(n);
	}
	conversion(e) {
		this.emit(Ne(e), !0);
	}
	async identify(e) {
		if (this.destroyed || !z(this.policy) || I(navigator)) return;
		let t = this.generation, n = await Ie(e, this.config.hashEmail);
		n && t === this.generation && z(this.policy) && this.emit(n, !0);
	}
	consent(e) {
		e !== "granted" && e !== "denied" && e !== "pending" || this.destroyed || ((I(navigator) || e !== "granted" && q("avc_off")) && (e = "denied"), e === "granted" && J(o, !1), e !== this.policy.state && (this.generation++, this.transport.clear(), e !== "granted" && (this.storage.clear(), this.identity = null, this.attribution = null, this.pageTouch = null)), this.policy = {
			...this.policy,
			state: e
		}, this.applyConsent());
	}
	optOut() {
		J(o, !0), this.consent("denied");
	}
	reset() {
		this.destroyed || (this.generation++, this.transport.clear(), this.storage.clear(), this.identity = null, this.attribution = null, this.pageTouch = null);
	}
	applyConsent() {
		this.storage.setPersistent(z(this.policy)), this.policy.state === "denied" ? (this.transport.clear(), this.storage.clear(), this.identity = null, this.attribution = null, this.pageTouch = null) : (this.attribution = ae(this.storage, this.pageTouch, Date.now(), this.config.attributionDays), z(this.policy) && (this.member && J(s, !0), this.transport.restoreOffline()));
	}
	emit(e, t = !1, n = v(location.href)) {
		if (this.destroyed) return;
		if (I(navigator)) {
			this.consent("denied");
			return;
		}
		if (!R(this.policy)) return;
		let r = Date.now();
		if (this.identity = V(this.storage, this.config.sampleRate, r), !this.identity.sampled) return;
		let i = {
			...e,
			id: B(),
			ts: r,
			url: n,
			ref: this.referrer
		};
		this.transport.enqueue(i, t);
	}
	envelope(e) {
		var t, n, r, i, a;
		let o = (t = this.identity) == null ? V(this.storage, this.config.sampleRate, Date.now()) : t, s = {
			v: qe,
			sdk: "1.1.0",
			site: this.config.site,
			anon: o.anon,
			sess: o.session,
			consent: this.policy.state,
			attr: {
				first: (n = (r = this.attribution) == null ? void 0 : r.first) == null ? null : n,
				last: (i = (a = this.attribution) == null ? void 0 : a.last) == null ? null : i
			},
			screen: {
				w: screen.width,
				h: screen.height,
				dpr: window.devicePixelRatio || 1
			},
			sentAt: Date.now(),
			events: e
		};
		return navigator.webdriver && (s.bot = !0), this.member && (s.member = !0), s;
	}
	onRouteChange() {
		var e;
		this.emitDwell(this.lastUrl), this.referrer = this.lastUrl, this.lastUrl = v(location.href), (e = this.scroll) == null || e.reset(), this.page();
	}
	emitDwell(e) {
		let t = this.dwell.take(Date.now());
		t > 0 && this.emit({
			t: "dwell",
			ms: t
		}, !1, e);
	}
	listenVisibility() {
		let e = () => {
			let e = document.visibilityState === "visible";
			this.dwell.onVisibilityChange(Date.now(), e), !e && (this.emitDwell(), this.transport.flushBeacon());
		};
		return document.addEventListener("visibilitychange", e), () => document.removeEventListener("visibilitychange", e);
	}
}, Xe = 5e3, X = 2048;
async function Ze(e) {
	let t = new AbortController(), n = setTimeout(() => t.abort(), Xe);
	try {
		let n = new URL(`${e.api}/sdk/config`);
		n.searchParams.set("site", e.site);
		let i = await fetch(n.href, {
			credentials: "omit",
			cache: "no-store",
			redirect: "error",
			signal: t.signal
		});
		if (i.status !== 200 || !i.body) {
			var r;
			return (r = i.body) == null || r.cancel().catch(() => {}), null;
		}
		let a = i.headers.get("Content-Length");
		if (a && /^\d+$/.test(a) && Number(a) > X) return i.body.cancel().catch(() => {}), null;
		let o = i.body.getReader(), s = [], c = 0;
		try {
			for (;;) {
				let { done: e, value: t } = await o.read();
				if (e) break;
				if (c += t.byteLength, c > X) return o.cancel().catch(() => {}), null;
				s.push(t);
			}
		} finally {
			o.releaseLock();
		}
		let l = new Uint8Array(c), u = 0;
		for (let e of s) l.set(e, u), u += e.byteLength;
		let d = JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(l));
		if (!d || typeof d != "object" || Array.isArray(d)) return null;
		let f = d;
		return f.site === e.site && (f.consentMode === "auto" || f.consentMode === "require") ? f.consentMode : null;
	} catch {
		return null;
	} finally {
		clearTimeout(n);
	}
}
// src/boot.ts
function Z(e, [t, n, r]) {
	switch (t) {
		case "track": return e.track(n, r);
		case "conversion": return e.conversion(n);
		case "identify":
			e.identify(n);
			return;
		case "consent": return e.consent(n);
		case "reset": return e.reset();
		case "optOut": return e.optOut();
		case "page": return e.page();
	}
}
function Qe(e, t) {
	let n = e, r;
	try {
		var i;
		r = ((i = U()) == null ? void 0 : i.getItem(o)) === "1";
	} catch {
		r = !0;
	}
	let a = L(n.consent, navigator, r, n.consentMode), s = !1, c = a.state === "denied", u = c, d = [], f = (e, t = !1) => {
		(t || e.state !== a.state || e.requireConsent !== a.requireConsent) && (d = [], c = !0, (e.state === "denied" || a.state === "granted" && e.state !== "granted") && (u = !0)), a = e;
	};
	for (let e of t) {
		let [t, i] = e;
		if (t === "init" && i && typeof i == "object") {
			let e = i, t = n.hashEmail;
			n = p(n, e);
			let o = l(e.consent);
			o ? (s = !0, f(L(o, navigator, r, n.consentMode), t !== n.hashEmail)) : t !== n.hashEmail && f(a, !0);
		} else if (t === "consent") {
			let e = l(i);
			e && e !== "require" && (s = !0, e === "granted" && !I(navigator) && (r = !1), f(L(e, navigator, r, n.consentMode)));
		} else t === "optOut" ? (s = !0, r = !0, f({
			...a,
			state: "denied"
		}, !0)) : t === "reset" ? (d = [], c = !0, u = !0) : (t === "identify" ? z(a) : R(a)) && d.push(e);
	}
	let m = s ? r ? "optOut" : a.state : void 0;
	return {
		config: n,
		initial: m,
		replay: d,
		clearTracking: c,
		dropAttribution: u
	};
}
var Q = /* @__PURE__ */ new WeakMap();
function $e(e, t) {
	var n;
	if ((n = e.avocado) != null && n.loaded) return Promise.resolve(null);
	let r = Q.get(e);
	if (r) return r;
	let i = et(e, t).catch(() => null).finally(() => Q.delete(e));
	return Q.set(e, i), i;
}
async function et(e, t) {
	var n, r;
	let i = f(t);
	if (!i.site) return null;
	let a = (n = e.avocado) == null ? Object.assign((...e) => {
		var t;
		(t = a.q) == null || t.push(e);
	}, { q: [] }) : n;
	e.avocado = a;
	let o = await Ze(i);
	if (!o || e.avocado !== a || a.loaded) return null;
	let s = Array.from((r = a.q) == null ? [] : r, (e) => Array.from(e)), { config: c, initial: l, replay: u, clearTracking: d, dropAttribution: p } = Qe({
		...i,
		consentMode: i.consent === "require" ? "require" : o
	}, s);
	d && new K(c.cookieDomain, c.attributionDays).clear();
	let m = new Ye(c, l, p), h = (...e) => Z(m, e);
	h.loaded = !0, e.avocado = h, m.start();
	for (let e of u) Z(m, e);
	return m;
}
// src/index.ts
var tt = m(document), nt = 2e3, $ = () => void $e(window, tt);
typeof window.requestIdleCallback == "function" ? window.requestIdleCallback($, { timeout: nt }) : setTimeout($, 0);
