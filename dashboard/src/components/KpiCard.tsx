import React from 'react';

export function KpiCard(props: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
      <div className="text-sm text-slate-400">{props.label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{props.value}</div>
      {props.hint ? <div className="mt-1 text-xs text-slate-500">{props.hint}</div> : null}
    </div>
  );
}

