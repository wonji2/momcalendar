# 영상 음성 → 중국어 자막 구간(segments.json). 로컬에서 돈 안 들고 돌아간다.
#
# 설치(한 번): pip install faster-whisper
# 실행: python tools/shortform/transcribe.py <영상.mp4> <segments.json> [모델크기=small]
#   모델은 처음 실행할 때 자동으로 받는다. small 이면 CPU 로 1분 영상 1~2분.
#   GPU(엔비디아)가 있으면 자동으로 쓴다.
import json
import sys

from faster_whisper import WhisperModel

src, out = sys.argv[1], sys.argv[2]
size = sys.argv[3] if len(sys.argv) > 3 else "small"

try:
    model = WhisperModel(size, device="cuda", compute_type="float16")
except Exception:
    model = WhisperModel(size, device="cpu", compute_type="int8")

segments, info = model.transcribe(src, vad_filter=True)
rows = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]

with open(out, "w", encoding="utf-8") as f:
    json.dump({"language": info.language, "segments": rows}, f, ensure_ascii=False, indent=2)
print(f"{len(rows)} segments ({info.language})")
