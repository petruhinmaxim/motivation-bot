import React from 'react';

export function ChartCard(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-slate-200">{props.title}</div>
      </div>
      <div className="h-72">{props.children}</div>
    </div>
  );
}

