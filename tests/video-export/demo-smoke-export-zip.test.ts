/**
 * Headless export-ZIP smoke test (funder-demo verification).
 *
 * The video-export compiler is deliberately pure (issue #864), so a real
 * Hyperframes project ZIP can be produced with in-memory stubs — no browser, no
 * LLM key, no TTS key. This test writes that ZIP to /tmp so it can be posted
 * straight to the render service, which is what makes the MP4 pipeline
 * verifiable before any provider credentials exist.
 *
 * It asserts only structure; the MP4 itself is verified out of band with
 * ffprobe after the render service returns it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { compileVideoTimeline, emitHyperframes, toSrt } from '@/lib/video-export';
import { packageVideoZip } from '@/lib/video-export-app/package-zip';

const timing = {
  audioDurationMs: () => null,
  videoDurationMs: () => null,
};
const assets = {
  audio: () => null,
  media: () => null,
};

const stage = { id: 'demo-stage', name: 'OpenMAIC funder demo' };

const scene = {
  id: 'scene-1',
  stageId: 'demo-stage',
  type: 'slide',
  title: 'Ukufunda ngomdlalo',
  order: 0,
  content: {
    type: 'slide',
    canvas: {
      id: 'c1',
      viewportSize: 1920,
      viewportRatio: 0.5625,
      theme: {
        themeColors: [],
        fontColor: '#000000',
        fontName: 'Arial',
        backgroundColor: '#ffffff',
      },
      elements: [
        {
          id: 'el-1',
          type: 'text',
          left: 120,
          top: 140,
          width: 900,
          height: 260,
          content: '<h1>Ukufunda ngomdlalo</h1><p>Learning through play</p>',
          defaultFontName: 'Arial',
          defaultColor: '#111111',
        },
      ],
    },
  },
  actions: [
    {
      id: 'a1',
      type: 'speech',
      text: 'Sawubona sanibonani. Namuhla sizofunda ukubala ngezinto ezilula.',
    },
    {
      id: 'a2',
      type: 'speech',
      text: 'Hello class. Today we will practise counting with simple objects.',
    },
  ],
};

describe('headless export ZIP smoke test', () => {
  it('emits a self-contained Hyperframes project with subtitles and GSAP', async () => {
    const ir = compileVideoTimeline(
      { stage, scenes: [scene] },
      { timing, assets, config: { playbackSpeed: 1 } },
    );

    // eslint-disable-next-line no-console
    console.log('IR:', JSON.stringify(ir).slice(0, 1200));
    // eslint-disable-next-line no-console
    console.log('IR top-level keys:', Object.keys(ir).join(', '));
    // eslint-disable-next-line no-console
    console.log(
      'IR asset plan:',
      JSON.stringify((ir as { assets?: unknown }).assets ?? null).slice(0, 800),
    );

    const project = emitHyperframes(ir, {});
    expect(project.files.length).toBeGreaterThan(0);
    expect(project.totalDurationMs).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(
      'project files:',
      project.files.map((f) => f.path).join(', '),
      '| durationMs:',
      project.totalDurationMs,
      '| size:',
      `${project.width}x${project.height}`,
    );

    const srt = toSrt(ir.subtitles);
    writeFileSync('/tmp/openmaic-subtitles.srt', srt);
    // eslint-disable-next-line no-console
    console.log('--- SRT ---\n' + srt);

    const gsap = readFileSync('public/vendor/gsap.min.js', 'utf8');
    // The slide-snapshot frame is a collected binary asset: the app produces it by
    // rendering each slide to a PNG. Without these bytes the composition paints
    // black, so when the demo frame exists the smoke test supplies it to prove
    // content reaches the video. Absent the frame (CI), only structure is asserted
    // and the asset map stays empty.
    const framePath = '/tmp/slide-frame.png';
    const assetBlobs = new Map<string, Blob>();
    if (existsSync(framePath)) {
      assetBlobs.set(
        'frames/001-ukufunda-ngomdlalo.png',
        new Blob([readFileSync(framePath)], { type: 'image/png' }),
      );
    }
    const blob = await packageVideoZip(project, assetBlobs, { gsapSource: gsap });
    const bytes = Buffer.from(await blob.arrayBuffer());
    writeFileSync('/tmp/openmaic-export.zip', bytes);

    // eslint-disable-next-line no-console
    console.log('ZIP bytes:', bytes.length);
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
