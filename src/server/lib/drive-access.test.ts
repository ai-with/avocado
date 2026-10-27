import { describe, expect, it } from "vitest";
import { isDriveUrl, judgeDriveResponse } from "./drive-access";

const FILE = "https://drive.google.com/file/d/abc/view";

describe("judgeDriveResponse", () => {
  it("로그인 화면으로 가면 막힘", () => {
    expect(judgeDriveResponse(null, "https://accounts.google.com/v3/signin/identifier?continue=x")).toBe("blocked");
    expect(judgeDriveResponse(200, "https://accounts.google.com/ServiceLogin")).toBe("blocked");
  });
  it("드라이브에서 200 이면 열림", () => {
    expect(judgeDriveResponse(200, FILE)).toBe("accessible");
  });
  it("403·404 는 막힘, 그 밖은 모름", () => {
    expect(judgeDriveResponse(403, FILE)).toBe("blocked");
    expect(judgeDriveResponse(404, FILE)).toBe("blocked");
    expect(judgeDriveResponse(500, FILE)).toBe("unknown");
    expect(judgeDriveResponse(null, FILE)).toBe("unknown");
  });
});

describe("isDriveUrl", () => {
  it("드라이브·문서 주소만 확인 대상", () => {
    expect(isDriveUrl(FILE)).toBe(true);
    expect(isDriveUrl("https://docs.google.com/document/d/abc/edit")).toBe(true);
    expect(isDriveUrl("https://www.dropbox.com/s/abc")).toBe(false);
    expect(isDriveUrl("not a url")).toBe(false);
  });
});
