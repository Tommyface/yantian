import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  scanVault,
  loadManifest,
  defaultManifestPath,
  fingerprintOf,
  collectMarkdownFiles,
  changedNotes,
} from '../src/p1/vault-scanner.js';

const NOTE_A = `---
title: 以钉钉子精神抓落实
source_url: http://paper.people.com.cn/rmrb/pc/content/202608/04/content_12345.html
source_type: web
site: 人民日报
author: 本报评论员
captured_at: 2026-08-04T09:30:12+08:00
category: inbox
tags: [政策理论, 作风建设, 抓落实]
status: inbox
content_hash: a1b2c3d4
quality: clean
ocr: none
warnings: []
---

## 抓落实，贵在持之以恒

抓落实，是党的路线方针政策转化为实际行动的关键环节。抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。
`;

const NOTE_B = `---
title: 山东改革实践
source_url: https://www.qstheory.cn/2026/08/05/test.htm
site: 求是
captured_at: 2026-08-05T10:00:00+08:00
tags: [山东, 改革]
content_hash: b2c3d4e5
---

山东持续深化放管服改革，优化营商环境，激发市场主体活力。
`;

let root: string;
let fixedNow: () => Date;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'yantian-scan-'));
  await mkdir(join(root, 'library', 'inbox'), { recursive: true });
  fixedNow = () => new Date('2026-11-17T03:00:00.000Z');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function putNote(rel: string, content: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content, 'utf-8');
}

test('首次扫描：全部标记为 added，清单正确落盘', async () => {
  await putNote('library/inbox/20260804-093012-a1b2c3d4-ding.md', NOTE_A);
  await putNote('library/shengqiu/20260805-100000-b2c3d4e5-shandong.md', NOTE_B);

  const report = await scanVault({ vaultRoot: root, now: fixedNow });

  expect(report.totalFiles).toBe(2);
  expect(report.added).toBe(2);
  expect(report.updated).toBe(0);
  expect(report.removed).toBe(0);
  expect(report.errors).toEqual([]);
  expect(changedNotes(report)).toHaveLength(2);

  const manifest = await loadManifest(defaultManifestPath(root));
  expect(Object.keys(manifest.entries)).toHaveLength(2);
  expect(manifest.entries['library/inbox/20260804-093012-a1b2c3d4-ding.md'].sourceId)
    .toBe('20260804-093012-a1b2c3d4');
});

test('二次扫描无变更：全部 unchanged，不产生入库项', async () => {
  await putNote('library/inbox/20260804-093012-a1b2c3d4-ding.md', NOTE_A);
  await scanVault({ vaultRoot: root, now: fixedNow });
  const report = await scanVault({ vaultRoot: root, now: fixedNow });

  expect(report.added).toBe(0);
  expect(report.unchanged).toBe(1);
  expect(changedNotes(report)).toHaveLength(0);
});

test('内容修改一个字：识别为 updated 并给出指纹差异', async () => {
  const rel = 'library/inbox/20260804-093012-a1b2c3d4-ding.md';
  await putNote(rel, NOTE_A);
  await scanVault({ vaultRoot: root, now: fixedNow });

  await putNote(rel, NOTE_A.replaceAll('钉钉子精神', '钉钉子态度'));
  const report = await scanVault({ vaultRoot: root, now: fixedNow });

  expect(report.updated).toBe(1);
  expect(report.items[0].detail).toContain('内容变更');
  expect(changedNotes(report)[0].body).toContain('钉钉子态度');
});

test('删除原文：识别为 removed', async () => {
  const rel = 'library/inbox/20260804-093012-a1b2c3d4-ding.md';
  await putNote(rel, NOTE_A);
  await scanVault({ vaultRoot: root, now: fixedNow });

  await rm(join(root, rel));
  const report = await scanVault({ vaultRoot: root, now: fixedNow });

  expect(report.removed).toBe(1);
  expect(report.items.find((i) => i.action === 'removed')?.filePath).toBe(rel);
});

test('只读铁律：扫描不修改任何拾页原文', async () => {
  const rel = 'library/inbox/20260804-093012-a1b2c3d4-ding.md';
  await putNote(rel, NOTE_A);
  const before = await readFile(join(root, rel), 'utf-8');
  await scanVault({ vaultRoot: root, now: fixedNow });
  const after = await readFile(join(root, rel), 'utf-8');
  expect(after).toBe(before);
  // 砚田目录只出现在 vault 根，不侵入 library
  const libraryEntries = await readdir(join(root, 'library'));
  expect(libraryEntries).not.toContain('.yantian');
});

test('损坏的清单降级为空清单重新全量扫描', async () => {
  await putNote('library/inbox/20260804-093012-a1b2c3d4-ding.md', NOTE_A);
  const mPath = defaultManifestPath(root);
  await mkdir(join(mPath, '..'), { recursive: true });
  await writeFile(mPath, '{ broken json', 'utf-8');

  const report = await scanVault({ vaultRoot: root, now: fixedNow });
  expect(report.added).toBe(1);
});

test('指纹对字节敏感：不同内容不同指纹', () => {
  expect(fingerprintOf(Buffer.from(NOTE_A))).not.toBe(fingerprintOf(Buffer.from(NOTE_A + ' ')));
  expect(fingerprintOf(Buffer.from(NOTE_A))).toMatch(/^[0-9a-f]{64}$/);
});

test('collectMarkdownFiles 跳过隐藏目录', async () => {
  await putNote('library/inbox/a.md', NOTE_A);
  await putNote('library/.trash/hidden.md', NOTE_B);
  const files = await collectMarkdownFiles(join(root, 'library'));
  expect(files).toHaveLength(1);
  expect(files[0]).toContain('inbox');
});
