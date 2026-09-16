export type TencentDocConfig = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  openId: string;
  refreshToken: string;
  fileId: string;
  redirectUri: string;
};

export async function getTencentDocConfig(): Promise<TencentDocConfig> {
  return {
    clientId: process.env.TENCENT_DOC_CLIENT_ID || '',
    clientSecret: process.env.TENCENT_DOC_CLIENT_SECRET || '',
    accessToken: process.env.TENCENT_DOC_ACCESS_TOKEN || '',
    openId: process.env.TENCENT_DOC_OPEN_ID || '',
    refreshToken: process.env.TENCENT_DOC_REFRESH_TOKEN || '',
    fileId: process.env.TENCENT_DOC_FILE_ID || '',
    redirectUri: process.env.TENCENT_DOC_REDIRECT_URI || ''
  };
}

function apiHeaders(config: TencentDocConfig) {
  return {
    Accept: 'application/json',
    'Client-Id': config.clientId,
    'Open-Id': config.openId,
    'Access-Token': config.accessToken
  };
}

export async function getTencentDocSheets() {
  const config = await getTencentDocConfig();
  if (!config.accessToken) throw new Error('未配置 TENCENT_DOC_ACCESS_TOKEN');
  if (!config.clientId) throw new Error('未配置 TENCENT_DOC_CLIENT_ID');
  if (!config.openId) throw new Error('未配置 TENCENT_DOC_OPEN_ID');
  if (!config.fileId) throw new Error('未配置 TENCENT_DOC_FILE_ID');

  const response = await fetch(`https://docs.qq.com/openapi/spreadsheet/v3/files/${encodeURIComponent(config.fileId)}?concise=1`, {
    method: 'GET',
    headers: apiHeaders(config),
    cache: 'no-store'
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.msg === 'string' ? body.msg : `HTTP ${response.status}`;
    throw new Error(`腾讯文档工作表查询失败：${message}`);
  }
  return body;
}

export async function getTencentDocSheetData(sheetId: string, range: string) {
  const config = await getTencentDocConfig();
  if (!config.accessToken) throw new Error('未配置 TENCENT_DOC_ACCESS_TOKEN');
  if (!config.clientId) throw new Error('未配置 TENCENT_DOC_CLIENT_ID');
  if (!config.openId) throw new Error('未配置 TENCENT_DOC_OPEN_ID');
  if (!config.fileId) throw new Error('未配置 TENCENT_DOC_FILE_ID');

  const response = await fetch(`https://docs.qq.com/openapi/spreadsheet/v3/files/${encodeURIComponent(config.fileId)}/${encodeURIComponent(sheetId)}/${encodeURIComponent(range)}`, {
    method: 'GET',
    headers: apiHeaders(config),
    cache: 'no-store'
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.msg === 'string' ? body.msg : `HTTP ${response.status}`;
    throw new Error(`腾讯文档表格数据查询失败：${message}`);
  }
  return body;
}

export function redactTencentDocConfig(config: TencentDocConfig) {
  return {
    clientId: config.clientId ? '已配置' : '未配置',
    clientSecret: config.clientSecret ? '已配置' : '未配置',
    accessToken: config.accessToken ? '已配置' : '未配置',
    openId: config.openId ? '已配置' : '未配置',
    refreshToken: config.refreshToken ? '已配置' : '未配置',
    fileId: config.fileId ? config.fileId : '未配置',
    redirectUri: config.redirectUri ? config.redirectUri : '未配置'
  };
}
