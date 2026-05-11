import { Link, Outlet, useLocation } from "react-router-dom";

export default function App() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 to-slate-900 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Bot Panel
          </Link>
          <nav className="flex gap-6 text-sm">
            <Link
              to="/dashboard"
              className={pathname.startsWith("/dashboard") ? "text-white" : "text-slate-400 hover:text-white"}
            >
              Dashboard
            </Link>
            <a
              href="https://github.com/Mirovozzrenieereal"
              className="text-slate-400 hover:text-white"
              target="_blank"
              rel="noreferrer"
            >
              Docs
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
