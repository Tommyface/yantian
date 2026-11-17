import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseSharedNote,
  extractSourceId,
  isValidSourceId,
  mapTagsToTopics,
} from '../src/p0/parse-shared-note.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

describe('extractSourceId — 从拾页文件名提取 id', () => {
  it('提取标准文件名 id', () => {
    const id = extractSourceId('library/inbox/20260804-093012-a1b2c3d4-以钉钉子精神抓落实.md');
    expect(id).toBe('20260804-093012-a1b2c3d4');
  });

  it('识别合法 source_id 格式', () => {
    expect(isValidSourceId('20260804-093012-a1b2c3d4')).toBe(true);
    expect(isValidSourceId('bad-id')).toBe(false);
  });

  it('非标准文件名返回 null', () => {
    expect(extractSourceId('library/inbox/随便起的名字.md')).toBeNull();
  });
});

describe('parseSharedNote — 解析拾页真实格式', () => {
  it('正确解析人民日报样本的全部字段', () => {
    const note = parseSharedNote(fixture('real-shiye-note.md'), {
      filePath: 'library/inbox/20260804-093012-a1b2c3d4-以钉钉子精神抓落实.md',
    });

    expect(note.sourceId).toBe('20260804-093012-a1b2c3d4');
    expect(note.front.title).toBe('以钉钉子精神抓落实');
    expect(note.front.site).toBe('人民日报');
    expect(note.front.author).toBe('本报评论员');
    expect(note.front.tags).toEqual(['政策理论', '作风建设', '抓落实']);
    expect(note.front.content_hash).toBe('a1b2c3d4');
    expect(note.front.status).toBe('inbox');
  });

  it('派生只读出处 origin', () => {
    const note = parseSharedNote(fixture('real-shiye-note.md'), {
      filePath: 'library/inbox/20260804-093012-a1b2c3d4-x.md',
    });
    expect(note.origin.url).toContain('paper.people.com.cn');
    expect(note.origin.site).toBe('人民日报');
    expect(note.origin.capturedAt).toBe('2026-08-04T09:30:12+08:00');
    expect(note.warnings).toEqual([]);
  });

  it('正文正确提取（不含 front matter）', () => {
    const note = parseSharedNote(fixture('real-shiye-note.md'), {
      filePath: 'library/inbox/20260804-093012-a1b2c3d4-x.md',
    });
    expect(note.body).toContain('抓落实，贵在持之以恒');
    expect(note.body).not.toContain('source_url:');
  });

  it('兼容 x-yantian-* 扩展字段', () => {
    const note = parseSharedNote(fixture('note-with-extension.md'), {
      filePath: 'library/山东实践/20260805-142000-b2c3d4e5-山东乡村振兴.md',
    });
    expect(note.front['x-yantian-compile-status']).toBe('candidate');
    expect(note.front['x-yantian-extractor-version']).toBe('v1');
    expect(note.front.category).toBe('山东实践');
  });

  it('缺字段时降级告警而非抛异常', () => {
    const note = parseSharedNote(fixture('note-missing-fields.md'), {
      filePath: 'library/inbox/20260806-100000-c3d4e5f6-缺出处的剪藏.md',
    });
    expect(note.origin.url).toBe('');
    expect(note.warnings.some((w) => w.includes('source_url'))).toBe(true);
    expect(note.warnings.some((w) => w.includes('captured_at'))).toBe(true);
  });

  it('文件名不规范时告警', () => {
    const note = parseSharedNote(fixture('real-shiye-note.md'), {
      filePath: 'library/inbox/随便起的名字.md',
    });
    expect(note.warnings.some((w) => w.includes('source_id'))).toBe(true);
    expect(note.sourceId).toContain('unknown-');
  });
});

describe('mapTagsToTopics — 拾页标签映射遴选主题', () => {
  it('把拾页自由标签映射为四类遴选主题', () => {
    const topics = mapTagsToTopics(['山东', '乡村振兴', '写作', '无关标签']);
    expect(topics).toContain('山东实践');
    expect(topics).toContain('文字表达');
    expect(topics).not.toContain('政策理论');
  });

  it('支持自定义映射表', () => {
    const topics = mapTagsToTopics(['调研'], { 调研: '综合分析' });
    expect(topics).toEqual(['综合分析']);
  });
});
