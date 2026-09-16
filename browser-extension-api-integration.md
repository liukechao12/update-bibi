# 浏览器插件接入文档

## 1. 文档说明

本文档说明浏览器插件如何把复制的舆情内容提交到数据同步服务器，并由服务器完成解析、校验、去重、新增/更新、日常采集同步和客户推送。

插件只负责读取复制内容和展示结果。客户接口 Token、数据库访问、数据去重和新增/更新判断全部由服务器完成。

## 2. 推荐处理流程

```text
浏览器插件读取复制内容
        |
        v
POST /api/plugin/records
        |
        v
服务器解析和校验字段
        |
        +-- 缺少倾向性：返回 requiresTendency=true
        |
        v
按规范化链接判断是否已有数据
        |
        +-- 新链接：新增 DataRecord
        +-- 已有链接且数据变化：更新 DataRecord，状态改为 PENDING_PUSH
        +-- 已有链接且无变化：跳过
        |
        v
同步 EventRecord，事件分类为“日常采集”
        |
        v
根据历史推送状态选择客户接口
        |
        +-- 首次推送：新增接口
        +-- 已成功推送且发生变化：revisions 更新接口
        +-- 没有变化：不推送
        |
        v
返回处理结果给插件
```

## 3. 服务器地址

测试或当前服务器地址：

```text
http://36.111.148.138:4000
```

插件接口建议使用独立路径：

```text
POST http://36.111.148.138:4000/api/plugin/records
```

正式环境建议使用 HTTPS 域名：

```text
POST https://你的域名/api/plugin/records
```

> 服务端已提供独立的 `/api/plugin/records` 接口。插件不需要使用后台登录 Cookie，也不应直接调用客户接口。

## 4. 鉴权

插件请求需要携带服务器为插件分配的专用 API Key：

```http
Authorization: Bearer PLUGIN_API_KEY
```

示例：

```http
Authorization: Bearer ep_xxxxxxxxxxxxxxxxxxxx
```

插件 API Key 只允许提交数据，不应拥有以下权限：

- 修改系统配置
- 管理用户
- 删除全部数据
- 查看客户推送 Token
- 查看数据库连接信息

插件 API Key 不要和以下凭证混用：

- 客户推送 Token
- 腾讯文档 Access Token
- 管理员密码
- 数据库密码
- `JWT_SECRET`

## 5. 提交接口

### 请求

```http
POST /api/plugin/records
Authorization: Bearer PLUGIN_API_KEY
Content-Type: application/json
```

### 请求体

```json
{
  "sourceText": "【倾向性】负面\n【来源】小红书\n【作者】用户A\n【时间】2026-09-15 10:30\n【标题】示例标题\n【链接】https://www.xiaohongshu.com/discovery/item/abc123\n【摘要】示例正文\n【评论数】10\n【转发数】2\n【点赞数】20\n【阅读数】100",
  "autoPush": true,
  "eventCategory": "日常采集"
}
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `sourceText` | string | 是 | 插件复制到的原始文本，可以包含一条或多条记录 |
| `autoPush` | boolean | 否 | 是否自动推送客户，默认 `true` |
| `eventCategory` | string | 否 | 事件分类，默认 `日常采集` |
| `tendency` | string | 否 | 当原始内容缺少倾向性时，由插件选择后传入 |

## 6. 支持的文本格式

### 括号格式

```text
【倾向性】负面
【来源】小红书
【作者】用户A
【时间】2026-09-15 10:30
【标题】示例标题
【链接】https://www.xiaohongshu.com/discovery/item/abc123
【摘要】示例正文
【评论数】10
【点赞数】20
```

### 冒号格式

```text
倾向性:负面
来源:小红书
作者:用户A
时间:2026-09-15 10:30
标题:示例标题
链接:https://www.xiaohongshu.com/discovery/item/abc123
简述:示例正文
评论数:10
```

字段顺序不限制。下面这些字段名称都可以识别：

```text
简述 / 摘要
转发数 / 转发量
点赞数 / 点赞量
阅读数 / 阅读量 / 浏览量
```

## 7. 倾向性缺失处理

如果原始内容中没有倾向性，服务器返回 HTTP `422`：

```json
{
  "code": 40004,
  "message": "存在未填写倾向性的记录，请选择倾向性后继续",
  "requiresTendency": true,
  "missingFields": [],
  "rawBlocks": []
}
```

插件收到 `requiresTendency=true` 后显示选择框：

```text
负面
中性
正面
```

用户选择后，重新提交相同内容，并增加 `tendency`：

```json
{
  "sourceText": "原始复制内容",
  "tendency": "负面",
  "autoPush": true,
  "eventCategory": "日常采集"
}
```

已在原始文本中填写倾向性的记录，应保留自身值。请求体中的 `tendency` 只用于填充缺失值。

## 8. 新增、更新和跳过规则

### 新数据

如果数据库中没有相同链接：

```text
新增 DataRecord
新增 EventRecord
EventRecord.category = 日常采集
DataRecord.recordStatus = PENDING_PUSH
自动调用客户新增接口
```

### 已有数据且发生变化

服务器比较以下字段：

- 标题
- 正文/摘要
- 发布时间
- 作者
- 来源类型
- 作者类型
- 链接
- 评论数
- 转发数
- 点赞数
- 阅读数
- 倾向性

只要有一个字段变化：

```text
更新原 DataRecord
更新日常采集 EventRecord
DataRecord.recordStatus = PENDING_PUSH
进入更新推送流程
```

### 已有数据且没有变化

```text
不新增记录
不更新记录
不重复推送
返回 skipped/duplicate 结果
```

## 9. 链接唯一识别

同一内容通过规范化 URL 判断，包括：

```text
https://www.xiaohongshu.com/discovery/item/abc123
https://xiaohongshu.com/discovery/item/abc123/
https://www.xiaohongshu.com/discovery/item/abc123?source=share
```

系统会忽略：

- `www.` 差异
- URL 查询参数
- `#` 锚点
- 末尾 `/`

因此上面三条会被识别为同一条内容。

插件不需要自己生成 `textId`，也不要根据标题和时间生成 `textId`。

## 10. 客户推送规则

插件不直接调用客户接口。

服务器根据历史推送状态判断：

| 情况 | 客户接口 |
|---|---|
| 从未成功推送过 | `/api/messages` |
| 已成功推送且内容或互动数据变化 | `/api/messages/revisions` |
| 数据完全没有变化 | 不调用 |

`revision` 由客户系统生成，插件和服务器都不应该手动传入或递增 `revision`。

## 11. 成功响应

```json
{
  "code": 0,
  "message": "ok",
  "total": 1,
  "saved": 1,
  "created": 1,
  "updated": 0,
  "duplicate": 0,
  "eventSync": {
    "created": 1,
    "updated": 0
  },
  "pushed": 1,
  "pushFailed": 0,
  "savedRecordIds": [
    "cm123456789"
  ],
  "pushResults": [
    {
      "recordId": "cm123456789",
      "textId": "XHS_xxxxxxxxxxxxxxxxxxxxxxxx",
      "pushType": "CREATE",
      "success": true
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `total` | 提交的记录总数 |
| `saved` | 实际新增或更新的记录数 |
| `created` | 新增记录数 |
| `updated` | 更新记录数 |
| `duplicate` | 完全没有变化而跳过的记录数 |
| `eventSync.created` | 新增的日常采集事件数 |
| `eventSync.updated` | 更新的日常采集事件数 |
| `pushed` | 成功推送数 |
| `pushFailed` | 推送失败数 |
| `savedRecordIds` | 服务器记录 ID |
| `pushResults` | 每条记录的处理结果 |

## 12. 错误码

| HTTP 状态 | code | 说明 |
|---:|---:|---|
| 200 | 0 | 成功 |
| 401 | 40100/40101 | 缺少或无效 API Key |
| 403 | 40301/40302 | 插件被禁用或无权限 |
| 409 | 40900 | 数据正在处理中，不能重复提交 |
| 422 | 40004 | 缺少倾向性，需要插件弹窗选择 |
| 422 | 40002 | 缺少必填字段或字段格式错误 |
| 429 | 42900 | 请求频率超过限制 |
| 502 | 50200 | 客户推送接口失败 |
| 500 | 50000 | 服务器内部错误 |

示例：

```json
{
  "code": 40002,
  "message": "没有可保存的有效记录",
  "invalidRows": [
    {
      "index": 0,
      "missing": ["链接", "时间"]
    }
  ]
}
```

## 13. JavaScript 调用示例

```javascript
const API_URL = 'http://36.111.148.138:4000';
const PLUGIN_API_KEY = 'PLUGIN_API_KEY';

async function submitCopiedText(sourceText, tendency = '') {
  const body = {
    sourceText,
    autoPush: true,
    eventCategory: '日常采集'
  };

  if (tendency) body.tendency = tendency;

  const response = await fetch(`${API_URL}/api/plugin/records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PLUGIN_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();

  if (response.status === 422 && result.requiresTendency) {
    const selected = await showTendencyDialog();
    if (!selected) throw new Error('未选择倾向性');
    return submitCopiedText(sourceText, selected);
  }

  if (!response.ok) {
    throw new Error(result.message || '提交失败');
  }

  return result;
}
```

## 14. Chrome Extension Manifest V3

```json
{
  "manifest_version": 3,
  "name": "舆情数据同步插件",
  "version": "1.0.0",
  "description": "将复制的舆情内容提交到数据同步服务器",
  "permissions": [
    "storage",
    "clipboardRead",
    "notifications"
  ],
  "host_permissions": [
    "http://36.111.148.138:4000/*"
  ],
  "action": {
    "default_popup": "popup.html"
  }
}
```

正式环境改用 HTTPS 域名：

```json
{
  "host_permissions": [
    "https://data.example.com/*"
  ]
}
```

## 15. CORS 要求

服务器通过环境变量 `PLUGIN_CORS_ORIGIN` 配置允许的插件来源：

```env
PLUGIN_CORS_ORIGIN=chrome-extension://你的扩展ID
```

如果未配置，开发阶段默认返回 `*`；生产环境必须配置为实际插件 ID，不建议使用 `*`。

服务器需要允许插件来源：

```http
Access-Control-Allow-Origin: chrome-extension://你的扩展ID
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Allow-Methods: POST, OPTIONS
```

不建议使用：

```http
Access-Control-Allow-Origin: *
```

生产环境应只允许实际插件 ID。

## 16. 插件 UI 建议

插件最少包含：

- 原始内容预览
- 倾向性选择
- 提交按钮
- 新增数量
- 更新数量
- 跳过数量
- 推送成功数量
- 推送失败原因

推荐提示：

```text
新增 1 条，更新 2 条，跳过 3 条，推送成功 3 条
```

## 17. 服务端接口状态

浏览器插件正式调用以下接口：

```text
POST /api/plugin/records
OPTIONS /api/plugin/records
```

这两个接口已经在服务端实现。

其他已有接口：

```text
POST /api/records
POST /api/tencent-doc/sync
GET  /api/tencent-doc/test
POST /api/internal/tencent-doc-sync
POST /api/push/jobs
```

其中 `POST /api/records` 是后台登录态接口，插件不要直接调用。

`POST /api/plugin/records` 会复用现有粘贴录入的：

- 原始文本解析
- 字段校验
- 倾向性缺失处理
- 链接去重
- 已有数据更新
- 日常采集事件同步
- 新增/更新推送判断
- 推送日志

## 18. 创建插件 API Key

插件 API Key 使用现有“开放 API”客户凭证机制，但必须使用 `clientCode` 前缀：

```text
plugin_...
```

创建方式：

1. 管理员登录系统。
2. 打开“开放 API”。
3. 新建客户凭证。
4. `客户编码` 必须以 `plugin_` 开头，例如：

```text
plugin_browser_extension
```

5. 选择启用状态。
6. 保存后只在页面上复制一次返回的 API Key。

插件 API Key 只能调用：

```text
POST /api/plugin/records
OPTIONS /api/plugin/records
```

服务端会拒绝非 `plugin_` 前缀的开放 API Key 调用插件写入接口。

建议为不同插件或不同环境创建不同 Key，方便单独禁用和重置。

## 19. `autoPush` 行为

请求体中的 `autoPush` 默认是 `true`：

```json
{
  "sourceText": "原始复制内容",
  "autoPush": true
}
```

设置为 `true`：

```text
保存/更新成功
→ 同步日常采集
→ 自动调用客户新增或 revisions 接口
```

设置为 `false`：

```text
只保存/更新数据库
→ 同步日常采集
→ 不调用客户推送接口
```

## 20. 服务端部署

同步最新代码后执行：

```bash
npx prisma generate
npm run build
pm2 restart data-syn --update-env
pm2 save
```

本次插件接口没有新增数据库表或字段，不需要新的 Prisma migration。

如果服务器已经部署了最新开放 API 客户凭证功能，可以直接创建 `plugin_` 前缀的凭证。

## 21. 插件接口实际返回

插件接口会在原有保存结果上增加推送结果：

```json
{
  "code": 0,
  "message": "ok",
  "saved": 1,
  "created": 1,
  "updated": 0,
  "duplicate": 0,
  "pushed": 1,
  "pushFailed": 0,
  "pushResult": {
    "batchNo": "PUSH-...",
    "results": []
  }
}
```

如果 `autoPush=false`，则不会生成本次自动推送结果，插件应显示“已保存，等待人工推送”。

## 22. 安全要求

插件代码中禁止保存：

```text
客户推送 Token
腾讯文档 Access Token
腾讯文档 Client Secret
管理员密码
数据库密码
JWT_SECRET
```

插件 API Key 泄露后，应能够在后台单独禁用或重置，不影响客户推送 Token 和其他系统配置。

## 23. 联调顺序

1. 后端创建插件专用 API Key。
2. 插件调用测试环境的 `/api/plugin/records`。
3. 测试一条新链接，确认新增。
4. 相同链接修改评论数，确认更新。
5. 相同链接不修改，确认跳过。
6. 删除倾向性，确认插件弹窗选择。
7. 确认 `EventRecord.category` 为 `日常采集`。
8. 确认客户新增接口和 revisions 更新接口的推送日志。
9. 确认 CORS 和限流。
10. 联调通过后再启用自动推送。
