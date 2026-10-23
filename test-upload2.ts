import fs from 'fs/promises';
import path from 'path';

const VENDOR_API_BASE_URL = process.env.VENDOR_API_BASE_URL || 'https://uat-magi.bilibili.co/api';
const VENDOR_API_TOKEN = process.env.VENDOR_API_TOKEN || 'E419A84F-7BA5-4199-A295-20524B6BFB84';

async function testUpload() {
  // 创建一个测试图片（1x1 像素 PNG）
  const testImage = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
  const bodyParts = [];

  bodyParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="test.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  ));
  bodyParts.push(testImage);
  bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(bodyParts);

  const uploadUrl = `${VENDOR_API_BASE_URL}/messages/images`;
  console.log('上传到:', uploadUrl);
  console.log('Token:', VENDOR_API_TOKEN.substring(0, 10) + '...');

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Authorization: `Bearer ${VENDOR_API_TOKEN}`
      },
      body
    });

    console.log('响应状态:', response.status);
    console.log('响应头:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('响应内容:', responseText);

    try {
      const result = JSON.parse(responseText);
      console.log('\n解析结果:');
      console.log('  URL:', result.url);
      console.log('  SHA256:', result.sha256);
      console.log('  完整对象:', JSON.stringify(result, null, 2));
    } catch (e) {
      console.log('JSON 解析失败，可能是 HTML 错误页面');
    }
  } catch (error) {
    console.error('请求失败:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && 'cause' in error && error.cause instanceof Error) {
      console.error('原因:', error.cause.message);
    }
  }
}

testUpload();
