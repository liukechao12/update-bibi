import { uploadLocalImageToVendor } from '../src/lib/image-service';
import * as fs from 'fs/promises';
import * as path from 'path';

async function testUpload() {
  console.log('开始测试图片上传...\n');

  // 使用已有的截图文件
  const imagePath = '/Users/xuhao/数据同步程序/data/screenshots/cmuf07eh200907doe8yohi8yq/1792052111531.png';
  
  // 检查文件是否存在
  try {
    await fs.access(imagePath);
  } catch {
    console.error('文件不存在:', imagePath);
    return;
  }
  console.log('上传图片:', imagePath);

  try {
    const result = await uploadLocalImageToVendor(imagePath, 'image/png');
    console.log('\n上传成功!');
    console.log('返回结果:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n上传失败:', error instanceof Error ? error.message : error);
  }
}

testUpload();
