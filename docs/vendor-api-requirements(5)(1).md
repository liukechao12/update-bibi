# 舆情数据推送接口诉求

**版本**:v2
**日期**:2026-08-19
**接收方**:数据供应商
**发送方**:哔哩哔哩舆情监控平台团队

> ⚠️ **接口尚未上线**。本文档为接口诉求草案,供双方对齐数据结构与对接规范。正式联调时间待定,请勿向生产/UAT 地址发起真实推送。

## 更新历史

| 版本 | 日期 | 变更内容 |
|---|---|---|
| v2 | 2026-08-19 | `originType` 枚举重构为 `media`/`xhs`/`wb`/`wx`/`sph`/`dy`/`zh`/`tb`/`other`,替换 v1 的 `wb`/`wx`/`wz`/`sp`/`lt`/`app`;新增 §3.2.4 域名 → originType 映射参考(部分),并在 §3.2.4.1 明确要求**供应商提交除 `other` 外完整域名映射表**作为联调前置;新增必填字段 `publisherType`(枚举 `media`/`social`)承载发布主体身份;新增可选字段 `authorType`(枚举 `blue_v`/`self_media`/`personal`,可为 `null`)承载账号身份类型;补充 §3.2.5 双维度关系、§3.2.6 publisherType 枚举、§3.2.7 分类示例、§3.2.8 authorType 判定规则;OpenAPI schema 同步更新。 |
| v1 | 2026-07-13 | 首版接口诉求草案;定义批量推送结构、`MonitorData` 字段、6 值 `originType` 枚举(`wb`/`wx`/`wz`/`sp`/`lt`/`app`)、SLA、错误码、OpenAPI 规范。 |

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
| 接口地址(UAT) | `POST https://uat-callback-api.bilibili.cn/api/messages` |
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
| `originType` | `string` | 是 | 来源平台(平台维度),见 §3.2.3 枚举 |
| `publisherType` | `string` | 是 | 发布主体身份(媒体/社交媒体),见 §3.2.6 枚举 |
| `authorType` | `string \| null` | 否 | 发布者账号类型(蓝V/自媒体/个人),见 §3.2.8 枚举。未采集时 `null` |
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

| 值 | 含义 | 说明 |
|---|---|---|
| `media` | 媒体 | 网站、新闻客户端、财经/门户/地方媒体等**官方渠道**;含无独立枚举的自媒体聚合(头条、懂车帝、东方财富等) |
| `xhs` | 小红书 | 小红书笔记/评论 |
| `wb` | 微博 | 微博正文/转发/评论 |
| `wx` | 微信 | 微信公众号图文 |
| `sph` | 视频号 | 微信视频号内容 |
| `dy` | 抖音 | 抖音短视频/直播 |
| `zh` | 知乎 | 知乎问答/文章/专栏 |
| `tb` | 百度贴吧 | 贴吧主题/回帖 |
| `other` | 其他网站 | 上述都不属于且非主流媒体渠道时使用 |

> 归属优先级:垂直平台 (`xhs`/`wb`/`wx`/`sph`/`dy`/`zh`/`tb`) > `media` > `other`。已有垂直枚举的平台**必须**走垂直枚举,不允许塞进 `media` 或 `other`。
>
> 遇到不在枚举内的新平台,先向我方对齐后再新增取值,禁止自行扩展。

#### 3.2.4 域名 → originType 映射参考(**部分**)

> ⚠️ **本清单仅为部分参考**,基于历史推送数据抽样整理,**远非穷举**。供应商侧的采集域名池明显大于该清单,需按下方"§3.2.4.1 供应商需提交映射表"提交完整版本作为联调前置条件。

| originType | 常见域名 |
|---|---|
| `wb` | `weibo.com` / `m.weibo.cn` / `video.weibo.com` |
| `wx` | `mp.weixin.qq.com` |
| `sph` | `channels.weixin.qq.com` |
| `dy` | `douyin.com` / `iesdouyin.com` |
| `xhs` | `xiaohongshu.com` / `xhslink.cn` |
| `zh` | `zhihu.com` / `zhuanlan.zhihu.com` |
| `tb` | `tieba.baidu.com` |
| `media` | `toutiao.com` / `mbd.baidu.com` / `news.qq.com` / `new.qq.com` / `sohu.com` / `3g.k.sohu.com` / `m.sohu.com` / `c.m.163.com` / `finance.sina.com.cn` / `finance.sina.cn` / `k.sina.cn` / `cj.sina.com.cn` / `finance.eastmoney.com` / `caifuhao.eastmoney.com` / `xueqiu.com` / `gu.qq.com` / `hk.stockstar.com` / 官方新闻/财经/地方媒体网站 |
| `other` | `miyoushe.com` / `gamersky.com` / 其他不属于以上类别的站点 |

##### 3.2.4.1 供应商需提交完整映射表

**联调前置动作**:供应商需向我方提交一份**除 `other` 之外**、所有采集域名到 `originType` 的完整映射表。目的是:

1. 消除 `wz` 曾长期作为"兜底桶"导致的归属串档(小红书/抖音/贴吧/头条混入其他 originType)。
2. 让下游 AI 分析和统计口径可预期——同一域名在所有推送中稳定归入同一 originType。
3. 让 `other` 的**范围有明确边界**——凡是不在提交映射表内的域名,推送侧默认归入 `other`,不再靠推送方临场判断。

**提交要求**:

| 项目 | 要求 |
|---|---|
| 覆盖范围 | 供应商采集域名池中,**除 `other` 之外**的所有域名(即所有归入 `media`/`xhs`/`wb`/`wx`/`sph`/`dy`/`zh` 的域名) |
| 提交格式 | CSV 或 JSON,每行/每条记录包含 `domain` 与 `originType` 两列 |
| 域名规范 | 主域或子域均可,统一小写、去掉 `www.` 前缀;子域粒度需能唯一确定 originType(如 `finance.sina.com.cn` 与 `sports.sina.com.cn` 可能不同) |
| 更新机制 | 采集域名池新增时,供应商需**在推送前**更新映射表并同步我方,否则相关内容按 `other` 推送 |
| 提交时机 | 正式联调启动前 |

**格式示例(CSV)**:

```csv
domain,originType
weibo.com,wb
m.weibo.cn,wb
mp.weixin.qq.com,wx
channels.weixin.qq.com,sph
douyin.com,dy
iesdouyin.com,dy
xiaohongshu.com,xhs
zhihu.com,zh
news.qq.com,media
finance.sina.com.cn,media
...
```

**格式示例(JSON)**:

```json
{
  "version": "2026-08-19",
  "mappings": [
    { "domain": "weibo.com", "originType": "wb" },
    { "domain": "mp.weixin.qq.com", "originType": "wx" },
    { "domain": "channels.weixin.qq.com", "originType": "sph" }
  ]
}
```

> `other` 类不需要在映射表中列出——凡是未列入表中的域名,推送时一律使用 `other`。

#### 3.2.5 originType 与 publisherType 的关系

`originType` 承载**平台维度**(内容在哪个平台上发布),`publisherType` 承载**主体维度**(谁在发布)。二者正交,共同决定一条内容在监控体系中的位置:

- 同一平台下的内容既可能是媒体也可能是社交媒体。例如 `originType=wb` 的内容,若来自 @人民日报 认证账号则 `publisherType=media`,若来自普通用户则 `publisherType=social`。
- `originType=media`(独立门户/新闻网站等) 的 `publisherType` **必须为** `media`。
- `originType=xhs`(小红书) 的 `publisherType` **必须为** `social`——小红书的高危属性通过 `originType` 独立识别,不再在此重复。

#### 3.2.6 publisherType 枚举

| 值 | 含义 | 覆盖范围 |
|---|---|---|
| `media` | 媒体 | 认证媒体账号、官方新闻网站/客户端、政府/机构/品牌方**认证发布主体** |
| `social` | 社交媒体 | 普通用户、大 V、自媒体账号等**非认证机构主体**的 UGC 内容 |

**判定规则**:

1. 按**发布主体身份**判断,不按域名。同一 `weibo.com` 的内容既可能是 `media` 也可能是 `social`。
2. `originType=media` → 恒为 `publisherType=media`(平台本身即媒体属性)。
3. `originType=xhs` → 恒为 `publisherType=social`。
4. `originType` 属于社交平台(`wb`/`wx`/`sph`/`dy`/`zh`/`tb`)时,按 `author` 账号身份判定:
   - 认证媒体/机构/政府/品牌官方账号 → `media`
   - 个人用户、大 V、自媒体号 → `social`
5. `originType=other`(游戏社区、非主流站点等)默认 `publisherType=social`,除非能明确判定为认证媒体。

#### 3.2.7 分类示例

| 场景 | originType | publisherType | authorType | 说明 |
|---|---|---|---|---|
| @人民日报 微博 | `wb` | `media` | `blue_v` | 认证媒体蓝V |
| @某财经博主(认证自媒体) | `wb` | `social` | `self_media` | 自媒体大 V |
| 普通用户微博 | `wb` | `social` | `personal` | 个人 UGC |
| 央视新闻公众号推文 | `wx` | `media` | `blue_v` | 官方媒体公众号 |
| 个人自媒体公众号 | `wx` | `social` | `self_media` | 自媒体主体 |
| 央视新闻抖音号 | `dy` | `media` | `blue_v` | 认证媒体账号 |
| 普通用户抖音短视频 | `dy` | `social` | `personal` | 个人 UGC |
| 抖音自媒体账号 | `dy` | `social` | `self_media` | 自媒体 |
| 财新网新闻稿 | `media` | `media` | `blue_v` | 门户网站 |
| 知乎问答/回答 | `zh` | `social` | `personal` | 用户 UGC |
| 小红书笔记 | `xhs` | `social` | `personal` | 全量归入 |
| 百度贴吧发帖 | `tb` | `social` | `personal` | 贴吧 UGC |

#### 3.2.8 authorType 枚举

单选枚举,承载账号身份类型(细化 `publisherType`):

| 值 | 含义 |
|---|---|
| `blue_v` | 认证媒体账号(微博媒体蓝V、微信官方媒体号、抖音蓝V媒体等);传统主流媒体、政府机构、认证品牌方均归此类 |
| `self_media` | 自媒体账号(微博橙V、微信自媒体公众号、抖音企业号、财经博主等非传统媒体内容号) |
| `personal` | 个人账号(普通用户、无认证/无内容号属性) |

**判定规则**:

1. 单选,三值互斥。
2. `publisherType=media` → 恒为 `authorType=blue_v`(媒体渠道即认证主体)。
3. `publisherType=social` → 在 `blue_v` / `self_media` / `personal` 中按账号身份择一。
4. `originType=xhs` 的内容默认 `authorType=personal`(小红书生态无传统蓝V/自媒体划分,如后续需要区分博主/品牌号再扩枚举)。
5. 未采集或无法判定时用 `null`,不用 `personal` 兜底(与"未采集用 null"规范一致)。

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
      "publisherType": "social",
      "authorType": "self_media",
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
    "version": "2.0.0",
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
          "textId", "title", "text", "publishTime", "author", "originType", "publisherType", "url",
          "commentNum"
        ],
        "properties": {
          "textId": { "type": "string" },
          "title": { "type": "string" },
          "text": { "type": "string" },
          "publishTime": { "type": "string", "example": "2026-07-13 20:15:00" },
          "author": { "type": "string" },
          "originType": { "type": "string", "enum": ["media", "xhs", "wb", "wx", "sph", "dy", "zh", "tb", "other"] },
          "publisherType": { "type": "string", "enum": ["media", "social"] },
          "authorType": { "type": ["string", "null"], "enum": ["blue_v", "self_media", "personal", null] },
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
