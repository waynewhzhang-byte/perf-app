import { PrismaClient, AppRole, TemplateStatus, NotifyChannel } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

async function main() {
  console.log('🌱 开始填充种子数据...\n');

  // ============================================================
  // 1. 清理已有数据（按依赖顺序）
  // ============================================================
  console.log('🧹 清理已有数据...');
  await prisma.reviewLog.deleteMany();
  await prisma.submissionOptionReview.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.submissionItem.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.performanceRecord.deleteMany();
  await prisma.formOptionReviewer.deleteMany();
  await prisma.formItem.deleteMany();
  await prisma.formSection.deleteMany();
  await prisma.formTemplate.deleteMany();
  await prisma.autoReviewRule.deleteMany();
  await prisma.declarationSpecialty.deleteMany();
  await prisma.declarationLevel.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employeeLevel.deleteMany();
  await prisma.jobType.deleteMany();
  await prisma.position.deleteMany();
  await prisma.department.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.verifyCode.deleteMany();
  await prisma.notifyConfig.deleteMany();
  await prisma.authConfig.deleteMany();
  console.log('✅ 清理完成\n');

  // ============================================================
  // 2. 通知渠道配置（系统单例）
  // ============================================================
  console.log('📧 创建通知渠道配置...');
  await prisma.notifyConfig.create({
    data: {
      id: 1,
      channel: NotifyChannel.EMAIL,
      configCipher: JSON.stringify({ host: 'smtp.example.com', port: 465, secure: true, user: 'noreply@powergrid.com.cn', pass: '***', from: 'noreply@powergrid.com.cn' }),
      updatedBy: 'seed',
    },
  });

  await prisma.authConfig.create({
    data: {
      id: 1,
      registerRequiresVerification: false, // 开发测试环境关闭验证码
      loginRequiresVerification: false,
      resetRequiresVerification: false,
      enforceStrongPassword: false,        // 开发测试环境允许简单密码
      updatedBy: 'seed',
    },
  });
  console.log('✅ 配置完成\n');

  // ============================================================
  // 3. 组织架构 —— 分公司
  // ============================================================
  console.log('🏢 创建组织架构（电力行业规范）...');

  const branchData = [
    { name: '国网华北分部', code: 'NC-HB' },
    { name: '国网华东分部', code: 'NC-HD' },
    { name: '国网华中分部', code: 'NC-HZ' },
    { name: '国网东北分部', code: 'NC-DB' },
    { name: '国网西北分部', code: 'NC-XB' },
    { name: '国网西南分部', code: 'NC-XN' },
    { name: '公司总部',      code: 'NC-HQ' },
  ];

  const branches: Record<string, string> = {};
  for (const b of branchData) {
    const branch = await prisma.branch.create({ data: b });
    branches[b.name] = branch.id;
  }
  console.log(`  ✓ ${branchData.length} 个分公司/分部`);

  // ============================================================
  // 4. 组织架构 —— 部门
  // ============================================================
  const deptNames = [
    '变电运检中心',
    '输配电运检中心',
    '调度控制中心',
    '安全监察部',
    '市场营销部',
    '人力资源部',
    '财务管理部',
    '信息通信中心',
  ];

  const departments: Record<string, Record<string, string>> = {};
  for (const [branchName, branchId] of Object.entries(branches)) {
    departments[branchName] = {};
    for (const deptName of deptNames) {
      const dept = await prisma.department.create({
        data: { branchId, name: deptName },
      });
      departments[branchName][deptName] = dept.id;
    }
  }
  console.log(`  ✓ ${Object.keys(branches).length * deptNames.length} 个部门`);

  // ============================================================
  // 5. 组织架构 —— 岗位
  // ============================================================
  const positionNames = [
    '变电运行值班员',
    '继电保护专责工',
    '变电检修工',
    '输电线路运检工',
    '配电运检工',
    '电力调度员',
    '安全监察专责',
    '营销服务专责',
    '人力资源专责',
    '财务核算专责',
    '信息运维专责',
  ];

  const positions: Record<string, string> = {};
  for (const name of positionNames) {
    const pos = await prisma.position.create({ data: { name } });
    positions[name] = pos.id;
  }
  console.log(`  ✓ ${positionNames.length} 个岗位`);

  // ============================================================
  // 6. 组织架构 —— 工种
  // ============================================================
  const jobTypeNames = [
    '变电运行',
    '变电检修',
    '继电保护',
    '输电运检',
    '配电运检',
    '调度运行',
    '安全监察',
    '电力营销',
    '人力资源',
    '财务管理',
    '信息通信',
  ];

  const jobTypes: Record<string, string> = {};
  for (const name of jobTypeNames) {
    const jt = await prisma.jobType.create({ data: { name } });
    jobTypes[name] = jt.id;
  }
  console.log(`  ✓ ${jobTypeNames.length} 个工种`);

  // ============================================================
  // 7. 组织架构 —— 员工等级
  // ============================================================
  const levelNames = [
    '初级工',
    '中级工',
    '高级工',
    '技师',
    '高级技师',
    '助理工程师',
    '工程师',
    '高级工程师',
    '正高级工程师',
  ];

  const levels: Record<string, string> = {};
  for (const name of levelNames) {
    const lv = await prisma.employeeLevel.create({ data: { name } });
    levels[name] = lv.id;
  }
  console.log(`  ✓ ${levelNames.length} 个员工等级`);

  const declarationLevelNames = ['1级', '2级', '3级'];
  const declarationLevels: Record<string, string> = {};
  for (const [idx, name] of declarationLevelNames.entries()) {
    const level = await prisma.declarationLevel.create({ data: { name, sortOrder: idx } });
    declarationLevels[name] = level.id;
  }
  console.log(`  ✓ ${declarationLevelNames.length} 个能级评价申报等级`);

  const declarationSpecialtyNames = ['输电运检', '变电运检', '继电保护', '调度运行', '营销服务'];
  for (const [idx, name] of declarationSpecialtyNames.entries()) {
    await prisma.declarationSpecialty.create({ data: { name, sortOrder: idx } });
  }
  console.log(`  ✓ ${declarationSpecialtyNames.length} 个能级评价申报专业`);

  await prisma.autoReviewRule.create({
    data: {
      name: '工作年限满5年未满8年只能申报2级',
      enabled: true,
      minWorkYears: 5,
      maxWorkYears: 8,
      allowedLevelIds: [declarationLevels['2级']],
      rejectMessage: '工作年限满5年未满8年时，只能申报2级；如需申报其他等级，请确认入职时间或调整申报等级。',
    },
  });
  console.log('  ✓ 自动预审示例规则：5年以上8年以下只能申报2级');
  console.log('✅ 组织架构创建完成\n');

  // ============================================================
  // 8. 用户 —— 密码统一为 Test1234!
  // ============================================================
  console.log('👥 创建用户...');
  const pwdHash = await hashPassword('Test1234!');

  // ----- 管理员 -----
  await prisma.user.create({
    data: {
      contact: 'admin@powergrid.com.cn',
      passwordHash: pwdHash,
      fullName: '系统管理员',
      employeeNo: 'HQ-ADMIN-001',
      branchId: branches['公司总部'],
      positionId: positions['人力资源专责'],
      jobTypeId: jobTypes['人力资源'],
      employeeLevelId: levels['高级工程师'],
      roles: {
        create: { role: AppRole.ADMIN },
      },
    },
  });
  console.log('  ✓ 管理员 (ADMIN): admin@powergrid.com.cn');

  // ----- L2 审核员（总公司，不限分公司） -----
  const l2Reviewers = [
    { contact: 'reviewer-l2-zhang@powergrid.com.cn', fullName: '张总审', employeeNo: 'HQ-L2-001' },
    { contact: 'reviewer-l2-wang@powergrid.com.cn',  fullName: '王总监', employeeNo: 'HQ-L2-002' },
  ];
  for (const u of l2Reviewers) {
    await prisma.user.create({
      data: {
        contact: u.contact,
        passwordHash: pwdHash,
        fullName: u.fullName,
        employeeNo: u.employeeNo,
        branchId: branches['公司总部'],
        departmentId: departments['公司总部']['人力资源部'],
        positionId: positions['安全监察专责'],
        jobTypeId: jobTypes['安全监察'],
        employeeLevelId: levels['高级工程师'],
        roles: {
          create: { role: AppRole.REVIEWER_L2 },
        },
      },
    });
  }
  console.log(`  ✓ 二级审核员 (REVIEWER_L2): ${l2Reviewers.length} 人`);

  // ----- L1 审核员（各分公司） -----
  const l1Branches = [
    { name: '国网华北分部', contactSuffix: 'nchb', fullName: '赵审核',  employeeNo: 'NC-HB-L1-001' },
    { name: '国网华东分部', contactSuffix: 'hd',   fullName: '钱审核',  employeeNo: 'NC-HD-L1-001' },
    { name: '国网华中分部', contactSuffix: 'hz',   fullName: '孙审核',  employeeNo: 'NC-HZ-L1-001' },
    { name: '国网东北分部', contactSuffix: 'db',   fullName: '李审核',  employeeNo: 'NC-DB-L1-001' },
    { name: '国网西北分部', contactSuffix: 'xb',   fullName: '周审核',  employeeNo: 'NC-XB-L1-001' },
    { name: '国网西南分部', contactSuffix: 'xn',   fullName: '吴审核',  employeeNo: 'NC-XN-L1-001' },
  ];
  for (const l1 of l1Branches) {
    await prisma.user.create({
      data: {
        contact: `reviewer-l1-${l1.contactSuffix}@powergrid.com.cn`,
        passwordHash: pwdHash,
        fullName: l1.fullName,
        employeeNo: l1.employeeNo,
        branchId: branches[l1.name],
        positionId: positions['安全监察专责'],
        jobTypeId: jobTypes['安全监察'],
        employeeLevelId: levels['工程师'],
        roles: {
          create: { role: AppRole.REVIEWER_L1, scopeBranchId: branches[l1.name] },
        },
      },
    });
  }
  console.log(`  ✓ 一级审核员 (REVIEWER_L1): ${l1Branches.length} 人`);

  // ----- 员工（各分公司分散） -----
  interface EmployeeSpec {
    fullName: string;
    contact: string;
    employeeNo: string;
    branch: string;
    dept: string;
    position: string;
    jobType: string;
    level: string;
  }

  const employees: EmployeeSpec[] = [
    // 华北分部
    { fullName: '刘建国', contact: 'liujianguo@powergrid.com.cn', employeeNo: 'NC-HB-EMP-001', branch: '国网华北分部', dept: '变电运检中心',    position: '变电运行值班员', jobType: '变电运行', level: '高级工' },
    { fullName: '陈晓东', contact: 'chenxiaodong@powergrid.com.cn', employeeNo: 'NC-HB-EMP-002', branch: '国网华北分部', dept: '变电运检中心',    position: '继电保护专责工', jobType: '继电保护', level: '技师' },
    { fullName: '杨志强', contact: 'yangzhiqiang@powergrid.com.cn', employeeNo: 'NC-HB-EMP-003', branch: '国网华北分部', dept: '输配电运检中心',  position: '输电线路运检工', jobType: '输电运检', level: '中级工' },
    // 华东分部
    { fullName: '黄海波', contact: 'huanghaibo@powergrid.com.cn', employeeNo: 'NC-HD-EMP-001', branch: '国网华东分部', dept: '调度控制中心',    position: '电力调度员',     jobType: '调度运行', level: '高级技师' },
    { fullName: '林晓燕', contact: 'linxiaoyan@powergrid.com.cn', employeeNo: 'NC-HD-EMP-002', branch: '国网华东分部', dept: '市场营销部',      position: '营销服务专责',   jobType: '电力营销', level: '工程师' },
    { fullName: '马文博', contact: 'mawenbo@powergrid.com.cn', employeeNo: 'NC-HD-EMP-003', branch: '国网华东分部', dept: '变电运检中心',    position: '变电检修工',     jobType: '变电检修', level: '高级工' },
    // 华中分部
    { fullName: '赵伟明', contact: 'zhaoweiming@powergrid.com.cn', employeeNo: 'NC-HZ-EMP-001', branch: '国网华中分部', dept: '安全监察部',      position: '安全监察专责',   jobType: '安全监察', level: '工程师' },
    { fullName: '韩雪梅', contact: 'hanxuemei@powergrid.com.cn', employeeNo: 'NC-HZ-EMP-002', branch: '国网华中分部', dept: '人力资源部',      position: '人力资源专责',   jobType: '人力资源', level: '助理工程师' },
    { fullName: '朱志远', contact: 'zhuzhiyuan@powergrid.com.cn', employeeNo: 'NC-HZ-EMP-003', branch: '国网华中分部', dept: '输配电运检中心',  position: '配电运检工',     jobType: '配电运检', level: '中级工' },
    // 东北分部
    { fullName: '高云飞', contact: 'gaoyunfei@powergrid.com.cn', employeeNo: 'NC-DB-EMP-001', branch: '国网东北分部', dept: '变电运检中心',    position: '变电运行值班员', jobType: '变电运行', level: '技师' },
    { fullName: '姜海龙', contact: 'jianghailong@powergrid.com.cn', employeeNo: 'NC-DB-EMP-002', branch: '国网东北分部', dept: '调度控制中心',    position: '电力调度员',     jobType: '调度运行', level: '高级工' },
    { fullName: '徐丽萍', contact: 'xuliping@powergrid.com.cn', employeeNo: 'NC-DB-EMP-003', branch: '国网东北分部', dept: '财务管理部',      position: '财务核算专责',   jobType: '财务管理', level: '工程师' },
    // 西北分部
    { fullName: '马建国', contact: 'majianguo@powergrid.com.cn', employeeNo: 'NC-XB-EMP-001', branch: '国网西北分部', dept: '信息通信中心',    position: '信息运维专责',   jobType: '信息通信', level: '助理工程师' },
    { fullName: '任晓明', contact: 'renxiaoming@powergrid.com.cn', employeeNo: 'NC-XB-EMP-002', branch: '国网西北分部', dept: '输配电运检中心',  position: '输电线路运检工', jobType: '输电运检', level: '高级工' },
    { fullName: '郑玉兰', contact: 'zhengyulan@powergrid.com.cn', employeeNo: 'NC-XB-EMP-003', branch: '国网西北分部', dept: '市场营销部',      position: '营销服务专责',   jobType: '电力营销', level: '工程师' },
    // 西南分部
    { fullName: '何志强', contact: 'hezhiqiang@powergrid.com.cn', employeeNo: 'NC-XN-EMP-001', branch: '国网西南分部', dept: '安全监察部',      position: '安全监察专责',   jobType: '安全监察', level: '高级工程师' },
    { fullName: '唐晓红', contact: 'tangxiaohong@powergrid.com.cn', employeeNo: 'NC-XN-EMP-002', branch: '国网西南分部', dept: '财务管理部',      position: '财务核算专责',   jobType: '财务管理', level: '中级工' },
    { fullName: '罗文军', contact: 'luowenjun@powergrid.com.cn', employeeNo: 'NC-XN-EMP-003', branch: '国网西南分部', dept: '变电运检中心',    position: '变电检修工',     jobType: '变电检修', level: '技师' },
    // 总部
    { fullName: '崔晓峰', contact: 'cuixiaofeng@powergrid.com.cn', employeeNo: 'NC-HQ-EMP-001', branch: '公司总部',      dept: '人力资源部',      position: '人力资源专责',   jobType: '人力资源', level: '高级工程师' },
    { fullName: '贾文静', contact: 'jiawenjing@powergrid.com.cn', employeeNo: 'NC-HQ-EMP-002', branch: '公司总部',      dept: '信息通信中心',    position: '信息运维专责',   jobType: '信息通信', level: '工程师' },
  ];

  for (const e of employees) {
    await prisma.user.create({
      data: {
        contact: e.contact,
        passwordHash: pwdHash,
        fullName: e.fullName,
        employeeNo: e.employeeNo,
        branchId: branches[e.branch],
        departmentId: departments[e.branch][e.dept],
        positionId: positions[e.position],
        jobTypeId: jobTypes[e.jobType],
        employeeLevelId: levels[e.level],
        roles: {
          create: { role: AppRole.EMPLOYEE },
        },
      },
    });
  }
  console.log(`  ✓ 员工 (EMPLOYEE): ${employees.length} 人`);
  console.log(`  📌 所有用户密码: Test1234!`);

  // 角色汇总
  const roleCounts = await prisma.userRole.groupBy({
    by: ['role'],
    _count: true,
  });
  for (const rc of roleCounts) {
    console.log(`     ${rc.role}: ${rc._count} 人`);
  }
  console.log('✅ 用户创建完成\n');

  // ============================================================
  // 9. 申报表单模板
  // ============================================================
  console.log('📋 创建申报表单模板...');

  // --- 模板 1: 2025年度员工绩效积分申报表 ---
  const template1 = await prisma.formTemplate.create({
    data: {
      year: 2025,
      title: '2025年度员工绩效积分申报表',
      description: '适用于各岗位员工的年度绩效积分申报，涵盖安全生产、技术创新、人才培养、荣誉表彰、技能竞赛等维度。',
      status: TemplateStatus.PUBLISHED,
      publishedAt: new Date('2025-01-15'),
      createdBy: 'seed',
    },
  });

  // 章节 & 申报项（每个档次带 description 帮助员工理解选择标准）
  const sections = [
    {
      section: { title: '安全生产', description: '考核员工在安全生产方面的表现与贡献，依据《电力安全工作规程》及相关安全管理规定。', sortOrder: 0 },
      items: [
        { title: '全年无违章记录', hint: '以安全监察部发布的年度违章通报为准，需上传安监部门出具的无违章证明', isRequired: true, requireAttachment: true, scoreOptions: [
          { label: '有违章记录', score: 0, description: '本年度存在被记录的安全违章行为，以安监通报为准' },
          { label: '零违章记录', score: 10, description: '本年度无任何安全违章记录，保持良好安全纪律' },
        ]},
        { title: '发现并处理安全隐患', hint: '主动发现并及时上报或消除的安全隐患，需提供隐患登记表或处理报告', isRequired: false, requireAttachment: true, scoreOptions: [
          { label: '未发现', score: 0, description: '本年度未主动发现或上报安全隐患' },
          { label: '发现1-2项一般隐患', score: 3, description: '主动发现并上报1-2项一般性安全隐患，有登记记录' },
          { label: '发现3项及以上一般隐患', score: 6, description: '主动发现并上报3项及以上安全隐患，安全意识突出' },
          { label: '发现重大隐患并消除', score: 10, description: '发现重大安全隐患并主导或参与消除，避免可能的人身或设备事故' },
        ]},
        { title: '参与安全培训与应急演练', hint: '以培训签到记录或演练记录为准', isRequired: true, requireAttachment: false, scoreOptions: [
          { label: '未参加', score: 0, description: '本年度未参加公司组织的安全培训或应急演练' },
          { label: '参加1次', score: 2, description: '参加1次安全培训或应急演练，完成签到' },
          { label: '参加2次及以上', score: 5, description: '参加2次及以上安全培训或应急演练，积极参与' },
          { label: '担任培训讲师或演练指挥', score: 8, description: '主动担任安全培训讲师或应急演练指挥，承担教学或组织职责' },
        ]},
        { title: '安全规程考试', hint: '以年度《安规》考试成绩单为准', isRequired: true, requireAttachment: true, scoreOptions: [
          { label: '未通过', score: 0, description: '年度安规考试成绩低于60分或未参加考试' },
          { label: '合格（60-79分）', score: 3, description: '安规考试成绩达到合格线，掌握基本安全知识' },
          { label: '良好（80-94分）', score: 5, description: '安规考试成绩良好，安全知识掌握扎实' },
          { label: '优秀（95分及以上）', score: 8, description: '安规考试成绩优异，安全知识全面精通' },
        ]},
      ],
    },
    {
      section: { title: '技术创新', description: '考核员工在技术创新、QC攻关与技术改进方面的成果，依据公司《科技创新管理办法》。', sortOrder: 1 },
      items: [
        { title: '技术创新成果', hint: '包括技术革新、QC小组活动成果、五小成果等，需上传成果报告或获奖证书', isRequired: false, requireAttachment: true, scoreOptions: [
          { label: '未参与', score: 0, description: '本年度未参与任何技术创新或QC攻关项目' },
          { label: '参与创新项目', score: 5, description: '作为项目成员参与技术创新或QC攻关项目，有参与记录' },
          { label: '主持创新项目并结题', score: 10, description: '担任项目负责人并完成结题验收，取得可验证的创新成果' },
          { label: '成果获公司级以上奖励', score: 15, description: '主持的创新成果获得公司级及以上科技进步奖或QC成果奖' },
        ]},
        { title: '技术论文发表', hint: '第一作者或通讯作者发表的电力行业相关技术论文，需上传刊物封面、目录及正文', isRequired: false, requireAttachment: true, scoreOptions: [
          { label: '未发表', score: 0, description: '本年度未在公开刊物上发表技术论文' },
          { label: '公司内部刊物发表', score: 2, description: '在公司内部刊物或技术简报上发表技术文章' },
          { label: '省级刊物发表', score: 5, description: '在省级及以上公开期刊发表技术论文，具有正规刊号' },
          { label: '核心期刊/国家级刊物发表', score: 10, description: '在北大核心期刊、中国科技核心期刊或国家级行业期刊发表论文' },
        ]},
        { title: '专利或软件著作权', hint: '以国家知识产权局授权证书或受理通知书为准', isRequired: false, requireAttachment: true, scoreOptions: [
          { label: '无', score: 0, description: '本年度未申请或获得专利/软著' },
          { label: '受理/申报中', score: 3, description: '已提交专利申请或软著登记并获得受理通知书，尚未授权' },
          { label: '获得实用新型/软著', score: 8, description: '获得实用新型专利授权或计算机软件著作权登记证书' },
          { label: '获得发明专利', score: 15, description: '获得国家发明专利授权，处于专利权有效期内' },
        ]},
      ],
    },
    {
      section: { title: '人才培养', description: '考核员工在知识传承、人才培养与技术帮带方面的贡献。', sortOrder: 2 },
      items: [
        { title: '师带徒培养新员工', hint: '以人力资源部备案的师带徒协议为准', isRequired: false, requireAttachment: false, scoreOptions: [
          { label: '未担任导师', score: 0, description: '本年度未签订师带徒协议或未担任新员工导师' },
          { label: '担任1名新员工导师', score: 3, description: '与1名新员工签订师带徒协议，制定培养计划并按期完成' },
          { label: '担任2名及以上新员工导师', score: 6, description: '同时或先后担任2名及以上新员工的导师，充分履行带教职责' },
          { label: '所带徒弟获公司级及以上表彰', score: 10, description: '培养的徒弟在本年度获得公司级及以上表彰或技能竞赛名次' },
        ]},
        { title: '内部培训授课', hint: '以培训部门归档的授课记录为准', isRequired: false, requireAttachment: false, scoreOptions: [
          { label: '未授课', score: 0, description: '本年度未承担内部培训授课任务' },
          { label: '授课1-2学时', score: 2, description: '完成1-2学时的内部培训授课，有教案和签到记录' },
          { label: '授课3-8学时', score: 5, description: '完成3-8学时的内部培训授课，培训效果良好' },
          { label: '授课8学时以上', score: 8, description: '完成8学时以上内部培训授课，在知识分享方面贡献突出' },
        ]},
        { title: '技能鉴定考评', hint: '担任技能鉴定考评员或职称评审委员', isRequired: false, requireAttachment: false, scoreOptions: [
          { label: '未担任', score: 0, description: '本年度未参与技能鉴定或职称评审工作' },
          { label: '担任技能鉴定考评员', score: 3, description: '被聘为职业技能鉴定考评员并实际参与鉴定工作' },
          { label: '担任职称评审委员会委员', score: 5, description: '被聘为职称评审委员会成员并实际参与评审工作' },
        ]},
      ],
    },
    {
      section: { title: '荣誉表彰', description: '考核员工获得的各级各类荣誉与表彰，依据公司《评先评优管理办法》。', sortOrder: 3 },
      items: [
        { title: '公司级荣誉', hint: '包括先进个人、先进集体成员、优秀共产党员等公司级荣誉', isRequired: false, requireAttachment: true, scoreOptions: [
          { label: '无', score: 0, description: '本年度未获得公司级荣誉表彰' },
          { label: '分公司级先进个人/集体', score: 3, description: '获得所在分公司（分部）级先进个人、先进集体或同等荣誉' },
          { label: '公司级先进个人/集体', score: 6, description: '获得公司总部级先进个人、劳动模范、先进集体或同等荣誉' },
        ]},
        { title: '省部级及以上荣誉', hint: '由政府、行业主管部门或全国性行业协会颁发的荣誉', isRequired: false, requireAttachment: true, scoreOptions: [
          { label: '无', score: 0, description: '本年度未获得省部级及以上荣誉' },
          { label: '省级/行业级荣誉', score: 8, description: '获得省级人民政府、国家能源局派出机构或全国性电力行业协会颁发的荣誉' },
          { label: '国家级荣誉', score: 15, description: '获得国家级荣誉，如全国劳动模范、全国五一劳动奖章、国务院特殊津贴等' },
        ]},
      ],
    },
    {
      section: { title: '技能竞赛', description: '考核员工参与各级技能竞赛的成绩，依据《职业技能竞赛管理办法》。', sortOrder: 4 },
      items: [
        { title: '公司级竞赛获奖', hint: '以公司工会或人资部发布的竞赛结果通报为准', isRequired: false, requireAttachment: true, scoreOptions: [
          { label: '未参加', score: 0, description: '本年度未报名参加公司级技能竞赛' },
          { label: '参赛未获奖', score: 1, description: '报名参加公司级技能竞赛但未进入获奖名次，参与精神可嘉' },
          { label: '三等奖', score: 3, description: '在公司级技能竞赛中获得三等奖或铜奖' },
          { label: '二等奖', score: 5, description: '在公司级技能竞赛中获得二等奖或银奖' },
          { label: '一等奖', score: 8, description: '在公司级技能竞赛中获得一等奖或金奖' },
        ]},
        { title: '省级及以上竞赛获奖', hint: '参加省级、行业级或全国性技能竞赛的获奖情况', isRequired: false, requireAttachment: true, scoreOptions: [
          { label: '未参加', score: 0, description: '本年度未参加省级及以上技能竞赛' },
          { label: '参赛未获奖', score: 2, description: '代表公司参加省级及以上竞赛，积累了经验' },
          { label: '三等奖', score: 5, description: '在省级及以上技能竞赛中获得三等奖或铜奖' },
          { label: '二等奖', score: 10, description: '在省级及以上技能竞赛中获得二等奖或银奖' },
          { label: '一等奖', score: 15, description: '在省级及以上技能竞赛中获得一等奖或金奖，为公司赢得荣誉' },
        ]},
      ],
    },
  ];

  for (const sec of sections) {
    const formSection = await prisma.formSection.create({
      data: {
        templateId: template1.id,
        ...sec.section,
      },
    });
    for (let i = 0; i < sec.items.length; i++) {
      const itemSeed = sec.items[i];
      const formItem = await prisma.formItem.create({
        data: {
          sectionId: formSection.id,
          ...itemSeed,
          scoreOptions: [],
          sortOrder: i,
        },
      });
      const scoreOptions = itemSeed.scoreOptions.map((option, index) => ({
        ...option,
        optionId: `${formItem.id}:${index}`,
      }));
      await prisma.formItem.update({
        where: { id: formItem.id },
        data: { scoreOptions },
      });
      for (const option of scoreOptions) {
        await prisma.formOptionReviewer.create({
          data: {
            itemId: formItem.id,
            optionId: option.optionId,
            departmentId: departments['公司总部']['人力资源部'],
          },
        });
      }
    }
  }
  console.log(`  ✓ 模板1: "${template1.title}" (${sections.length} 个章节)`);

  // --- 模板 2: 2025年度管理岗位专项申报表 ---
  const template2 = await prisma.formTemplate.create({
    data: {
      year: 2025,
      title: '2025年度管理岗位专项申报表',
      description: '适用于管理岗位的年度绩效申报，侧重管理创新、团队建设、业绩指标等维度。',
      status: TemplateStatus.PUBLISHED,
      publishedAt: new Date('2025-01-20'),
      createdBy: 'seed',
    },
  });

  const mgmtSections = [
    {
      section: { title: '管理创新', description: '考核管理人员在管理方法、流程优化方面的创新，依据《管理创新成果管理办法》。', sortOrder: 0 },
      items: [
        { title: '管理创新项目', hint: '主持或参与的管理创新项目，需上传项目报告或成果证明', isRequired: true, requireAttachment: true, scoreOptions: [
          { label: '未参与', score: 0, description: '本年度未参与管理创新项目' },
          { label: '参与管理创新项目', score: 5, description: '作为项目成员参与管理创新课题，有项目组记录' },
          { label: '主持并完成管理创新项目', score: 10, description: '担任管理创新项目负责人，完成结题并形成可推广的管理成果' },
          { label: '成果获公司级以上推广', score: 15, description: '管理创新成果被公司级以上单位发文推广或获得管理创新奖' },
        ]},
        { title: '流程优化建议', hint: '提出并被采纳的流程优化或制度改进建议', isRequired: false, requireAttachment: false, scoreOptions: [
          { label: '未提出', score: 0, description: '本年度未提出流程优化或制度改进建议' },
          { label: '提出1-2条建议', score: 3, description: '提出1-2条合理化建议，有书面记录' },
          { label: '提出3条及以上建议并被采纳', score: 6, description: '提出3条及以上合理化建议，其中至少1条被正式采纳实施' },
        ]},
      ],
    },
    {
      section: { title: '团队建设', description: '考核团队管理与人才培养成效，依据公司《绩效管理办法》及《人才培养规划》。', sortOrder: 1 },
      items: [
        { title: '团队绩效达标', hint: '所管理团队的年度绩效考核得分', isRequired: true, requireAttachment: false, scoreOptions: [
          { label: '未达标', score: 0, description: '所管理团队年度绩效考核未达标（80分以下）' },
          { label: '基本达标（80-89分）', score: 5, description: '团队年度绩效得分80-89分，基本完成考核目标' },
          { label: '良好（90-94分）', score: 8, description: '团队年度绩效得分90-94分，较好完成考核目标' },
          { label: '优秀（95分及以上）', score: 12, description: '团队年度绩效得分95分及以上，出色完成考核目标' },
        ]},
        { title: '人才培养成效', hint: '团队成员的职业发展情况（晋升、转岗、技能提升）', isRequired: false, requireAttachment: false, scoreOptions: [
          { label: '无明显成效', score: 0, description: '团队成员本年度无明显职业发展或技能提升' },
          { label: '1人晋升或转岗', score: 3, description: '至少1名团队成员获得岗位晋升、技术等级提升或内部转岗' },
          { label: '2人及以上晋升或转岗', score: 6, description: '2名及以上团队成员获得岗位晋升、技术等级提升或内部转岗' },
        ]},
      ],
    },
    {
      section: { title: '核心业绩指标', description: '年度关键绩效指标（KPI）完成情况，依据公司《年度经营业绩考核办法》。', sortOrder: 2 },
      items: [
        { title: '安全生产指标', hint: '分管领域安全生产目标完成情况（事故率、隐患整改率等）', isRequired: true, requireAttachment: false, scoreOptions: [
          { label: '未达标', score: 0, description: '分管领域安全生产指标未完成年度目标值' },
          { label: '达标', score: 10, description: '分管领域安全生产指标完成年度目标值' },
          { label: '超额完成（零事故）', score: 15, description: '分管领域实现全年零事故，且安全隐患整改率100%' },
        ]},
        { title: '经营指标完成', hint: '分管领域经营指标完成情况（成本控制、效率提升、服务质量等）', isRequired: true, requireAttachment: false, scoreOptions: [
          { label: '未达标', score: 0, description: '分管领域经营指标未达到年度目标值' },
          { label: '达标', score: 8, description: '分管领域经营指标达到年度目标值' },
          { label: '超额完成', score: 12, description: '分管领域经营指标超额完成年度目标值10%以上' },
        ]},
      ],
    },
  ];

  for (const sec of mgmtSections) {
    const formSection = await prisma.formSection.create({
      data: {
        templateId: template2.id,
        ...sec.section,
      },
    });
    for (let i = 0; i < sec.items.length; i++) {
      const itemSeed = sec.items[i];
      const formItem = await prisma.formItem.create({
        data: {
          sectionId: formSection.id,
          ...itemSeed,
          scoreOptions: [],
          sortOrder: i,
        },
      });
      const scoreOptions = itemSeed.scoreOptions.map((option, index) => ({
        ...option,
        optionId: `${formItem.id}:${index}`,
      }));
      await prisma.formItem.update({
        where: { id: formItem.id },
        data: { scoreOptions },
      });
      for (const option of scoreOptions) {
        await prisma.formOptionReviewer.create({
          data: {
            itemId: formItem.id,
            optionId: option.optionId,
            departmentId: departments['公司总部']['人力资源部'],
          },
        });
      }
    }
  }
  console.log(`  ✓ 模板2: "${template2.title}" (${mgmtSections.length} 个章节)`);

  // --- 模板 3: Draft 状态（用于测试未发布场景） ---
  await prisma.formTemplate.create({
    data: {
      year: 2025,
      title: '2025年度青年员工专项申报表（草稿）',
      description: '面向35周岁以下青年员工的专项绩效申报，侧重成长进步与学习发展。',
      status: TemplateStatus.DRAFT,
      createdBy: 'seed',
    },
  });
  console.log('  ✓ 模板3: Draft 状态模板（用于测试）');

  console.log('✅ 模板创建完成\n');

  // ============================================================
  // 10. 汇总
  // ============================================================
  const [userCount, branchCount, deptCount, posCount, jtCount, lvCount, tplCount] = await Promise.all([
    prisma.user.count(),
    prisma.branch.count(),
    prisma.department.count(),
    prisma.position.count(),
    prisma.jobType.count(),
    prisma.employeeLevel.count(),
    prisma.formTemplate.count(),
  ]);

  console.log('═══════════════════════════════════════');
  console.log('📊 种子数据填充完成！');
  console.log('═══════════════════════════════════════');
  console.log(`   分公司:     ${branchCount}`);
  console.log(`   部门:       ${deptCount}`);
  console.log(`   岗位:       ${posCount}`);
  console.log(`   工种:       ${jtCount}`);
  console.log(`   员工等级:   ${lvCount}`);
  console.log(`   用户:       ${userCount}`);
  console.log(`   表单模板:   ${tplCount}`);
  console.log('');
  console.log('🔑 测试账号（密码统一: Test1234!）');
  console.log('   ADMIN:       admin@powergrid.com.cn');
  console.log('   REVIEWER_L2: reviewer-l2-zhang@powergrid.com.cn');
  console.log('   REVIEWER_L1: reviewer-l1-nchb@powergrid.com.cn');
  console.log('   EMPLOYEE:    liujianguo@powergrid.com.cn');
  console.log('═══════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ 种子数据填充失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
