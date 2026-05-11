import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import GuildPage from "./pages/GuildPage";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<LoginPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="guilds/:id" element={<GuildPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
