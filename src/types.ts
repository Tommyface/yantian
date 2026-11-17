// 砚田前端类型定义（对齐后端 contracts）

export type MaterialType = 'golden_sentence' | 'subheading' | 'practice' | 'article';
export type CompileStatus = 'unprocessed' | 'candidate' | 'confirmed' | 'used';
export type Mastery = 'new' | 'reviewing' | 'mastered';
export type ExamTopic = '政策理论' | '综合分析' | '文字表达' | '山东实践';

export interface CardOrigin {
  url: string;
  site: string;
  author: string;
  capturedAt: string;
}

export interface MaterialCard {
  cardId: string;
  sourceId: string;
  type: MaterialType;
  content: string;
  sourceExcerpt: string;
  origin: CardOrigin;
  topics: ExamTopic[];
  scenes: string[];
  status: CompileStatus;
  mastery: Mastery;
  createdAt: string;
  extractorVersion?: string;
  confirmedBy?: 'human' | 'import';
}

export interface AppStats {
  notes: number;
  cards: number;
  notesFts: number;
  cardsFts: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byTopic: Record<string, number>;
}

export interface TopicSummary {
  topic: string;
  count: number;
  types: Partial<Record<MaterialType, number>>;
}

export interface TopicBundle {
  topic: string;
  total: number;
  golden_sentence: MaterialCard[];
  subheading: MaterialCard[];
  practice: MaterialCard[];
  article: MaterialCard[];
  golden_sentence_cited?: string[];
  subheading_cited?: string[];
  practice_cited?: string[];
  article_cited?: string[];
}

export interface ReviewCard {
  cardId: string;
  front: string;
  back: string;
  originText: string;
  sourceId: string;
  mastery: Mastery;
  type: MaterialType;
}

export interface ExtractionCandidate {
  text: string;
  type: MaterialType;
  confidence: number;
  verbatim: boolean;
  sourceId: string;
  topics?: ExamTopic[];
  reason?: string;
}

export interface ExtractionResult {
  sourceId: string;
  candidates: ExtractionCandidate[];
  dropped: number;
}

export interface SharedNote {
  sourceId: string;
  filePath: string;
  body: string;
  front: {
    title?: string;
    source_url?: string;
    site?: string;
    author?: string;
    captured_at?: string;
    tags?: string[];
  };
  origin: CardOrigin;
  warnings: string[];
}

export interface SearchHit {
  kind: 'note' | 'card';
  id?: string;
  sourceId?: string;
  cardId?: string;
  site?: string;
  content: string;
  snippet?: string;
  title?: string;
  origin?: CardOrigin;
  type?: MaterialType;
  status?: CompileStatus;
  topics?: ExamTopic[];
  score?: number;
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
}
