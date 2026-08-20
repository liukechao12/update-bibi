# 舆情数据推送接口诉求

**版本**:v1
**日期**:2026-07-13
**接收方**:数据供应商
**发送方**:哔哩哔哩舆情监控平台团队

> ⚠️ **接口尚未上线**。本文档为接口诉求草案,供双方对齐数据结构与对接规范。正式联调时间待定,请勿向生产/UAT 地址发起真实推送。

---

## 一、概述

我方系统通过一个 HTTP 接口接收供应商推送的舆情监控数据,持久化后进行 AI 分析。

- **推送范围**:与供应商推送到企微群的信息保持一致(镜像),不额外新增采集口径,也不新增筛选标准。
- **数据形态**:每条内容独立成一条记录,以 `textId` 去重。

---

## 二、接口规范

### 2.1 基本信息

| 项目 | 说明 |
|---|---|
| 接口地址(生产) | `POST https://magi.bilibili.co/api/messages` |
| 接口地址(UAT) | `POST https://uat-magi.bilibili.co/api/messages` |
| 请求方式 | HTTP POST |
| Content-Type | `application/json` |
| 字符编码 | UTF-8 |
| 认证方式 | Bearer Token,请求头 `Authorization: Bearer <token>` |

### 2.2 推送 SLA

| 指标 | 要求 |
|---|---|
| 端到端延迟(内容发布 → 推送至我方接口) | P50 ≤ 15 分钟,P99 ≤ 30 分钟 |
| 推送间隔 | 采集到数据后 5 分钟内完成推送,不得因批量积压延迟 |
| 单次批量大小 | 每批 ≤ 100 条;超出拆分为多次请求 |
| 突发流量 | 热点事件期间延迟不得超过常规 P99 的 2 倍,不得丢弃数据 |

每条记录独立处理,部分失败不影响其他记录入库。

---

## 三、请求参数

### 3.1 顶层结构

```json
{
  "version": "1",
  "records": [ <MonitorData>, ... ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | `string` | 否 | 协议版本号,当前为 `"1"` |
| `records` | `MonitorData[]` | 是 | 监控数据数组,至少 1 条,至多 100 条 |

---

### 3.2 MonitorData(内容主体)

#### 3.2.1 基本信息

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `textId` | `string` | 是 | 内容唯一标识,用于去重 |
| `title` | `string` | 是 | 标题 |
| `text` | `string` | 是 | 正文内容(AI 分析主要输入,必须完整) |
| `publishTime` | `string` | 是 | 发布时间,格式 `"YYYY-MM-DD HH:mm:ss"` |
| `author` | `string` | 是 | 作者账号名 |
| `originType` | `string` | 是 | 来源平台,见 §3.2.3 枚举 |
| `url` | `string` | 是 | 原文链接,需为可访问的有效 URL |

#### 3.2.2 传播数据

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `commentNum` | `number` | 是 | 评论数 |
| `forwardNum` | `number \| null` | 否 | 转发数,未采集时 `null` |
| `praiseNum` | `number \| null` | 否 | 点赞数,未采集时 `null` |
| `viewNum` | `number \| null` | 否 | 阅读量,未采集时 `null` |

> **空值规范**:字段未采集或不适用一律使用 `null`;真实零值才使用 `0`。避免 `0` / `""` / `null` 混用。

#### 3.2.3 来源平台枚举

`originType` 取值:

| 值 | 含义 |
|---|---|
| `wb` | 微博 |
| `wx` | 微信 |
| `wz` | 网站/新闻 |
| `sp` | 视频/短视频 |
| `lt` | 论坛/贴吧/问答 |
| `app` | App/自媒体(今日头条、懂车帝等) |

> 遇到不在枚举内的新平台,先向我方对齐后再新增取值,禁止自行扩展。

---

## 四、响应参数

### 4.1 成功响应(HTTP 200)

```json
{
  "inserted": 3,
  "failed": 1,
  "errors": [
    { "index": 2, "error": "duplicate key" }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `inserted` | `number` | 成功入库的记录数 |
| `failed` | `number` | 入库失败的记录数 |
| `errors` | `array` | 失败详情列表(可为空数组) |
| `errors[].index` | `number` | 失败记录在 `records` 数组中的下标(0-based) |
| `errors[].error` | `string` | 失败原因描述 |

### 4.2 错误响应

统一格式:

```json
{
  "code": 40001,
  "message": "字段 records[0].textId 不能为空"
}
```

| HTTP 状态码 | 业务错误码 | 场景 | 处理建议 |
|---|---|---|---|
| `400` | `40001` | 请求体 JSON 格式非法 | 检查序列化逻辑,修复后重推 |
| `400` | `40002` | 必填字段缺失或类型错误 | 检查字段,修复后重推 |
| `400` | `40003` | `records` 为空数组 | 不推送空批次 |
| `400` | `40004` | 单批超过 100 条 | 拆分后重推 |
| `401` | `40100` | Token 缺失 | 补充 `Authorization` 请求头 |
| `401` | `40101` | Token 无效或已过期 | 刷新 Token 后重推 |
| `429` | `42900` | 推送频率超限 | 按响应头 `Retry-After` 等待后重推 |
| `500` | `50000` | 服务器内部错误 | 指数退避重试,持续失败请联系我方 |
| `503` | `50300` | 服务暂时不可用 | 指数退避重试 |

> **重试策略**:`5xx` 错误按指数退避重试(初始间隔 5s,最大间隔 5min),重试次数 ≤ 5。`4xx` 除 `429` 外不应重试,需修复数据后重推。

---

## 五、请求示例

```json
{
  "version": "1",
  "records": [
    {
      "textId": "wb_5031234567890",
      "title": "某up主直播事故引发热议",
      "text": "某up主昨晚直播过程中出现......",
      "publishTime": "2026-07-13 20:15:00",
      "author": "娱乐观察员",
      "originType": "wb",
      "url": "https://weibo.com/1234567890/xxxxxx",
      "forwardNum": 128,
      "commentNum": 542,
      "praiseNum": 1289,
      "viewNum": 152000
    }
  ]
}
```

---

## 六、OpenAPI 规范

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "舆情数据推送接口",
    "version": "1.0.0",
    "license": {
      "name": "Proprietary — Bilibili Internal",
      "identifier": "LicenseRef-Bilibili-Internal"
    }
  },
  "servers": [
    { "url": "https://magi.bilibili.co/api", "description": "生产环境" },
    { "url": "https://uat-magi.bilibili.co/api", "description": "UAT 环境" }
  ],
  "paths": {
    "/messages": {
      "post": {
        "operationId": "pushMessages",
        "summary": "批量推送舆情监控数据",
        "security": [{ "bearerAuth": [] }],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/PushRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "处理完成(含部分失败)",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/PushResponse" }
              }
            }
          },
          "400": { "description": "请求体非法或字段错误" },
          "401": { "description": "认证失败" },
          "429": { "description": "推送频率超限" },
          "500": { "description": "服务器内部错误" }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": { "type": "http", "scheme": "bearer" }
    },
    "schemas": {
      "PushRequest": {
        "type": "object",
        "required": ["records"],
        "properties": {
          "version": { "type": "string", "example": "1" },
          "records": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "items": { "$ref": "#/components/schemas/MonitorData" }
          }
        }
      },
      "PushResponse": {
        "type": "object",
        "required": ["inserted", "failed", "errors"],
        "properties": {
          "inserted": { "type": "integer" },
          "failed": { "type": "integer" },
          "errors": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["index", "error"],
              "properties": {
                "index": { "type": "integer" },
                "error": { "type": "string" }
              }
            }
          }
        }
      },
      "MonitorData": {
        "type": "object",
        "required": [
          "textId", "title", "text", "publishTime", "author", "originType", "url",
          "commentNum"
        ],
        "properties": {
          "textId": { "type": "string" },
          "title": { "type": "string" },
          "text": { "type": "string" },
          "publishTime": { "type": "string", "example": "2026-07-13 20:15:00" },
          "author": { "type": "string" },
          "originType": { "type": "string", "enum": ["wb", "wx", "wz", "sp", "lt", "app"] },
          "url": { "type": "string", "format": "uri" },
          "commentNum": { "type": "integer", "minimum": 0 },
          "forwardNum": { "type": ["integer", "null"], "minimum": 0 },
          "praiseNum": { "type": ["integer", "null"], "minimum": 0 },
          "viewNum": { "type": ["integer", "null"], "minimum": 0 }
        }
      }
    }
  }
}
```
