import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Area
} from 'recharts';
import { RefreshCw, TrendingUp, Users, Calendar, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQoK1e41ESCtFhaPZK41hYLQ_aaDDu0KX8W4i52trG8Ye527AbwtBf_wISx7Qf6kVk2JiBcWxcFtzcp/pub?gid=1940898844&single=true&output=csv';

// Parse a date string from common Google Sheets formats
function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;

  // Try ISO format first
  let d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  // Try DD/MM/YYYY or MM/DD/YYYY
  const parts = trimmed.split(/[\/\-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(p => parseInt(p, 10));
    // Heuristic: if first part > 12, it's DD/MM/YYYY
    if (a > 12) d = new Date(c, b - 1, a);
    else d = new Date(c, a - 1, b);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Parse number, handling strings with commas, currency symbols, etc.
function parseNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Get ISO week string YYYY-Www
function getWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function Dashboard() {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [period, setPeriod] = useState('weekly'); // weekly | monthly
  const [sourceFilter, setSourceFilter] = useState('all');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(CSV_URL);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      setRawData(parsed.data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh check: every hour, see if it's past 1AM and we haven't refreshed today
    const interval = setInterval(() => {
      const now = new Date();
      if (lastUpdated) {
        const sameDay = lastUpdated.toDateString() === now.toDateString();
        if (!sameDay && now.getHours() >= 1) fetchData();
      }
    }, 60 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line
  }, []);

  // Normalize rows
  const rows = useMemo(() => {
    return rawData.map(r => {
      // Find columns case-insensitively / with flexible naming
      const keys = Object.keys(r);
      const find = (...names) => {
        for (const n of names) {
          const k = keys.find(k => k && k.trim().toLowerCase() === n.toLowerCase());
          if (k) return r[k];
        }
        return null;
      };
      return {
        source: find('Source') || 'Unknown',
        date: parseDate(find('Date')),
        bookings: parseNum(find('# Booking', 'Booking', '#Booking')),
        leads: parseNum(find('# Leads', 'Leads', '#Leads')),
        su: parseNum(find('# SU', 'SU', '#SU')),
        ns: parseNum(find('# NS', 'NS', '#NS')),
        bookingDate: parseDate(find('Booking_date', 'Booking Date', 'BookingDate')),
      };
    });
  }, [rawData]);

  const sources = useMemo(() => {
    const set = new Set(rows.map(r => r.source).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [rows]);

  const filteredRows = useMemo(() => {
    return sourceFilter === 'all' ? rows : rows.filter(r => r.source === sourceFilter);
  }, [rows, sourceFilter]);

  // KPI totals
  const totals = useMemo(() => {
    const t = filteredRows.reduce((acc, r) => {
      acc.leads += r.leads;
      acc.bookings += r.bookings;
      acc.su += r.su;
      acc.ns += r.ns;
      return acc;
    }, { leads: 0, bookings: 0, su: 0, ns: 0 });
    t.leadToBooking = t.leads > 0 ? (t.bookings / t.leads) * 100 : 0;
    t.bookingToSU = t.bookings > 0 ? (t.su / t.bookings) * 100 : 0;
    t.suToNs = (t.su + t.ns) > 0 ? (t.ns / (t.su + t.ns)) * 100 : 0;
    return t;
  }, [filteredRows]);

  // Funnel 1: Leads → Booking, aggregated by Date
  const funnel1Series = useMemo(() => {
    const buckets = {};
    filteredRows.forEach(r => {
      if (!r.date) return;
      const key = period === 'weekly' ? getWeekKey(r.date) : getMonthKey(r.date);
      if (!buckets[key]) buckets[key] = { period: key, leads: 0, bookings: 0 };
      buckets[key].leads += r.leads;
      buckets[key].bookings += r.bookings;
    });
    return Object.values(buckets)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(b => ({
        ...b,
        conversion: b.leads > 0 ? +(b.bookings / b.leads * 100).toFixed(1) : 0
      }));
  }, [filteredRows, period]);

  // Funnel 2: Booking_date → SU + NS, aggregated by Booking_date
  const funnel2Series = useMemo(() => {
    const buckets = {};
    filteredRows.forEach(r => {
      if (!r.bookingDate) return;
      const key = period === 'weekly' ? getWeekKey(r.bookingDate) : getMonthKey(r.bookingDate);
      if (!buckets[key]) buckets[key] = { period: key, su: 0, ns: 0 };
      buckets[key].su += r.su;
      buckets[key].ns += r.ns;
    });
    return Object.values(buckets)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(b => ({
        ...b,
        showRate: (b.su + b.ns) > 0 ? +(b.su / (b.su + b.ns) * 100).toFixed(1) : 0
      }));
  }, [filteredRows, period]);

  // Source breakdown for table
  const sourceBreakdown = useMemo(() => {
    const map = {};
    filteredRows.forEach(r => {
      if (!map[r.source]) map[r.source] = { source: r.source, leads: 0, bookings: 0, su: 0, ns: 0 };
      map[r.source].leads += r.leads;
      map[r.source].bookings += r.bookings;
      map[r.source].su += r.su;
      map[r.source].ns += r.ns;
    });
    return Object.values(map)
      .map(s => ({
        ...s,
        conv: s.leads > 0 ? +(s.bookings / s.leads * 100).toFixed(1) : 0,
        show: (s.su + s.ns) > 0 ? +(s.su / (s.su + s.ns) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.leads - a.leads);
  }, [filteredRows]);

  const formatTime = (d) => {
    if (!d) return '—';
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900" style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,900&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Fraunces', serif; font-optical-sizing: auto; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .grid-bg {
          background-image:
            linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px);
          background-size: 40px 40px;
        }
      `}</style>

      <div className="grid-bg min-h-screen">
        {/* Header */}
        <header className="border-b border-stone-300 bg-white">
          <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs font-mono uppercase tracking-widest text-stone-500 mb-1">Executive Dashboard</div>
              <h1 className="font-display text-4xl font-700 tracking-tight">
                Funnel <span className="italic text-amber-700">Performance</span>
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs font-mono uppercase tracking-wider text-stone-500">Last updated</div>
                <div className="text-sm font-medium">{formatTime(lastUpdated)}</div>
              </div>
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-stone-50 rounded-md hover:bg-stone-700 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-8">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4 mb-8">
            <div className="flex items-center gap-2 bg-white border border-stone-300 rounded-md p-1">
              {['weekly', 'monthly'].map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                    period === p ? 'bg-stone-900 text-stone-50' : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-mono uppercase tracking-wider text-stone-500">Source</label>
              <select
                value={sourceFilter}
                onChange={e => setSourceFilter(e.target.value)}
                className="bg-white border border-stone-300 rounded-md px-3 py-1.5 text-sm font-medium"
              >
                {sources.map(s => (
                  <option key={s} value={s}>{s === 'all' ? 'All sources' : s}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-1.5 text-sm">
                <AlertCircle size={14} /> {error}
              </div>
            )}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <KpiCard
              label="Leads"
              value={totals.leads}
              icon={<Users size={16} />}
              accent="amber"
            />
            <KpiCard
              label="Bookings"
              value={totals.bookings}
              sub={`${totals.leadToBooking.toFixed(1)}% conv.`}
              icon={<Calendar size={16} />}
              accent="emerald"
            />
            <KpiCard
              label="Show Ups (SU)"
              value={totals.su}
              sub={`${totals.bookingToSU.toFixed(1)}% of bookings`}
              icon={<CheckCircle2 size={16} />}
              accent="blue"
            />
            <KpiCard
              label="No Shows (NS)"
              value={totals.ns}
              sub={`${totals.suToNs.toFixed(1)}% no-show rate`}
              icon={<XCircle size={16} />}
              accent="rose"
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <ChartCard
              title="Leads → Bookings"
              subtitle="Acquisition funnel by Date"
              caption={`${period} aggregation`}
            >
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={funnel1Series} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#78716c' }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#78716c' }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#78716c' }} unit="%" />
                  <Tooltip
                    contentStyle={{
                      background: '#1c1917',
                      border: 'none',
                      borderRadius: 6,
                      color: '#fafaf9',
                      fontSize: 12
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="leads" fill="#d97706" name="Leads" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="left" dataKey="bookings" fill="#059669" name="Bookings" radius={[2, 2, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="conversion" stroke="#1c1917" strokeWidth={2} name="Conv %" dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Booking → SU + NS"
              subtitle="Show-up funnel by Booking_date"
              caption={`${period} aggregation`}
            >
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={funnel2Series} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#78716c' }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#78716c' }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#78716c' }} unit="%" />
                  <Tooltip
                    contentStyle={{
                      background: '#1c1917',
                      border: 'none',
                      borderRadius: 6,
                      color: '#fafaf9',
                      fontSize: 12
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="su" fill="#2563eb" name="Show Up" radius={[2, 2, 0, 0]} stackId="a" />
                  <Bar yAxisId="left" dataKey="ns" fill="#e11d48" name="No Show" radius={[2, 2, 0, 0]} stackId="a" />
                  <Line yAxisId="right" type="monotone" dataKey="showRate" stroke="#1c1917" strokeWidth={2} name="Show %" dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Source breakdown table */}
          <div className="bg-white border border-stone-300 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="font-display text-2xl font-600">Breakdown by source</h2>
                <p className="text-xs text-stone-500 font-mono uppercase tracking-wider mt-1">
                  All metrics, sorted by lead volume
                </p>
              </div>
              <TrendingUp size={20} className="text-stone-400" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-6 py-3 font-mono text-xs uppercase tracking-wider text-stone-500">Source</th>
                    <th className="text-right px-6 py-3 font-mono text-xs uppercase tracking-wider text-stone-500">Leads</th>
                    <th className="text-right px-6 py-3 font-mono text-xs uppercase tracking-wider text-stone-500">Bookings</th>
                    <th className="text-right px-6 py-3 font-mono text-xs uppercase tracking-wider text-stone-500">Conv %</th>
                    <th className="text-right px-6 py-3 font-mono text-xs uppercase tracking-wider text-stone-500">SU</th>
                    <th className="text-right px-6 py-3 font-mono text-xs uppercase tracking-wider text-stone-500">NS</th>
                    <th className="text-right px-6 py-3 font-mono text-xs uppercase tracking-wider text-stone-500">Show %</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceBreakdown.map((s, i) => (
                    <tr key={s.source} className={i % 2 === 0 ? 'bg-white' : 'bg-stone-50/40'}>
                      <td className="px-6 py-3 font-medium">{s.source}</td>
                      <td className="px-6 py-3 text-right font-mono">{s.leads.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right font-mono">{s.bookings.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right font-mono">
                        <span className={`px-2 py-0.5 rounded ${s.conv >= 20 ? 'bg-emerald-100 text-emerald-800' : s.conv >= 10 ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-700'}`}>
                          {s.conv}%
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-blue-700">{s.su.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right font-mono text-rose-700">{s.ns.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right font-mono">
                        <span className={`px-2 py-0.5 rounded ${s.show >= 70 ? 'bg-emerald-100 text-emerald-800' : s.show >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
                          {s.show}%
                        </span>
                      </td>
                    </tr>
                  ))}
                  {sourceBreakdown.length === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-stone-400">
                        No data loaded. Try refreshing.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer */}
          <footer className="mt-12 pt-6 border-t border-stone-200 flex items-center justify-between flex-wrap gap-2 text-xs text-stone-500">
            <span className="font-mono">Live from Google Sheets · auto-refresh after 1AM daily</span>
            <span>{filteredRows.length.toLocaleString()} rows · {sources.length - 1} sources</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, icon, accent }) {
  const accents = {
    amber: 'border-l-amber-600',
    emerald: 'border-l-emerald-600',
    blue: 'border-l-blue-600',
    rose: 'border-l-rose-600',
  };
  return (
    <div className={`bg-white border border-stone-300 border-l-4 ${accents[accent]} rounded-lg p-5`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono uppercase tracking-wider text-stone-500">{label}</span>
        <span className="text-stone-400">{icon}</span>
      </div>
      <div className="font-display text-4xl font-700 tabular-nums tracking-tight">
        {value.toLocaleString()}
      </div>
      {sub && (
        <div className="text-xs text-stone-500 mt-1 font-mono">{sub}</div>
      )}
    </div>
  );
}

function ChartCard({ title, subtitle, caption, children }) {
  return (
    <div className="bg-white border border-stone-300 rounded-lg p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-display text-xl font-600">{title}</h3>
          <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>
        </div>
        <span className="text-xs font-mono uppercase tracking-wider text-stone-400">{caption}</span>
      </div>
      {children}
    </div>
  );
}
