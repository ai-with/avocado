import { useState } from "react";
import { Button, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import type { GuideInfluencerRow } from "../guides/types";
import "./reviews.css";

// 가이드 상세 인플루언서 행의 게시물 URL (F-48). 먼저 들어온 값을 쓰고, 다른 값이 오면 브랜드가 확인해 바꾼다
export function PostUrlCell({ base, row, canEdit, onSaved }: { base: string; row: GuideInfluencerRow; canEdit: boolean; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const saved = row.status.postUrl ?? "";
  const [url, setUrl] = useState(saved);
  const save = async (value: string, replace = false) => {
    try {
      const r = await api.post<{ status: string }>(`${base}/${row.id}/post-url`, { url: value, replace });
      toast(r.status === "conflict" ? "이미 다른 주소가 있어요. 아래에서 확인해 주세요." : "게시물 URL을 저장했습니다.", r.status === "conflict" ? "danger" : "success");
      await onSaved();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  if (!canEdit) return saved ? <a href={saved} target="_blank" rel="noreferrer">게시물 보기</a> : <span className="text-caption">없음</span>;
  const conflict = row.status.postConflictUrl;
  return (
    <div className="stack-tight post-url-cell">
      <input
        className="control"
        type="url"
        placeholder="https://www.instagram.com/reel/..."
        aria-label="게시물 URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && url.trim() && url !== saved && void save(url.trim())}
        onBlur={() => url.trim() && url !== saved && void save(url.trim())}
      />
      {conflict && (
        <div className="text-caption">
          다른 주소가 들어왔어요: <a href={conflict} target="_blank" rel="noreferrer">{conflict}</a>{" "}
          <Button size="sm" variant="ghost" onClick={() => void save(conflict, true)}>이 주소로 바꾸기</Button>
        </div>
      )}
    </div>
  );
}
