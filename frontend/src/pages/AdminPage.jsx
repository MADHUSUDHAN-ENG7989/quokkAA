import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import './AdminPage.css';

const API = 'http://localhost:8000';

export default function AdminPage({ onBack }) {
    const { token } = useAuth();
    const [metrics, setMetrics] = useState(null);
    const [logs, setLogs] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('metrics');

    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    useEffect(() => {
        fetchMetrics();
        fetchLogs(1);
    }, []);

    const fetchMetrics = async () => {
        try {
            const res = await fetch(`${API}/api/admin/metrics`, { headers: authHeaders });
            const data = await res.json();
            setMetrics(data);
        } catch (e) {
            console.error('Metrics error:', e);
        }
    };

    const fetchLogs = async (page = 1) => {
        setLoading(true);
        try {
            const res = await fetch(`${API}/api/admin/logs?page=${page}&limit=15`, { headers: authHeaders });
            const data = await res.json();
            setLogs(data.logs || []);
            setPagination({ page: data.page, totalPages: data.totalPages, total: data.total });
        } catch (e) {
            console.error('Logs error:', e);
        } finally {
            setLoading(false);
        }
    };

    const formatTime = (ms) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
    const formatDate = (ts) => new Date(ts).toLocaleString();

    return (
        <div className="admin-page">
            {/* Header */}
            <div className="admin-header">
                <div className="admin-brand">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                    <span>Quokka Admin</span>
                </div>
                <button className="admin-back-btn" onClick={onBack}>← Back to Chat</button>
            </div>

            {/* Tabs */}
            <div className="admin-tabs">
                <button className={`admin-tab ${activeTab === 'metrics' ? 'active' : ''}`} onClick={() => setActiveTab('metrics')}>
                    📊 Metrics
                </button>
                <button className={`admin-tab ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => { setActiveTab('logs'); fetchLogs(pagination.page); }}>
                    📋 Query Logs
                </button>
            </div>

            <div className="admin-body">
                {/* METRICS TAB */}
                {activeTab === 'metrics' && metrics && (
                    <div className="metrics-section">
                        <div className="metrics-grid">
                            <div className="metric-card">
                                <div className="metric-icon blue">📨</div>
                                <div className="metric-value">{metrics.total}</div>
                                <div className="metric-label">Total Queries</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-icon green">⚡</div>
                                <div className="metric-value">{formatTime(metrics.avgResponseTime)}</div>
                                <div className="metric-label">Avg Response Time</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-icon purple">🎯</div>
                                <div className="metric-value">{metrics.ragHitRate}%</div>
                                <div className="metric-label">RAG Hit Rate</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-icon orange">📚</div>
                                <div className="metric-value">{metrics.ragHits}</div>
                                <div className="metric-label">RAG Context Used</div>
                            </div>
                        </div>

                        {/* Top Queries */}
                        <div className="admin-card">
                            <h3>🔥 Top Repeated Queries</h3>
                            {metrics.topQueries && metrics.topQueries.length > 0 ? (
                                <table className="admin-table">
                                    <thead>
                                        <tr><th>Query</th><th>Count</th></tr>
                                    </thead>
                                    <tbody>
                                        {metrics.topQueries.map((q, i) => (
                                            <tr key={i}>
                                                <td className="query-cell">{q._id}</td>
                                                <td><span className="badge">{q.count}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : <p className="empty-table">No queries yet.</p>}
                        </div>

                        {/* Queries Per Day */}
                        <div className="admin-card">
                            <h3>📅 Queries (Last 7 Days)</h3>
                            {metrics.queriesPerDay && metrics.queriesPerDay.length > 0 ? (
                                <div className="bar-chart">
                                    {metrics.queriesPerDay.map((d, i) => {
                                        const max = Math.max(...metrics.queriesPerDay.map(x => x.count));
                                        return (
                                            <div key={i} className="bar-item">
                                                <div className="bar-fill" style={{ height: `${(d.count / max) * 100}%` }}></div>
                                                <span className="bar-count">{d.count}</span>
                                                <span className="bar-label">{d._id.split('-').slice(1).join('/')}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : <p className="empty-table">No data for last 7 days.</p>}
                        </div>
                    </div>
                )}

                {/* LOGS TAB */}
                {activeTab === 'logs' && (
                    <div className="logs-section">
                        <div className="admin-card">
                            <div className="logs-header-row">
                                <h3>Query Logs <span className="total-badge">{pagination.total} total</span></h3>
                                <button className="refresh-btn" onClick={() => fetchLogs(pagination.page)}>↻ Refresh</button>
                            </div>
                            {loading ? (
                                <div className="admin-loading">Loading logs...</div>
                            ) : logs.length === 0 ? (
                                <p className="empty-table">No logs yet.</p>
                            ) : (
                                <>
                                    <div className="table-wrap">
                                        <table className="admin-table">
                                            <thead>
                                                <tr>
                                                    <th>Timestamp</th>
                                                    <th>User</th>
                                                    <th>Query</th>
                                                    <th>Response Time</th>
                                                    <th>Knowledge Source</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {logs.map((log, i) => (
                                                    <tr key={i}>
                                                        <td className="time-cell">{formatDate(log.timestamp)}</td>
                                                        <td><span className="user-chip">{log.userEmail}</span></td>
                                                        <td className="query-cell" title={log.query}>{log.query.substring(0, 60)}{log.query.length > 60 ? '...' : ''}</td>
                                                        <td>{formatTime(log.responseTimeMs)}</td>
                                                        <td>{log.usedRagContext ? <span className="rag-yes">📚 RAG Context</span> : <span className="rag-no">🧠 Internal Knowledge</span>}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {/* Pagination */}
                                    <div className="pagination">
                                        <button disabled={pagination.page <= 1} onClick={() => fetchLogs(pagination.page - 1)}>← Prev</button>
                                        <span>Page {pagination.page} of {pagination.totalPages}</span>
                                        <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchLogs(pagination.page + 1)}>Next →</button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
