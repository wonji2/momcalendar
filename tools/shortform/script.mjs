// 원본 설명·중국어 자막 → 한국어 후킹 제목·자막·캡션·해시태그 (Claude API)
//
// 설치(한 번): npm i --prefix tools/shortform --no-save --no-package-lock @anthropic-ai/sdk
// 키: ANTHROPIC_API_KEY 환경변수 (또는 `ant auth login`)
// 실행: node tools/shortform/script.mjs <작업폴더> [--tone="육아맘 말투"]
// 입력: <폴더>/meta.json, (있으면) <폴더>/segments.json
// 산출: <폴더>/ko.json, <폴더>/caption.txt
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = process.env.SHORTFORM_MODEL || 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string', description: '영상 상단에 계속 떠 있을 후킹 제목. 최대 2줄, 줄당 14자 이내, 줄바꿈은 \\n' },
    subtitles: {
      type: 'array',
      description: '입력 자막 구간과 같은 i 로 1:1 번역. 입력 자막이 없으면 빈 배열',
      items: {
        type: 'object',
        properties: { i: { type: 'integer' }, ko: { type: 'string' } },
        required: ['i', 'ko'],
        additionalProperties: false,
      },
    },
    caption: { type: 'string', description: '릴스/쇼츠 본문 캡션. 3~5줄, 이모지 약간' },
    hashtags: { type: 'array', items: { type: 'string' }, description: '# 없이 한국어 해시태그 8~12개' },
  },
  required: ['hook', 'subtitles', 'caption', 'hashtags'],
  additionalProperties: false,
};

const SYSTEM = `당신은 중국 숏폼(도우인·샤오홍슈)을 한국 인스타 릴스·유튜브 쇼츠용으로 현지화하는 편집자입니다.
- 자막은 직역하지 말고 한국 시청자가 바로 이해하는 자연스러운 구어체로. 한 구간은 화면 한 줄(18자 안팎)에 들어가게 짧게.
- 중국 고유 브랜드·가격(위안)·플랫폼명(抖音, 小红书, 淘宝 등)은 한국 시청자 기준으로 일반화하거나 뺍니다.
- 후킹 제목은 첫 1초에 스크롤을 멈추게 하는 문장. 과장·허위 효능 주장 금지.
- 캡션 마지막에 원작자 표기 한 줄을 넣습니다: "🎬 원본: {작성자} ({플랫폼})"`;

export async function makeScript(dir, { tone = '' } = {}) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const segFile = join(dir, 'segments.json');
  const segs = existsSync(segFile) ? JSON.parse(readFileSync(segFile, 'utf8')).segments : [];

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const user = [
    `플랫폼: ${meta.platform === 'xhs' ? '샤오홍슈' : '도우인'}`,
    `작성자: ${meta.author || '알 수 없음'}`,
    `제목: ${meta.title}`,
    `설명: ${meta.desc}`,
    `태그: ${(meta.tags || []).join(', ')}`,
    `형식: ${meta.type === 'video' ? '영상' : '이미지 슬라이드'}`,
    tone ? `말투: ${tone}` : '',
    '',
    segs.length
      ? '자막 구간(i | 시작~끝초 | 원문):\n' + segs.map((s, i) => `${i} | ${s.start}~${s.end} | ${s.text}`).join('\n')
      : '자막 구간 없음 (음성 인식 안 함). subtitles 는 빈 배열로.',
  ].filter((l) => l !== '').join('\n');

  // 안전 분류기가 거절하면 같은 호출 안에서 다른 모델로 자동 재시도 (server-side fallback)
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });

  if (res.stop_reason === 'refusal') throw new Error('Claude 가 이 콘텐츠 처리를 거절했습니다: ' + (res.stop_details?.explanation || ''));
  if (res.stop_reason === 'max_tokens') throw new Error('응답이 잘렸습니다 (자막 구간이 너무 많음)');
  const text = res.content.find((b) => b.type === 'text')?.text;
  const out = JSON.parse(text);

  writeFileSync(join(dir, 'ko.json'), JSON.stringify(out, null, 2));
  const tags = out.hashtags.map((t) => '#' + t.replace(/^#/, '').replace(/\s+/g, '')).join(' ');
  writeFileSync(join(dir, 'caption.txt'), `${out.caption}\n\n${tags}\n`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir) { console.log('사용법: node tools/shortform/script.mjs <작업폴더> [--tone=…]'); process.exit(1); }
  const tone = rest.find((a) => a.startsWith('--tone='))?.slice(7) || '';
  const out = await makeScript(dir, { tone });
  console.log(`✅ 후킹: ${out.hook.replace(/\n/g, ' / ')} · 자막 ${out.subtitles.length}줄`);
}
