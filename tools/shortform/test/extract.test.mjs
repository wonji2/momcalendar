// node --test tools/shortform/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickUrl, platformOf, douyinIdOf, xhsIdOf, parseDouyinPage, parseXhsPage, xhsOriginalImage,
} from '../lib/extract.mjs';
import { buildAss } from '../render.mjs';

test('공유문구에서 링크만 뽑는다', () => {
  assert.equal(pickUrl('7.43 复制打开抖音，看看【小A的作品】好用 https://v.douyin.com/iABCdef/ Kjc:/ 08/12'), 'https://v.douyin.com/iABCdef/');
  assert.equal(pickUrl('【小红书】收纳 http://xhslink.com/a/AbCdEf，复制本条信息'), 'http://xhslink.com/a/AbCdEf');
  assert.equal(pickUrl('링크 없음'), null);
});

test('플랫폼·id 판별', () => {
  assert.equal(platformOf('https://v.douyin.com/iABCdef/'), 'douyin');
  assert.equal(platformOf('https://www.xiaohongshu.com/explore/66a1b2c3d4e5f60718293a4b'), 'xhs');
  assert.equal(platformOf('https://www.instagram.com/p/x'), null);
  assert.equal(douyinIdOf('https://www.douyin.com/video/7412345678901234567?x=1'), '7412345678901234567');
  assert.equal(douyinIdOf('https://www.douyin.com/discover?modal_id=7412345678901234567'), '7412345678901234567');
  assert.equal(xhsIdOf('https://www.xiaohongshu.com/discovery/item/66a1b2c3d4e5f60718293a4b?xsec_token=x'), '66a1b2c3d4e5f60718293a4b');
});

test('도우인 영상: playwm → play (워터마크 제거)', () => {
  const data = {
    loaderData: {
      'video_(id)/page': {
        videoInfoRes: {
          item_list: [{
            aweme_id: 741, desc: '收纳神器 #收纳', author: { nickname: '小A' },
            text_extra: [{ hashtag_name: '收纳' }],
            video: { play_addr: { url_list: ['https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v0&ratio=720p'] } },
          }],
        },
      },
    },
  };
  const html = `<html><script>window._ROUTER_DATA = ${JSON.stringify(data)}</script></html>`;
  const r = parseDouyinPage(html);
  assert.equal(r.type, 'video');
  assert.equal(r.video, 'https://aweme.snssdk.com/aweme/v1/play/?video_id=v0&ratio=720p');
  assert.deepEqual(r.tags, ['收纳']);
  assert.equal(r.id, '741');
});

test('도우인 이미지 노트', () => {
  const data = { loaderData: { 'note_(id)/page': { videoInfoRes: { item_list: [{
    aweme_id: 1, desc: 'd', images: [{ url_list: ['https://p/a.webp', 'https://p/a.jpeg'] }], video: {},
  }] } } } };
  const r = parseDouyinPage(`<script>window._ROUTER_DATA = ${JSON.stringify(data)}</script>`);
  assert.equal(r.type, 'images');
  assert.deepEqual(r.images, ['https://p/a.jpeg']);
});

test('샤오홍슈 영상: undefined 섞인 상태값 파싱 + 원본 키 우선', () => {
  const id = '66a1b2c3d4e5f60718293a4b';
  const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${id}":{"note":{"noteId":"${id}","type":"video","title":"T","desc":"D","user":{"nickname":"B"},"tagList":[{"name":"育儿"}],"video":{"consumer":{"originVideoKey":"pre_post/abc"},"media":{"stream":{"h264":[{"masterUrl":"https://v/x.mp4"}]}}},"x":undefined}}}}}</script>`;
  const r = parseXhsPage(html, id);
  assert.equal(r.type, 'video');
  assert.equal(r.video, 'https://sns-video-bd.xhscdn.com/pre_post/abc');
  assert.equal(r.author, 'B');
});

test('샤오홍슈 이미지 원본 주소', () => {
  assert.equal(
    xhsOriginalImage('https://sns-webpic-qc.xhscdn.com/202410151234/0f1e2d/1040g2sg31abc!nd_dft_wlteh_webp_3'),
    'https://sns-img-bd.xhscdn.com/1040g2sg31abc',
  );
  assert.equal(
    xhsOriginalImage('https://sns-webpic-qc.xhscdn.com/202410151234/0f1e2d/spectrum/1040g0k0abc!nd_dft_wgth_webp_3'),
    'https://sns-img-bd.xhscdn.com/spectrum/1040g0k0abc',
  );
});

test('ASS 자막: 시간 형식·중괄호 제거·줄바꿈', () => {
  const ass = buildAss({ hook: '첫줄\n둘째{줄}', lines: [{ start: 1.5, end: 3.25, text: '안녕' }, { start: 99, end: 100, text: '잘림' }], duration: 10, font: 'X' });
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:10\.00,Hook,,0,0,0,,첫줄\\N둘째줄/);
  assert.match(ass, /Dialogue: 0,0:00:01\.50,0:00:03\.25,Sub,,0,0,0,,안녕/);
  assert.doesNotMatch(ass, /잘림/);
});
