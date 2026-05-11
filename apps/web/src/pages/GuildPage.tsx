import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";

interface GuildSummary {
  id: string;
  name: string;
  iconHash: string | null;
  memberCount: number;
  isPremium: boolean;
}

export default function GuildPage() {
  const { id } = useParams();
  const [guild, setGuild] = useState<GuildSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<GuildSummary>(`/guilds/${id}`).then(setGuild).catch((err) => setError(String(err.message)));
  }, [id]);

  if (error) return <div className="text-red-400">{error}</div>;
  if (!guild) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{guild.name}</h1>
      <div className="text-slate-400">
        Members: <span className="text-white">{guild.memberCount.toLocaleString()}</span> · Premium:{" "}
        <span className="text-white">{guild.isPremium ? "yes" : "no"}</span>
      </div>
    </div>
  );
}
