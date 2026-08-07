import React from "react";
import { fetchStats, downloadFile } from "../lib/apiClient";
import { fmtNum, fmtCurrency } from "../lib/rfpUtils";
import { Download, FileSpreadsheet } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";

const CHART_COLORS = ["#0A0A0A", "#666666", "#A3A39C", "#DCDCCF", "#D92D20"];

export default function Dashboard({ refreshKey }) {
  const [stats, setStats] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    fetchStats().then(setStats).finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading || !stats) {
    return <div className="font-mono-tight text-sm text-[#666] py-10" data-testid="dashboard-loading">Loading metrics…</div>;
  }

  const leadDist = (stats.lead_type_distribution || []).filter((d) => d.count > 0);
  const monthly = stats.monthly_series || [];
  const topClients = stats.top_clients || [];

  const donutData = leadDist.length
    ? leadDist
    : [{ lead_type: "No data", count: 1 }];

  return (
    <div data-testid="dashboard" className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6 border-b-2 border-[#0A0A0A]">
        <div>
          <div className="font-label">Operations Summary</div>
          <h2 className="font-serif-display text-4xl md:text-5xl mt-1">Dashboard</h2>
        </div>
        <div className="flex gap-3">
          <button
            data-testid="export-csv-button"
            className="btn-secondary"
            onClick={() => downloadFile("/rfps/export/csv", "rfps.csv")}
          >
            <Download size={14} strokeWidth={1.5} className="inline mr-1" /> [ Export .CSV ]
          </button>
          <button
            data-testid="export-xlsx-button"
            className="btn-primary"
            onClick={() => downloadFile("/rfps/export/xlsx", "rfps.xlsx")}
          >
            <FileSpreadsheet size={14} strokeWidth={1.5} className="inline mr-1" /> [ Export .XLSX ]
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#DCDCCF] border border-[#DCDCCF]">
        <Kpi testId="kpi-total" label="Total RFPs" value={fmtNum(stats.total_rfps)} hint="entries logged" />
        <Kpi testId="kpi-converted" label="Converted" value={fmtNum(stats.converted_rfps)} hint={`${stats.conversion_rate}% conversion`} accent="green" />
        <Kpi testId="kpi-volume" label="Total Lead Volume" value={fmtNum(stats.total_lead_volume)} hint="across all RFPs" />
        <Kpi testId="kpi-cost" label="Projected Spend" value={fmtCurrency(stats.total_lead_cost)} hint="sum of total costs" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-[#DCDCCF] border border-[#DCDCCF]">
        <ChartPanel title="Lead-type Distribution" testId="chart-lead-dist">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={donutData}
                dataKey="count"
                nameKey="lead_type"
                cx="50%" cy="50%"
                innerRadius={60} outerRadius={100}
                paddingAngle={1}
                stroke="#FFFFFF"
              >
                {donutData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, textTransform: "uppercase" }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Top Clients · Lead Volume" testId="chart-top-clients">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topClients} layout="vertical" margin={{ left: 12, right: 16 }}>
              <CartesianGrid stroke="#DCDCCF" horizontal={false} />
              <XAxis type="number" tick={axisTick} stroke="#0A0A0A" />
              <YAxis type="category" dataKey="client_id" tick={axisTick} width={80} stroke="#0A0A0A" />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="leads" fill="#0A0A0A" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Monthly · Total vs Converted" testId="chart-monthly">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={monthly}>
              <CartesianGrid stroke="#DCDCCF" vertical={false} />
              <XAxis dataKey="month" tick={axisTick} stroke="#0A0A0A" />
              <YAxis tick={axisTick} stroke="#0A0A0A" allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, textTransform: "uppercase" }} />
              <Line type="monotone" dataKey="total" stroke="#0A0A0A" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="converted" stroke="#D92D20" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      {/* TAL Match validity band */}
      <TalMatchPanel talStats={stats.tal_stats} />

      {/* Lead breakdown table */}
      <div>
        <h3 className="font-label mb-4">Lead-type Volume · breakdown</h3>
        <div className="overflow-x-auto">
          <table className="evcl-table" data-testid="lead-breakdown-table">
            <thead>
              <tr>
                <th>Lead Type</th>
                <th className="num">Aggregate Leads</th>
                <th className="num">Share %</th>
              </tr>
            </thead>
            <tbody>
              {leadDist.length === 0 && (
                <tr><td colSpan={3} className="text-center py-6 text-[#666] font-mono-tight text-sm">No leads recorded yet.</td></tr>
              )}
              {leadDist.map((r) => {
                const total = leadDist.reduce((acc, x) => acc + x.count, 0) || 1;
                return (
                  <tr key={r.lead_type}>
                    <td className="font-mono-tight uppercase">{r.lead_type}</td>
                    <td className="num">{fmtNum(r.count)}</td>
                    <td className="num">{((r.count / total) * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const Kpi = ({ label, value, hint, testId, accent }) => (
  <div data-testid={testId} className="bg-white p-6 md:p-8">
    <div className="font-label">{label}</div>
    <div className={`kpi-num mt-2 ${accent === "green" ? "text-[#039855]" : ""}`}>{value}</div>
    {hint && <div className="font-mono-tight text-xs text-[#666] mt-2">{hint}</div>}
  </div>
);

const ChartPanel = ({ title, children, testId }) => (
  <div data-testid={testId} className="bg-white p-6">
    <div className="font-label mb-3">{title}</div>
    {children}
  </div>
);

const TalMatchPanel = ({ talStats }) => {
  const stats = talStats || { tal_rfp_count: 0, avg_match_pct: 0, distribution: [] };
  const dist = stats.distribution || [];
  const empty = (stats.tal_rfp_count || 0) === 0;
  return (
    <div data-testid="chart-tal-match" className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-[#DCDCCF] border border-[#DCDCCF]">
      <div className="bg-white p-6 md:p-8">
        <div className="font-label">TAL Match Validity · avg across TAL RFPs</div>
        <div className="kpi-num mt-3" style={{fontSize:"3rem"}} data-testid="tal-avg-match">
          {stats.avg_match_pct.toFixed(2)}%
        </div>
        <div className="font-mono-tight text-xs text-[#666] mt-2">
          {stats.tal_rfp_count} TAL-scoped RFP(s) logged
        </div>
      </div>
      <div className="bg-white p-6 lg:col-span-2">
        <div className="font-label mb-3">Match % Distribution</div>
        {empty ? (
          <div className="font-mono-tight text-sm text-[#666] py-8 text-center">
            No TAL-scoped RFPs yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dist}>
              <CartesianGrid stroke="#DCDCCF" vertical={false} />
              <XAxis dataKey="bucket" tick={axisTick} stroke="#0A0A0A" />
              <YAxis tick={axisTick} stroke="#0A0A0A" allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="#0A0A0A" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

const tooltipStyle = {
  border: "1px solid #0A0A0A",
  borderRadius: 0,
  fontFamily: "IBM Plex Mono, monospace",
  fontSize: 12,
  background: "#fff",
};

const axisTick = { fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fill: "#0A0A0A" };
