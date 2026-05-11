import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface GlobalStats {
  users: number;
  guilds: number;
  transactions: number;
  shardPing: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<GlobalStats>("/stats/global").then(setStats).catch((err) => setError(String(err.message)));
  }, []);

  if (error) {
    return <div className="text-red-400">Failed to load: {error}</div>;
  }
  if (!stats) {
    return <div className="text-slate-400">Loading…</div>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card title="Users" value={stats.users.toLocaleString()} />
      <Card title="Servers" value={stats.guilds.toLocaleString()} />
      <Card title="Transactions" value={stats.transactions.toLocaleString()} />
      <Card title="Shard ping" value={`${stats.shardPing} ms`} />
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow">
      <div className="text-xs uppercase tracking-widest text-slate-400">{title}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </div>
  );
}
