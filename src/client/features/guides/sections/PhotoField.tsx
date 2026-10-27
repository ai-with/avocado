import { Textarea } from "../../../ui";
import { GUIDE_PHOTO_ACCEPT } from "../../../../shared/guide-public";
import { FilePickButton } from "../../links/FilePickButton";
import { usePhotoUpload } from "../usePhotoUpload";
import { lines } from "../useGuideForm";

type Props = { photos: string[]; onChange: (photos: string[]) => void; error?: string };

// 제품 사진: 파일 올리기 + 주소 직접 입력 (AIWITH-368)
export function PhotoField({ photos, onChange, error }: Props) {
  const up = usePhotoUpload((url) => onChange([...photos, url]));
  return (
    <div className="stack-tight">
      <Textarea
        label="제품 사진 주소 (한 줄에 하나)"
        value={photos.join("\n")}
        onChange={(e) => onChange(lines(e.target.value))}
        hint="파일을 올리면 주소가 아래에 자동으로 붙어요. JPG, PNG, WEBP, 5MB 이하."
        error={up.error || error}
      />
      <div className="row">
        <FilePickButton label={up.busy ? "올리는 중" : "사진 파일 올리기"} accept={GUIDE_PHOTO_ACCEPT} onFile={(f) => void up.upload(f)} disabled={up.busy} />
      </div>
    </div>
  );
}
