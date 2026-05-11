import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { setToken, getToken } from "@/lib/api";

export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setToken(token);
      navigate("/dashboard", { replace: true });
    } else if (getToken()) {
      navigate("/dashboard", { replace: true });
    }
  }, [params, navigate]);

  return (
    <div className="grid place-items-center py-32">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-slate-400">
          Manage your servers, see global stats, configure modules.
        </p>
        <a
          href="/auth/login"
          className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-brand-600"
        >
          Continue with Discord
        </a>
      </div>
    </div>
  );
}
