import 'dotenv/config';

const endpoint = process.env.VENDOR_API_URL ?? 'https://uat-callback-api.bilibili.cn/api/messages';
const token = process.env.VENDOR_API_TOKEN;
const versionArg = process.argv.find((arg) => arg.startsWith('--version='))?.split('=')[1]
  ?? (process.argv[process.argv.indexOf('--version') + 1] || '3');
const version = versionArg.trim() || '3';

const record = {
  url: 'https://www.toutiao.com/w/1874889452838921/',
  text: '苹果关闭哔哩哔哩充电续费！ 最近被坑了一把，我明确了就充电一回，第一次付款之后就取消续费了！结果接下来的两个月还是被扣费了！它总给我发消息，要续费了哦，不续费要关闭哦！我在哔哩哔哩反复确认关闭了续费，昨天申诉，客服给我说支付宝也需要关闭续费。这就说明什么付钱的时候你是祖宗，人家夸夸一堆链接给你跳转那你安排明白！取消付费了就不管你了，自生自灭吧！而且支付宝这端还能单方面扣费，我已经从哔哩哔哩解除扣费了呀！ 投诉半天就给我个自己问题！让我自认倒霉！发出来大家也避避雷吧！',
  title: '苹果关闭哔哩哔哩充电续费！',
  author: '数码配件馆',
  textId: 'OTHER_1b6330d49b6485862df618aa',
  viewNum: 0,
  praiseNum: 0,
  authorType: version === '3' ? 'personal' : 'PERSONAL',
  commentNum: 0,
  forwardNum: 0,
  originType: 'other',
  publishTime: '2026-08-29 20:05:00',
  ...(version === '3' ? { crawlTime: '2026-08-30T16:00:00+08:00' } : {}),
  publisherType: version === '3' ? 'media' : 'MEDIA'
};

if (!token) {
  console.error('缺少 VENDOR_API_TOKEN，请在 .env 或命令行环境变量中配置');
  process.exit(2);
}

const requestBody = { version, records: [record] };
console.log(`POST ${endpoint}`);
console.log(`协议版本: v${version}`);
console.log('请求体:');
console.log(JSON.stringify(requestBody, null, 2));

(async () => {
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(330000)
    });
    const responseText = await response.text();

    console.log(`\n响应耗时: ${Date.now() - startedAt} ms`);
    console.log(`HTTP 状态: ${response.status} ${response.statusText}`);
    console.log('响应头:');
    console.log(JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
    console.log('响应体:');
    console.log(responseText || '<empty>');

    process.exitCode = response.ok ? 0 : 1;
  } catch (error) {
    const networkError = error as Error & { cause?: unknown; code?: string };
    console.error(`\n请求失败，耗时: ${Date.now() - startedAt} ms`);
    console.error(JSON.stringify({
      name: networkError.name,
      message: networkError.message,
      code: networkError.code,
      cause: networkError.cause
    }, null, 2));
    process.exitCode = 1;
  }
})();
