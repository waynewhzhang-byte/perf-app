'use client';
// 评分规则管理：为系统导入维度（缺陷治理/两票执行/安全贡献）配置评分算法

import { useCallback, useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

// ── Types ───────────────────────────────────────────────────────────

interface DimensionDef {
  code: string;
  name: string;
  category: string;
  dataSource: string;
}

interface ScoringRuleRecord {
  id: string;
  dimensionCode: string;
  dimensionName: string;
  ruleType: 'MATRIX' | 'SHARE' | 'NORMALIZE' | 'BASIC_TIER';
  cap: number;
  enabled: boolean;
  config: Record<string, unknown>;
}

type RuleForm = {
  id?: string;
  dimensionCode: string;
  ruleType: 'MATRIX' | 'SHARE' | 'NORMALIZE' | 'BASIC_TIER';
  cap: number;
  enabled: boolean;
  config: Record<string, unknown>;
};

// ── Role/Defect Level Constants ─────────────────────────────────────

const ROLES = [
  { key: 'FIRST_DISCOVERER', label: '第一发现人' },
  { key: 'CO_DISCOVERER', label: '共同发现人' },
  { key: 'FIRST_HANDLER', label: '第一处理人' },
  { key: 'CO_HANDLER', label: '共同处理人' },
];

const RULE_TYPES = [
  { key: 'MATRIX' as const, label: '矩阵映射', desc: '角色 × 缺陷等级 → 固定分数' },
  { key: 'SHARE' as const, label: '聚合均分', desc: '按事件分组，角色份额分配' },
  { key: 'NORMALIZE' as const, label: '折算归一', desc: '原始分 ÷ 最高分 × 目标满分' },
  { key: 'BASIC_TIER' as const, label: '档位映射', desc: '基本素质档位值 → 固定分数' },
];

const DEFAULT_DEFECT_LEVELS = ['危急', '严重', '一般'];

// ── Config Editors ──────────────────────────────────────────────────

interface ConfigEditorProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

function BasicTierEditor({ config, onChange }: ConfigEditorProps) {
  const tiers = (config.tiers as Record<string, number>) ?? {};
  const defaultScore = (config.defaultScore as number) ?? 0;
  const entries = Object.entries(tiers);

  const setTier = (oldKey: string, newKey: string, value: number) => {
    const next: Record<string, number> = {};
    for (const [k, v] of entries) {
      if (k === oldKey) next[newKey.trim() || k] = value;
      else next[k] = v;
    }
    onChange({ ...config, tiers: next });
  };

  const addTier = () => {
    const name = prompt('档位名称（如：高级技师）');
    if (!name?.trim()) return;
    if (Object.prototype.hasOwnProperty.call(tiers, name.trim())) return;
    onChange({ ...config, tiers: { ...tiers, [name.trim()]: 0 } });
  };

  const removeTier = (key: string) => {
    const next = { ...tiers };
    delete next[key];
    onChange({ ...config, tiers: next });
  };

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        基本素质档位值 → 固定分数。解析器把原始数据归一成档位码（如「技师」「2A1B」），引擎查此表得分；未列出的档位取「默认分」。
      </p>
      <div className="space-y-1.5">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center gap-2">
            <input
              type="text"
              value={key}
              onChange={(e) => setTier(key, e.target.value, val)}
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <span className="text-xs text-slate-400">→</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={val}
              onChange={(e) => setTier(key, key, parseFloat(e.target.value) || 0)}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-xs text-center"
            />
            <button
              onClick={() => removeTier(key)}
              className="text-red-400 hover:text-red-600 text-xs px-1"
            >
              ✕
            </button>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="text-xs text-slate-400 italic">尚无档位，点击下方添加。</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={addTier}
          className="rounded border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
        >
          + 添加档位
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          默认分（未列出档位）
          <input
            type="number"
            min={0}
            step={0.5}
            value={defaultScore}
            onChange={(e) => onChange({ ...config, defaultScore: parseFloat(e.target.value) || 0 })}
            className="w-20 rounded border border-slate-300 px-2 py-1 text-center"
          />
        </label>
      </div>
    </div>
  );
}

function MatrixEditor({ config, onChange }: ConfigEditorProps) {
  const matrix = (config.matrix as Record<string, Record<string, number>>) ?? {};
  const levels = Object.keys(matrix).length > 0 ? Object.keys(matrix) : DEFAULT_DEFECT_LEVELS;

  // Ensure all role keys exist in each level
  const ensureMatrix = (lvl: string, role: string, value: number) => {
    const next = { ...matrix };
    if (!next[lvl]) next[lvl] = {};
    next[lvl] = { ...next[lvl], [role]: value };
    onChange({ ...config, matrix: next });
  };

  const addLevel = () => {
    const name = prompt('缺陷等级名称（如：致命）');
    if (!name?.trim()) return;
    const next = { ...matrix, [name.trim()]: {} };
    onChange({ ...config, matrix: next });
  };

  const removeLevel = (lvl: string) => {
    const next = { ...matrix };
    delete next[lvl];
    onChange({ ...config, matrix: next });
  };

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        行为缺陷等级，列为员工角色，单元格为得分。同一人兼任多角色时取最高分。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-medium">
                缺陷等级
              </th>
              {ROLES.map((r) => (
                <th key={r.key} className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-medium">
                  {r.label}
                </th>
              ))}
              <th className="border border-slate-200 bg-slate-50 px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {levels.map((lvl) => (
              <tr key={lvl}>
                <td className="border border-slate-200 px-2 py-1 font-medium">{lvl}</td>
                {ROLES.map((r) => (
                  <td key={r.key} className="border border-slate-200 px-0.5 py-0.5">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={matrix[lvl]?.[r.key] ?? 0}
                      onChange={(e) => ensureMatrix(lvl, r.key, parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-200 px-1.5 py-1 text-center text-xs focus:border-primary-400 focus:outline-none"
                    />
                  </td>
                ))}
                <td className="border border-slate-200 px-1 py-0.5">
                  <button
                    onClick={() => removeLevel(lvl)}
                    className="text-red-400 hover:text-red-600 text-xs px-1"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={addLevel}
        className="mt-2 rounded border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
      >
        + 添加缺陷等级
      </button>
    </div>
  );
}

function ShareEditor({ config, onChange }: ConfigEditorProps) {
  const roles = (config.roles as Record<string, Record<string, unknown>>) ?? {};
  const groupBy = (config.groupBy as string) ?? 'incidentId';

  const updateRole = (roleKey: string, field: string, value: unknown) => {
    const next = {
      ...config,
      roles: {
        ...roles,
        [roleKey]: { ...(roles[roleKey] ?? {}), [field]: value },
      },
    };
    onChange(next);
  };

  const toggleGroupBy = () => {
    onChange({ ...config, groupBy: groupBy === 'incidentId' ? 'employeeNo' : 'incidentId' });
  };

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        按事件聚合后，各角色按份额或每事件固定分分配。故障次数 N 可乘入总分。
      </p>
      <div className="mb-3">
        <label className="text-xs font-medium text-slate-600 mr-2">分组依据</label>
        <button
          onClick={toggleGroupBy}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
        >
          {groupBy === 'incidentId' ? '事件编号' : '人员工号'}
        </button>
      </div>
      <div className="grid gap-2">
        {ROLES.map((r) => (
          <div key={r.key} className="flex items-center gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium w-20 shrink-0">{r.label}</span>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="radio"
                name={`share-${r.key}`}
                checked={roles[r.key]?.perIncident != null}
                onChange={() => updateRole(r.key, 'perIncident', 3)}
                className="rounded"
              />
              每事件
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={(roles[r.key]?.perIncident as number) ?? ''}
              onChange={(e) => updateRole(r.key, 'perIncident', e.target.value === '' ? undefined : parseFloat(e.target.value))}
              disabled={roles[r.key]?.perIncident == null}
              className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
            />
            <label className="flex items-center gap-1 text-xs ml-2">
              <input
                type="radio"
                name={`share-${r.key}`}
                checked={roles[r.key]?.totalShare != null}
                onChange={() => updateRole(r.key, 'totalShare', 3)}
                className="rounded"
              />
              总额均分
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={(roles[r.key]?.totalShare as number) ?? ''}
              onChange={(e) => updateRole(r.key, 'totalShare', e.target.value === '' ? undefined : parseFloat(e.target.value))}
              disabled={roles[r.key]?.totalShare == null}
              className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
            />
            <label className="flex items-center gap-1 text-xs ml-2">
              <input
                type="checkbox"
                checked={(roles[r.key]?.multiplyByFaultCount as boolean) ?? false}
                onChange={(e) => updateRole(r.key, 'multiplyByFaultCount', e.target.checked)}
              />
              ×故障次数
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

const TICKET_WORK_ROLES = [
  { key: 'workLeader', label: '工作负责人' },
  { key: 'workPermitter', label: '许可人' },
  { key: 'workMember', label: '工作班成员' },
];

function NormalizeEditor({ config, onChange }: ConfigEditorProps) {
  const targetMaxScore = (config.targetMaxScore as number) ?? 30;
  const normalizeWithin = (config.normalizeWithin as string) ?? 'declarationLevel';
  const operationStepPrice = config.operationStepPrice as number | undefined;
  const ticketPrices = (config.ticketPrices as Record<string, Record<string, number>>) ?? undefined;

  const setPrice = (role: string, type: string, value: number) => {
    const next = { ...(ticketPrices ?? {}) };
    if (!next[role]) next[role] = {};
    next[role] = { ...next[role], [type]: value };
    onChange({ ...config, ticketPrices: next });
  };

  const removePrice = (role: string, type: string) => {
    const next = { ...(ticketPrices ?? {}) };
    if (next[role]) {
      delete next[role][type];
      if (Object.keys(next[role]).length === 0) delete next[role];
    }
    onChange({ ...config, ticketPrices: next });
  };

  const addPrice = (role: string) => {
    const type = prompt('票种类名称（如：总工作票）');
    if (!type?.trim()) return;
    setPrice(role, type.trim(), 0);
  };

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        两层计分：(1) 操作票步数×单价 + 工作票按票种×角色单价 → 原始分；(2) 原始分 ÷ 同能级最高 × 目标满分。单价表可不配（退化为读事实原始分）。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-slate-600">目标满分</span>
          <input
            type="number"
            min={1}
            value={targetMaxScore}
            onChange={(e) => onChange({ ...config, targetMaxScore: parseInt(e.target.value, 10) || 30 })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-600">折算分组依据</span>
          <select
            value={normalizeWithin}
            onChange={(e) => onChange({ ...config, normalizeWithin: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="declarationLevel">能级等级</option>
            <option value="all">全部</option>
            <option value="branch">工区</option>
          </select>
        </label>
      </div>

      {/* 操作票单价 */}
      <label className="mt-4 flex items-center gap-2 text-sm">
        <span className="font-medium text-slate-600">操作票每步单价</span>
        <input
          type="number"
          min={0}
          step={0.001}
          value={operationStepPrice ?? ''}
          placeholder="留空=不启用"
          onChange={(e) => {
            const v = e.target.value;
            const next = { ...config };
            if (v === '') delete next.operationStepPrice;
            else next.operationStepPrice = parseFloat(v) || 0;
            onChange(next);
          }}
          className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>

      {/* 工作票单价表 */}
      {operationStepPrice != null && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-600 mb-2">工作票单价表（角色 × 票种类）</p>
          <div className="space-y-3">
            {TICKET_WORK_ROLES.map((r) => {
              const table = ticketPrices?.[r.key] ?? {};
              return (
                <div key={r.key} className="rounded border border-slate-100 bg-white p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">{r.label}</span>
                    <button
                      onClick={() => addPrice(r.key)}
                      className="text-xs text-primary-600 hover:text-primary-700"
                    >
                      + 票种
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(table).map(([type, val]) => (
                      <div key={type} className="flex items-center gap-1 rounded bg-slate-50 px-1.5 py-1">
                        <span className="text-xs text-slate-600">{type}</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={val}
                          onChange={(e) => setPrice(r.key, type, parseFloat(e.target.value) || 0)}
                          className="w-14 rounded border border-slate-300 px-1 py-0.5 text-center text-xs"
                        />
                        <button
                          onClick={() => removePrice(r.key, type)}
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {Object.keys(table).length === 0 && (
                      <span className="text-xs text-slate-400 italic">无</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const ConfigEditor: Record<string, React.FC<ConfigEditorProps>> = {
  MATRIX: MatrixEditor,
  SHARE: ShareEditor,
  NORMALIZE: NormalizeEditor,
  BASIC_TIER: BasicTierEditor,
};

// ── Defaults ────────────────────────────────────────────────────────

const blankForm = (dimCode?: string): RuleForm => ({
  dimensionCode: dimCode ?? '',
  ruleType: 'MATRIX',
  cap: 10,
  enabled: true,
  config: {},
});

// ── Page ────────────────────────────────────────────────────────────

const inputClass =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const btnPrimary =
  'rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

const btnOutline =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-50 disabled:opacity-50';

export default function ScoringRulesPage() {
  const [rules, setRules] = useState<ScoringRuleRecord[]>([]);
  const [dimensions, setDimensions] = useState<DimensionDef[]>([]);
  const [editing, setEditing] = useState<RuleForm>(blankForm());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setMsg(null);
    try {
      const r = await fetch('/api/admin/scoring-rules');
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      const d = await r.json();
      if (!r.ok) { setMsg({ type: 'error', text: d.error || '加载失败' }); return; }
      setRules(d.rules ?? []);
      setDimensions(d.dimensions ?? []);
    } catch {
      setMsg({ type: 'error', text: '加载失败，请检查网络连接' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Which dimensions already have a rule configured
  const usedCodes = new Set(rules.map((r) => r.dimensionCode));

  const dimName = (code: string) => dimensions.find((d) => d.code === code)?.name ?? code;
  const dimDef = (code: string) => dimensions.find((d) => d.code === code);

  const save = async () => {
    if (!editing.dimensionCode) { setMsg({ type: 'error', text: '请选择评价维度' }); return; }
    if (!editing.ruleType) { setMsg({ type: 'error', text: '请选择规则类型' }); return; }
    setBusy(true); setMsg(null);
    try {
      const body = {
        ...editing,
        cap: Number(editing.cap),
      };
      const r = await fetch('/api/admin/scoring-rules', {
        method: editing.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ type: 'error', text: d.error || '保存失败' }); return; }
      setEditing(blankForm());
      setMsg({ type: 'success', text: '已保存' });
      await load();
    } catch {
      setMsg({ type: 'error', text: '保存失败，请检查网络连接' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rule: ScoringRuleRecord) => {
    if (!confirm(`确认删除「${dimName(rule.dimensionCode)}」的评分规则？`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/admin/scoring-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ type: 'error', text: d.error || '删除失败' }); return; }
      await load();
    } catch {
      setMsg({ type: 'error', text: '删除失败，请检查网络连接' });
    } finally {
      setBusy(false);
    }
  };

  const startNew = (dimCode?: string) => {
    setEditing(blankForm(dimCode));
  };

  const ruleTypeLabel = (t: string) => RULE_TYPES.find((rt) => rt.key === t)?.label ?? t;

  const Editor = ConfigEditor[editing.ruleType];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">绩效算法配置</h1>
          <p className="mt-1 text-sm text-slate-500">
            为系统导入维度配置评分规则。配置后可在「数据导入」中上传事实数据并自动计算分数。
          </p>
        </div>
        <AdminPageActions />
      </div>

      {msg && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            msg.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* ── Form ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">{editing.id ? '编辑规则' : '新增规则'}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {/* Dimension */}
          <label className="text-sm sm:col-span-2">
            <span className="font-medium text-slate-600">评价维度</span>
            <select
              value={editing.dimensionCode}
              onChange={(e) => {
                const code = e.target.value;
                setEditing({ ...editing, dimensionCode: code });
              }}
              disabled={!!editing.id}
              className={`mt-1 w-full ${inputClass} ${editing.id ? 'bg-slate-50 text-slate-500' : ''}`}
            >
              <option value="">— 请选择 —</option>
              {dimensions.map((d) => (
                <option
                  key={d.code}
                  value={d.code}
                  disabled={!editing.id && usedCodes.has(d.code)}
                >
                  {d.name}（{d.category}）{!editing.id && usedCodes.has(d.code) ? ' — 已配置' : ''}
                </option>
              ))}
            </select>
            {editing.dimensionCode && dimDef(editing.dimensionCode) && (
              <p className="mt-1 text-xs text-slate-400">
                数据来源：{dimDef(editing.dimensionCode)!.dataSource}
              </p>
            )}
          </label>

          {/* Rule Type */}
          <label className="text-sm">
            <span className="font-medium text-slate-600">规则类型</span>
            <select
              value={editing.ruleType}
              onChange={(e) => {
                const rt = e.target.value as RuleForm['ruleType'];
                setEditing({ ...editing, ruleType: rt, config: {} });
              }}
              className={`mt-1 w-full ${inputClass}`}
            >
              {RULE_TYPES.map((rt) => (
                <option key={rt.key} value={rt.key}>
                  {rt.label} — {rt.desc}
                </option>
              ))}
            </select>
          </label>

          {/* Cap */}
          <label className="text-sm">
            <span className="font-medium text-slate-600">分数上限</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={editing.cap}
              onChange={(e) => setEditing({ ...editing, cap: parseFloat(e.target.value) || 0 })}
              className={`mt-1 w-full ${inputClass}`}
            />
            <span className="mt-0.5 text-xs text-slate-400">单条事实最高得分</span>
          </label>

          {/* Enabled */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              className="rounded border-slate-300"
            />
            启用规则
          </label>

          {/* Type-specific Config */}
          <div className="sm:col-span-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-600 mb-3">
              {ruleTypeLabel(editing.ruleType)} 配置
            </p>
            {Editor && (
              <Editor
                config={editing.config}
                onChange={(config) => setEditing({ ...editing, config })}
              />
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          {editing.id && (
            <button type="button" onClick={() => setEditing(blankForm())} className={btnOutline}>
              取消编辑
            </button>
          )}
          <button type="button" onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? '保存中…' : '保存规则'}
          </button>
        </div>
      </section>

      {/* ── Rule List ──────────────────────────────────────────────── */}
      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">规则列表</h2>
          <button onClick={() => startNew()} className={btnPrimary}>
            + 新增规则
          </button>
        </div>
        <ul className="divide-y divide-slate-100">
          {rules.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-slate-400">
              暂无评分规则，请先添加。
            </li>
          )}
          {rules.map((rule) => {
            const def = dimDef(rule.dimensionCode);
            return (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{dimName(rule.dimensionCode)}</p>
                    <span
                      className={`rounded-full px-2 py-px text-xs ${
                        rule.enabled
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {rule.enabled ? '启用' : '停用'}
                    </span>
                    <span className="rounded-full border border-slate-200 px-2 py-px text-xs text-slate-500">
                      {ruleTypeLabel(rule.ruleType)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {def?.category ?? rule.dimensionCode} · 分数上限 {rule.cap}
                    {def ? ` · ${def.dataSource}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing({ ...rule })}
                    className={btnOutline}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(rule)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                  >
                    删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
