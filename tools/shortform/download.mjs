// 도우인·샤오홍슈 워터마크 없는 원본 다운로더
//
// 실행
//   node tools/shortform/download.mjs "<공유문구 또는 링크>" ["<또 하나>" …]
//   node tools/shortform/download.mjs --file=scratchpad/shortform/queue.txt   한 줄에 하나
// 산출물: scratchpad/shortform/<플랫폼>_<id>/  source.mp4 또는 img_01.jpg… + meta.json
//
// 막혔을 때
//   샤오홍슈가 로그인을 요구하면  XHS_COOKIE="a1=…; web_session=…"  (브라우저 개발자도구에서 복사)
//   도우인이 빈 페이지를 주면      DOUYIN_COOKIE="…"
//   그래도 안 되면 yt-dlp 가 깔려 있을 때 자동으로 yt-dlp 로 한 번 더 시도한다.
//
// 🔴 받은 영상은 원작자 저작물이다. 그대로 재업로드하면 저작권·플랫폼 정책 위반이 될 수 있다 → README 참고
import { mkdirSync, writeFileSync, existsSync, readFileSync, createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  UA_MOBILE, UA_DESKTOP, pickUrl, platformOf, douyinIdOf, xhsIdOf, parseDouyinPage, parseXhsPage,
} from './lib/extract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT_ROOT = join(ROOT, 'scratchpad', 'shortform');

async function get(url, { ua = UA_MOBILE, cookie = '', referer } = {}) {
  const headers = { 'user-agent': ua, 'accept-language': 'zh-CN,zh;q=0.9' };
  if (cookie) headers.cookie = cookie;
  if (referer) headers.referer = referer;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

async function save(url, file, opts) {
  const res = await get(url, opts);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return file;
}

async function resolveDouyin(url) {
  // v.douyin.com 단축링크 → 리다이렉트된 최종 주소에서 id
  let id = douyinIdOf(url);
  if (!id) id = douyinIdOf((await get(url)).url);
  if (!id) throw new Error('도우인 작품 id 를 못 찾았습니다: ' + url);
  const page = `https://www.iesdouyin.com/share/video/${id}/`;
  const html = await (await get(page, { cookie: process.env.DOUYIN_COOKIE })).text();
  return parseDouyinPage(html);
}

async function resolveXhs(url) {
  // xhslink.com 단축링크는 xsec_token 이 붙은 주소로 넘어간다 — 그 주소를 그대로 써야 열린다
  const res = await get(url, { ua: UA_DESKTOP, cookie: process.env.XHS_COOKIE });
  const id = xhsIdOf(res.url) || xhsIdOf(url);
  if (!id) throw new Error('샤오홍슈 노트 id 를 못 찾았습니다: ' + res.url);
  return parseXhsPage(await res.text(), id);
}

function ytdlp(url, dir) {
  try { execFileSync('yt-dlp', ['--version'], { stdio: 'ignore' }); } catch { return null; }
  console.log('  ↪ yt-dlp 로 재시도');
  execFileSync('yt-dlp', ['-o', join(dir, 'source.%(ext)s'), '--remux-video', 'mp4', '--write-info-json', url], { stdio: 'inherit' });
  return join(dir, 'source.mp4');
}

export async function download(input, { force = false } = {}) {
  const url = pickUrl(input);
  if (!url) throw new Error('링크가 없습니다: ' + String(input).slice(0, 60));
  const platform = platformOf(url);
  if (!platform) throw new Error('도우인·샤오홍슈 링크가 아닙니다: ' + url);

  let info;
  try {
    info = platform === 'douyin' ? await resolveDouyin(url) : await resolveXhs(url);
  } catch (e) {
    // 파싱이 막혀도 yt-dlp 가 있으면 영상만이라도 받는다
    const dir = join(OUT_ROOT, `${platform}_tmp_${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const f = ytdlp(url, dir);
    if (!f) throw e;
    const meta = { platform, id: dir.split('_').pop(), type: 'video', title: '', desc: '', author: '', tags: [], source_url: url, files: ['source.mp4'], via: 'yt-dlp' };
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    return { dir, meta };
  }

  const dir = join(OUT_ROOT, `${info.platform}_${info.id}`);
  const metaFile = join(dir, 'meta.json');
  if (!force && existsSync(metaFile)) {
    console.log(`  이미 받음 → ${dir}`);
    return { dir, meta: JSON.parse(readFileSync(metaFile, 'utf8')) };
  }
  mkdirSync(dir, { recursive: true });

  const referer = info.platform === 'xhs' ? 'https://www.xiaohongshu.com/' : 'https://www.douyin.com/';
  const files = [];
  if (info.type === 'video') {
    if (!info.video) throw new Error('영상 주소가 비어 있습니다');
    await save(info.video, join(dir, 'source.mp4'), { referer });
    files.push('source.mp4');
  } else {
    for (const [i, cand] of info.images.entries()) {
      const name = `img_${String(i + 1).padStart(2, '0')}.jpg`;
      let ok = false;
      for (const u of Array.isArray(cand) ? cand : [cand]) {
        try { await save(u, join(dir, name), { referer }); ok = true; break; } catch { /* 다음 후보 */ }
      }
      if (ok) files.push(name); else console.warn(`  ⚠ 이미지 ${i + 1} 실패`);
    }
    if (!files.length) throw new Error('이미지를 하나도 못 받았습니다');
  }

  const meta = { ...info, source_url: url, files, downloaded_at: new Date().toISOString() };
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  return { dir, meta };
}

export function readQueue(args) {
  const fileArg = args.find((a) => a.startsWith('--file='));
  const list = args.filter((a) => !a.startsWith('--'));
  if (fileArg) {
    const txt = readFileSync(fileArg.slice(7), 'utf8');
    list.push(...txt.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')));
  }
  return list;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const list = readQueue(args);
  if (!list.length) {
    console.log('사용법: node tools/shortform/download.mjs "<공유문구/링크>" … | --file=목록.txt [--force]');
    process.exit(1);
  }
  let fail = 0;
  for (const item of list) {
    try {
      const { dir, meta } = await download(item, { force: args.includes('--force') });
      console.log(`✅ ${meta.platform} ${meta.type} "${(meta.title || meta.desc).slice(0, 30)}" → ${dir}`);
    } catch (e) {
      fail++;
      console.error(`❌ ${String(item).slice(0, 50)} — ${e.message}`);
    }
  }
  process.exit(fail ? 1 : 0);
}
