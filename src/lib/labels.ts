export const userStatusLabelMap: Record<string, string> = {
  ACTIVE: '启用',
  DISABLED: '禁用'
};

export const importTypeLabelMap: Record<string, string> = {
  PASTE: '粘贴录入',
  EXCEL: 'Excel 导入',
  MANUAL: '手工录入',
  API: '接口导入'
};

export const batchStatusLabelMap: Record<string, string> = {
  CREATED: '已创建',
  VALIDATING: '校验中',
  PENDING_PUSH: '待推送',
  PUSHING: '推送中',
  PARTIAL_SUCCESS: '部分成功',
  SUCCESS: '成功',
  FAILED: '失败',
  CLOSED: '已关闭'
};

export const recordStatusLabelMap: Record<string, string> = {
  DRAFT: '草稿',
  VALIDATED: '已校验',
  PENDING_PUSH: '待推送',
  PUSHING: '推送中',
  SUCCESS: '成功',
  FAILED: '失败',
  RETRYING: '重试中',
  DUPLICATE: '重复'
};

export const pushJobStatusLabelMap: Record<string, string> = {
  PENDING: '待发送',
  SENDING: '发送中',
  SUCCESS: '成功',
  FAILED: '失败',
  RETRYING: '重试中'
};

export const originTypeLabelMap: Record<string, string> = {
  media: '媒体',
  xhs: '小红书',
  wb: '微博',
  wx: '微信',
  sph: '视频号',
  dy: '抖音',
  zh: '知乎',
  tb: '贴吧',
  other: '其他'
};

export const publisherTypeLabelMap: Record<string, string> = {
  MEDIA: '媒体',
  SOCIAL: '社交媒体'
};

export const authorTypeLabelMap: Record<string, string> = {
  BLUE_V: '认证媒体',
  SELF_MEDIA: '社交媒体',
  PERSONAL: '个人'
};

export const mediaRuleTypeLabelMap: Record<string, string> = {
  DOMAIN: '域名',
  ACCOUNT: '账号'
};

export const mediaRuleStatusLabelMap: Record<string, string> = {
  ACTIVE: '启用',
  DISABLED: '禁用'
};

export const eventCategoryLabelMap: Record<string, string> = {
  '华为竹知了事件': '华为竹知了事件',
  '叠纸敖尹上线事件': '叠纸敖尹上线事件',
  '小红书上市投诉事件': '小红书上市投诉事件',
  '雷军过早事件': '雷军过早事件'
};

export const eventCategoryList = [
  { value: '华为竹知了事件', label: '华为竹知了事件' },
  { value: '叠纸敖尹上线事件', label: '叠纸敖尹上线事件' },
  { value: '小红书上市投诉事件', label: '小红书上市投诉事件' },
  { value: '雷军过早事件', label: '雷军过早事件' }
];

export function labelOrValue(map: Record<string, string>, value: string | null | undefined) {
  if (!value) return '-';
  return map[value] ?? value;
}
