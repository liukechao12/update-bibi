export type OriginType = 'media' | 'xhs' | 'wb' | 'wx' | 'sph' | 'dy' | 'zh' | 'tb' | 'other';

export type PublisherType = 'MEDIA' | 'SOCIAL';

export type AuthorType = 'BLUE_V' | 'SELF_MEDIA' | 'PERSONAL' | null;

export type PushRecord = {
  textId: string;
  title: string;
  text: string;
  publishTime: string;
  author: string;
  originType: OriginType;
  publisherType: PublisherType;
  authorType: AuthorType;
  url: string;
  commentNum: number;
  forwardNum: number | null;
  praiseNum: number | null;
  viewNum: number | null;
};

export type PushRequest = {
  version?: string;
  records: PushRecord[];
};

export type PushResponse = {
  inserted: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
};

export type ParsedRawRecord = {
  tendency?: string;
  source?: string;
  author?: string;
  fansCount?: number | null;
  time?: string;
  title?: string;
  link?: string;
  summary?: string;
  commentNum?: number | null;
  forwardNum?: number | null;
  praiseNum?: number | null;
  viewNum?: number | null;
};
