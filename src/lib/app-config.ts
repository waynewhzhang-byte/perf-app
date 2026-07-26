import { prisma } from '@/lib/prisma';

/** 强制阅读弹窗默认文案（与需求 R1 一致，年份按当前申报年度）。 */
export const DEFAULT_DECLARATION_NOTICE_TEXT = `为确保公司 2026 年能级评价量化积分填报工作的严肃性、准确性和保密性，请注意以下事项：

一、认真如实填报

请本着对公司和本人负责的态度，仔细阅读填报说明，结合本人实际情况逐项核对，确保信息真实、完整、准确。对于评价内容有任何疑问，请及时与相关部门沟通确认。

二、严格遵守保密规定

本平台所填报的量化积分信息属于公司内部敏感信息，请严格遵守保密纪律，严禁向无关人员透露，严禁截图转发、外传或以其他任何形式泄露给第三方。

三、相关后果

如发现漏报、瞒报、虚报或泄露相关信息，公司将依据有关规定追究相应责任。

感谢您的理解与配合！让我们共同维护能级评价工作的规范性和安全性。`;

export const DEFAULT_NOTICE_SECONDS = 30;

export const HOME_NOTICE_TITLE_MAX = 100;
export const HOME_NOTICE_BODY_MAX = 5000;

export type AppConfigPublic = {
  supportPhone: string;
  noticeText: string;
  noticeSeconds: number;
  noticeRevision: string;
  homeNoticeTitle: string;
  homeNoticeBody: string;
};

export const DEFAULT_APP_CONFIG: AppConfigPublic = {
  supportPhone: '',
  noticeText: DEFAULT_DECLARATION_NOTICE_TEXT,
  noticeSeconds: DEFAULT_NOTICE_SECONDS,
  noticeRevision: 'default',
  homeNoticeTitle: '',
  homeNoticeBody: '',
};

/** 用于客户端判断是否需要重新确认（仅声明弹窗文案/秒数参与；不含 updatedAt，避免首页提示保存误触发重读）。 */
export function buildNoticeRevision(
  noticeText: string,
  noticeSeconds: number,
  _updatedAt?: Date | null,
): string {
  void _updatedAt;
  let hash = 0;
  const payload = `${noticeText}\n${noticeSeconds}`;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) - hash) + payload.charCodeAt(i);
    hash |= 0;
  }
  return `v1:${hash}`;
}

/** 正文 trim 后非空才在员工首页展示提示区。 */
export function shouldShowHomeNotice(body: string): boolean {
  return body.trim().length > 0;
}

export function normalizeHomeNotice(title: string, body: string): {
  homeNoticeTitle: string;
  homeNoticeBody: string;
} {
  return {
    homeNoticeTitle: title.trim(),
    homeNoticeBody: body.trim(),
  };
}

export async function getAppConfig(): Promise<AppConfigPublic> {
  const row = await prisma.appConfig.findUnique({ where: { id: 1 } });
  if (!row) return { ...DEFAULT_APP_CONFIG };
  const noticeText = row.noticeText.trim() || DEFAULT_DECLARATION_NOTICE_TEXT;
  const noticeSeconds = row.noticeSeconds > 0 ? row.noticeSeconds : DEFAULT_NOTICE_SECONDS;
  const home = normalizeHomeNotice(row.homeNoticeTitle ?? '', row.homeNoticeBody ?? '');
  return {
    supportPhone: row.supportPhone.trim(),
    noticeText,
    noticeSeconds,
    noticeRevision: buildNoticeRevision(noticeText, noticeSeconds, row.updatedAt),
    ...home,
  };
}

export const NOTICE_ACK_STORAGE_PREFIX = 'perf_declaration_notice_ack:';
