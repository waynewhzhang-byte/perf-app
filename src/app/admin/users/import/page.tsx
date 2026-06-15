'use client';
// 员工批量导入
import { useState, useRef } from 'react';
import Link from 'next/link';

interface ImportRow {
  employeeNo: string;
  name: string;
  gender?: string;
  branchName?: string;
  specialty?: string;
  jobType?: string;
  hireDate?: string;
}

// 小写常用列头 → 字段映射
const COLUMN_ALIASES: Record<string, keyof ImportRow> = {
  '工号': 'employeeNo', '员工号': 'employeeNo', '员工编号': 'employeeNo',
  '姓名': 'name', '名字': 'name',
  '性别': 'gender',
  '所在单位': 'branchName', '单位': 'branchName', '分公司': 'branchName', '部门': 'branchName', '工区': 'branchName',
  '专业': 'specialty', '所属专业': 'specialty', '能级专业': 'specialty',
  '工种': 'jobType', '岗位': 'jobType', '岗位职务': 'jobType',
  '入职时间': 'hireDate', '入职日期': 'hireDate', '参加工作日期': 'hireDate', '工作年限': 'hireDate',
};

function parseCSV(text: string): ImportRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  // 尝试匹配列头
  const mapping: (keyof ImportRow | null)[] = header.map((h) => COLUMN_ALIASES[h] ?? null);
  const rows: ImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map((v) => v.trim());
    if (vals.length === 0 || (vals.length === 1 && !vals[0])) continue;
    const row: Partial<ImportRow> = {};
    for (let j = 0; j < mapping.length && j < vals.length; j++) {
      const key = mapping[j];
      if (key) (row as any)[key] = vals[j] || undefined;
    }
    // 必须有工号和姓名
    if (row.employeeNo && row.name) {
      rows.push(row as ImportRow);
    }
  }
  return rows;
}

export default function ImportUsersPage() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ employeeNo: string; name: string; level: string; created: boolean }[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseCSV(text);
      setRows(parsed);
      setResult(null);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    if (rows.length === 0) { alert('请先选择文件'); return; }
    setBusy(true);
    const r = await fetch('/api/admin/users/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });
    setBusy(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { alert('导入失败：' + (d.error || r.status)); return; }
    setResult(d.results);
  };

  const reset = () => {
    setRows([]);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin/users" className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors cursor-pointer">← 返回用户管理</Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">批量导入员工</h1>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">上传 CSV 文件</h2>
        <p className="mt-1 text-xs text-slate-500">
          支持 CSV 格式，列头自动匹配中文名称（工号、姓名、性别、所在单位、专业、工种、入职时间）。
        </p>
        <div className="mt-4 flex gap-3">
          <input type="file" accept=".csv" ref={fileRef} onChange={handleFile}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-white transition-colors" />
          <button onClick={doImport} disabled={busy || rows.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
            {busy ? '导入中…' : `导入 ${rows.length} 条`}
          </button>
          {rows.length > 0 && (
            <button onClick={reset} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors hover:bg-slate-50 cursor-pointer">清空</button>
          )}
        </div>

        <p className="mt-2 text-xs text-slate-400">
          说明：入职时间用于自动计算能级等级（0-5年→一级，5-8年→二级，8年以上→三级）。
          导入后员工需通过注册页输入手机号认领账号。
        </p>
      </section>

      {rows.length > 0 && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">预览（{rows.length} 条）</h2>
          <div className="mt-3 max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 pr-3 font-medium">工号</th>
                  <th className="pb-2 pr-3 font-medium">姓名</th>
                  <th className="pb-2 pr-3 font-medium">性别</th>
                  <th className="pb-2 pr-3 font-medium">单位</th>
                  <th className="pb-2 pr-3 font-medium">专业</th>
                  <th className="pb-2 pr-3 font-medium">工种</th>
                  <th className="pb-2 font-medium">入职时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 font-medium">{r.employeeNo}</td>
                    <td className="py-1.5 pr-3">{r.name}</td>
                    <td className="py-1.5 pr-3">{r.gender || '—'}</td>
                    <td className="py-1.5 pr-3">{r.branchName || '—'}</td>
                    <td className="py-1.5 pr-3">{r.specialty || '—'}</td>
                    <td className="py-1.5 pr-3">{r.jobType || '—'}</td>
                    <td className="py-1.5">{r.hireDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result && (
        <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-sm font-semibold text-emerald-800">导入完成</h2>
          <p className="mt-1 text-xs text-emerald-700">
            成功导入 {result.length} 条员工记录。新建 {result.filter((r) => r.created).length} 条，更新 {result.filter((r) => !r.created).length} 条。
          </p>
          <div className="mt-3 max-h-60 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-emerald-200 text-left">
                  <th className="pb-2 pr-3 font-medium">工号</th>
                  <th className="pb-2 pr-3 font-medium">姓名</th>
                  <th className="pb-2 pr-3 font-medium">能级等级</th>
                  <th className="pb-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {result.map((r, i) => (
                  <tr key={i} className="border-b border-emerald-100">
                    <td className="py-1 pr-3 font-medium">{r.employeeNo}</td>
                    <td className="py-1 pr-3">{r.name}</td>
                    <td className="py-1 pr-3 font-semibold">{r.level}</td>
                    <td className="py-1 text-emerald-700">{r.created ? '新建' : '更新'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
