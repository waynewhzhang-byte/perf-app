// 阿里云短信发送（HMAC-SHA1 POPv3 签名）
import crypto from 'crypto';

export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
}

function popEncode(s: string) {
  return encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
}

export async function sendAliyunSms(
  cfg: AliyunSmsConfig,
  phone: string,
  templateParam: Record<string, string>,
): Promise<void> {
  const params: Record<string, string> = {
    AccessKeyId: cfg.accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    SignName: cfg.signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: cfg.templateCode,
    TemplateParam: JSON.stringify(templateParam),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };

  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${popEncode(k)}=${popEncode(params[k])}`)
    .join('&');
  const stringToSign = `POST&${popEncode('/')}&${popEncode(canonical)}`;
  const signature = crypto
    .createHmac('sha1', cfg.accessKeySecret + '&')
    .update(stringToSign)
    .digest('base64');

  const body = `Signature=${popEncode(signature)}&${canonical}`;
  const endpoint = process.env.ALIYUN_SMS_ENDPOINT || 'https://dysmsapi.aliyuncs.com/';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as { Code?: string; Message?: string };
  if (json.Code !== 'OK') {
    throw new Error(`阿里云短信发送失败：${json.Message || json.Code}`);
  }
}
