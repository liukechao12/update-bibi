import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const VENDOR_API_BASE_URL = 'https://uat-magi.bilibili.co/api';
const VENDOR_API_TOKEN = 'E419A84F-7BA5-4199-A295-20524B6BFB84';

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

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${VENDOR_API_TOKEN}`
    },
    body
  });

  console.log('响应状态:', response.status);
  const responseText = await response.text();
  console.log('响应内容:', responseText);

  try {
    const result = JSON.parse(responseText);
    console.log('解析后的 URL:', result.url);
    console.log('解析后的 sha256:', result.sha256);
  } catch (e) {
    console.log('JSON 解析失败');
  }
}

testUpload().catch(console.error);
