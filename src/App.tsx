import { useState, useEffect } from 'react';
import { 
  Shield, 
  Search, 
  DollarSign, 
  Terminal, 
  Award, 
  Layers, 
  Info, 
  Copy, 
  Activity, 
  Key, 
  RefreshCw, 
  Star,
  Users,
  Compass,
  Cpu
} from 'lucide-react';

// API Payload interfaces
interface Agent {
  agent_id: number;
  owner: string;
  agent_uri: string;
  avg_score: number;
  unique_clients: number;
  fully_onchain: boolean;
  x402_support: boolean;
  name: string;
  description: string;
  category: string;
  avatar_url: string;
  tee_validated: boolean;
}

interface Stats {
  total_agents: number;
  avg_reputation: number;
  x402_enabled_count: number;
  x402_percentage: number;
}

interface DailyReg {
  day: string;
  new_agents: number;
}

const SQL_QUERIES = [
  {
    id: 'query1',
    title: 'Adoption Curve',
    desc: 'Measures the growth rate of new agent registrations over time since launch.',
    code: `-- QUERY 1: Adoption Curve (Registrations per Day)
SELECT
  DATE(block_timestamp) AS day,
  COUNT(*)              AS new_agents
FROM \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE address = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432'  -- IdentityRegistry address
  AND block_timestamp >= TIMESTAMP '2026-01-28'  -- Launch date partition pruning
  AND topics[SAFE_OFFSET(0)] = 
    '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'  -- Registered event signature
GROUP BY day
ORDER BY day;`
  },
  {
    id: 'query2',
    title: 'ABI Decoding in SQL',
    desc: 'Extracts agent identity and metadata pointers from raw, unparsed event logs.',
    code: `-- QUERY 2: Decode the Registered Event (Raw ABI Decoding in SQL)
SELECT
  -- Extract agentId (indexed tokenId) from the second topic element
  SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)       AS agent_id,

  -- Extract and unpad the owner wallet address
  CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27)) AS owner,

  -- Extract and decode the dynamic agent_uri string from hex bytes
  SAFE_CONVERT_BYTES_TO_STRING(FROM_HEX(SUBSTR(
    data,
    131,
    2 * SAFE_CAST(CONCAT('0x', SUBSTR(data, 67, 64)) AS INT64)
  )))                                              AS agent_uri
FROM \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE address = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432' 
  AND topics[SAFE_OFFSET(0)] = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
  AND block_timestamp >= TIMESTAMP '2026-01-28'
ORDER BY block_timestamp DESC 
LIMIT 50;`
  },
  {
    id: 'query3',
    title: 'Reputation Leaderboard',
    desc: 'Aggregates ratings for each agent. Requires a threshold of unique client reviews to prevent Sybil manipulation.',
    code: `-- QUERY 3: The Reputation Leaderboard (Aggregating Client Scores)
WITH feedback AS (
  SELECT
    -- Extract agentId (indexed uint256)
    SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)              AS agent_id,

    -- Extract and unpad client wallet address (skips leading padding zeros)
    CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))        AS client,

    -- Extract raw rating integer from Slot 1 of data payload
    SAFE_CAST(CONCAT('0x', SUBSTR(data,  67, 64)) AS INT64) AS raw_value,

    -- Extract decimal precision scaler from Slot 2 of data payload
    SAFE_CAST(CONCAT('0x', SUBSTR(data, 131, 64)) AS INT64) AS value_decimals
  FROM \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
  WHERE address = '0x8004baa17c55a88189ae136b182e5fda19de9b63'                 -- ReputationRegistry address
    AND topics[SAFE_OFFSET(0)] = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'    -- NewFeedback event
    AND block_timestamp >= TIMESTAMP '2026-01-28'
    AND SUBSTR(data, 67, 1) != 'f'               -- Skip negative ratings
)
SELECT 
  agent_id, 
  COUNT(*) AS feedback_count,
  COUNT(DISTINCT client)                             AS unique_clients, -- Sybil protection barrier
  ROUND(AVG(raw_value / POW(10, value_decimals)), 2) AS avg_score
FROM feedback 
GROUP BY agent_id
HAVING unique_clients >= 3                       -- Sybil barrier: requires reviews from at least 3 distinct wallets
ORDER BY avg_score DESC, unique_clients DESC 
LIMIT 20;`
  },
  {
    id: 'query4',
    title: 'The x402 JOIN Query',
    desc: 'Joins Identity and Reputation datasets and extracts the x402Support property directly from base64-encoded on-chain payloads.',
    code: `-- QUERY 4: Trustworthy & Payable (JOIN + Base64 Decoding)
WITH agents AS (
  SELECT
    SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)       AS agent_id,
    CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27)) AS owner,
    SAFE_CONVERT_BYTES_TO_STRING(FROM_HEX(SUBSTR(
      data,
      131,
      2 * SAFE_CAST(CONCAT('0x', SUBSTR(data, 67, 64)) AS INT64)
    )))                                              AS agent_uri
  FROM \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
  WHERE address = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432' 
    AND topics[SAFE_OFFSET(0)] = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
    AND block_timestamp >= TIMESTAMP '2026-01-28'
),
scores AS (
  SELECT
    SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64) AS agent_id,
    COUNT(DISTINCT CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))) AS unique_clients,
    ROUND(AVG(
      SAFE_CAST(CONCAT('0x', SUBSTR(data,  67, 64)) AS INT64) / 
      POW(10, SAFE_CAST(CONCAT('0x53', SUBSTR(data, 131, 64)) AS INT64))
    ), 2) AS avg_score
  FROM \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
  WHERE address = '0x8004baa17c55a88189ae136b182e5fda19de9b63'
    AND topics[SAFE_OFFSET(0)] = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'
    AND block_timestamp >= TIMESTAMP '2026-01-28'
    AND SUBSTR(data, 67, 1) != 'f'
  GROUP BY 1
)
SELECT 
  a.agent_id, 
  a.agent_uri, 
  s.avg_score, 
  s.unique_clients,
  STARTS_WITH(a.agent_uri, 'data:application/json;base64,') AS fully_onchain,
  IF(
    STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
    JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
      SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
    )), '$.x402Support'),
    NULL
  ) AS x402_support
FROM agents a 
JOIN scores s USING (agent_id)
ORDER BY s.avg_score DESC;`
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'directory' | 'leaderboard' | 'console'>('dashboard');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [isMockMode, setIsMockMode] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // App Data States
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<Stats>({ total_agents: 0, avg_reputation: 0, x402_enabled_count: 0, x402_percentage: 0 });
  const [analytics, setAnalytics] = useState<DailyReg[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [filterX402, setFilterX402] = useState(false);
  const [filterTEE, setFilterTEE] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // SQL Console States
  const [selectedQueryId, setSelectedQueryId] = useState('query1');
  const [copiedQuery, setCopiedQuery] = useState(false);

  // Connection Setup Modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setConnected(data.connected);
      setIsMockMode(data.using_mock || false);
      return data.connected || data.using_mock;
    } catch (err) {
      setConnected(false);
      setIsMockMode(true);
      return false;
    }
  };

  const loadDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const statsRes = await fetch('/api/stats');
      const agentsRes = await fetch('/api/agents');
      const leadRes = await fetch('/api/leaderboard');
      const analyticRes = await fetch('/api/analytics');

      if (!statsRes.ok || !agentsRes.ok || !leadRes.ok || !analyticRes.ok) {
        throw new Error("Failed to load BigQuery data from backend API.");
      }

      const statsData = await statsRes.json();
      const agentsData = await agentsRes.json();
      const leadData = await leadRes.json();
      const analyticData = await analyticRes.json();

      setStats(statsData);
      setAgents(agentsData);
      setLeaderboard(leadData);
      setAnalytics(analyticData);
    } catch (err: any) {
      setError(err.message || "An unknown error occurred while retrieving data.");
    } finally {
      setLoading(false);
    }
  };

  const checkAndLoad = async () => {
    await fetchStatus();
    await loadDashboardData();
  };

  useEffect(() => {
    checkAndLoad();
  }, []);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    const res = await fetch('/api/status');
    const data = await res.json();
    setConnected(data.connected);
    setIsMockMode(data.using_mock || false);

    if (data.connected) {
      await loadDashboardData();
      setShowSetupModal(false);
      alert("Successfully connected to live BigQuery Ethereum mainnet dataset!");
    } else {
      alert("Connection failed. Make sure 'gcp-service-account.json' and '.env' are correctly configured in the project root.");
    }
    setTestingConnection(false);
  };

  // Helper to copy SQL query to clipboard
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 2000);
  };

  // Filters logic
  const filteredAgents = agents.filter(agent => {
    const matchesSearch = 
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.owner.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(agent.agent_id).includes(searchQuery);

    const matchesX402 = !filterX402 || agent.x402_support;
    const matchesTEE = !filterTEE || agent.tee_validated;
    const matchesCategory = selectedCategory === 'all' || agent.category.toLowerCase() === selectedCategory.toLowerCase();

    return matchesSearch && matchesX402 && matchesTEE && matchesCategory;
  });

  // Calculate categories count for bar charts
  const categoryCounts = agents.reduce((acc: { [key: string]: number }, agent) => {
    const cat = agent.category || 'AI General';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  // Draw custom SVG Area Chart for registrations
  const renderSvgChart = () => {
    if (analytics.length === 0) return null;
    const maxVal = Math.max(...analytics.map(d => d.new_agents), 4);
    const width = 600;
    const height = 180;
    const paddingLeft = 30;
    const paddingRight = 10;
    const paddingTop = 20;
    const paddingBottom = 25;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const points = analytics.map((d, index) => {
      const x = paddingLeft + (index / (analytics.length - 1)) * chartWidth;
      const y = paddingTop + chartHeight - (d.new_agents / maxVal) * chartHeight;
      return { x, y, ...d };
    });

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - paddingBottom} L ${points[0].x} ${height - paddingBottom} Z`;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
        <defs>
          <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
          const y = paddingTop + chartHeight * r;
          const gridVal = Math.round(maxVal * (1 - r));
          return (
            <g key={i}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
              <text x={paddingLeft - 8} y={y + 4} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="monospace">{gridVal}</text>
            </g>
          );
        })}

        {/* Chart Paths */}
        <path d={areaPath} fill="url(#chartGlow)" />
        <path d={linePath} fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" />

        {/* Highlight points */}
        {points.map((p, i) => (
          <circle 
            key={i} 
            cx={p.x} 
            cy={p.y} 
            r="3" 
            fill="#a78bfa" 
            stroke="#0b0813" 
            strokeWidth="1.5"
            className="cursor-pointer hover:r-5 transition-all"
          >
            <title>{p.day}: {p.new_agents}</title>
          </circle>
        ))}

        {/* X Axis labels */}
        {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 5)) === 0).map((p, i) => (
          <text 
            key={i} 
            x={p.x} 
            y={height - 8} 
            fill="#64748b" 
            fontSize="9" 
            textAnchor="middle"
          >
            {p.day.substring(5)}
          </text>
        ))}
      </svg>
    );
  };

  // If loading status
  if (connected === null) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">Initializing Trust402 Explorer...</div>
      </div>
    );
  }

  return (
    <>
      {/* Navigation Header */}
      <header>
        <div className="header-container">
          <div className="logo-section">
            <div className="logo-icon">
              <Cpu size={22} />
            </div>
            <span className="logo-text">Trust402</span>
            <span className="logo-badge">ERC-8004</span>
          </div>

          <nav>
            <button 
              className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <Activity size={16} />
              Dashboard
            </button>
            <button 
              className={`nav-tab ${activeTab === 'directory' ? 'active' : ''}`}
              onClick={() => setActiveTab('directory')}
            >
              <Compass size={16} />
              Directory
            </button>
            <button 
              className={`nav-tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('leaderboard')}
            >
              <Award size={16} />
              Leaderboard
            </button>
            <button 
              className={`nav-tab ${activeTab === 'console' ? 'active' : ''}`}
              onClick={() => setActiveTab('console')}
            >
              <Terminal size={16} />
              SQL Sandbox
            </button>
          </nav>

          <div 
            className="connection-status cursor-pointer hover:bg-white/5 transition-all"
            onClick={() => setShowSetupModal(true)}
            title="Configure Google Cloud BigQuery settings"
          >
            <div className={`status-indicator ${connected ? 'connected' : 'disconnected'}`}></div>
            <span>{connected ? "BigQuery Online" : "Demo Mode (Mock)"}</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="container">
        {isMockMode && (
          <div className="glass-panel p-4 mb-6 flex justify-between items-center bg-purple-950/20 border-purple-900/30 fade-in">
            <div className="flex items-center gap-3">
              <Info size={18} className="text-pink-400 flex-shrink-0" />
              <span className="text-sm text-gray-200">
                <strong>Demo Mode:</strong> Running with simulated Ethereum log data. Click the setup button to connect your live Google BigQuery datasets.
              </span>
            </div>
            <button 
              onClick={() => setShowSetupModal(true)} 
              className="code-btn"
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
            >
              <Key size={12} />
              Setup Live BigQuery
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Executing BigQuery Ethereum Pipeline...</div>
          </div>
        ) : error ? (
          <div className="glass-panel p-8 text-center max-w-xl mx-auto my-8 fade-in">
            <div className="text-red-500 text-3xl mb-4">⚠️</div>
            <h3 className="text-xl font-bold mb-2">BigQuery Query Failed</h3>
            <p className="text-gray-400 mb-6 text-sm">{error}</p>
            <button onClick={loadDashboardData} className="retry-btn">
              Retry Queries
            </button>
          </div>
        ) : (
          <div className="fade-in">
            
            {/* TAB: DASHBOARD */}
            {activeTab === 'dashboard' && (
              <>
                <div className="stats-grid">
                  <div className="glass-panel stat-card">
                    <div className="stat-header">
                      <span>Total Registered Agents</span>
                      <Users size={16} className="text-purple-400" />
                    </div>
                    <div className="stat-value">{stats.total_agents}</div>
                    <div className="stat-footer">
                      <span>Identity registry: 0x8004a1...</span>
                    </div>
                  </div>

                  <div className="glass-panel stat-card accent">
                    <div className="stat-header">
                      <span>Average Reputation Score</span>
                      <Star size={16} className="text-pink-400" fill="currentColor" />
                    </div>
                    <div className="stat-value">{(stats.avg_reputation / 20).toFixed(1)} / 5.0</div>
                    <div className="stat-footer">
                      <span>Derived from feedback ({stats.avg_reputation.toFixed(1)}%)</span>
                    </div>
                  </div>

                  <div className="glass-panel stat-card success">
                    <div className="stat-header">
                      <span>x402 Micropayments Enabled</span>
                      <DollarSign size={16} className="text-emerald-400" />
                    </div>
                    <div className="stat-value">{stats.x402_enabled_count}</div>
                    <div className="stat-footer">
                      <span>{stats.x402_percentage.toFixed(1)}% of registered fleet</span>
                    </div>
                  </div>

                  <div className="glass-panel stat-card warning">
                    <div className="stat-header">
                      <span>TEE-Secured Validations</span>
                      <Shield size={16} className="text-amber-400" />
                    </div>
                    <div className="stat-value">
                      {agents.filter(a => a.tee_validated).length}
                    </div>
                    <div className="stat-footer">
                      <span>Verified via ValidationRegistry</span>
                    </div>
                  </div>
                </div>

                <div className="charts-grid">
                  <div className="glass-panel chart-card">
                    <h3 className="chart-title">
                      <Activity size={18} className="text-purple-400" />
                      Agent Registrations Adoption Curve
                    </h3>
                    <div className="svg-chart-container">
                      {renderSvgChart()}
                    </div>
                  </div>

                  <div className="glass-panel chart-card">
                    <h3 className="chart-title">
                      <Layers size={18} className="text-pink-400" />
                      Fleet Categories Distribution
                    </h3>
                    <div className="category-bars mt-4">
                      {Object.keys(categoryCounts).length === 0 ? (
                        <div className="text-center text-sm text-gray-500 py-12">No categorized agents</div>
                      ) : (
                        Object.entries(categoryCounts).map(([cat, val]) => {
                          const pct = (val / stats.total_agents) * 100;
                          return (
                            <div className="category-bar-item" key={cat}>
                              <div className="category-label">
                                <span>{cat}</span>
                                <span className="text-gray-400 font-mono">{val} ({pct.toFixed(0)}%)</span>
                              </div>
                              <div className="category-bar-bg">
                                <div className="category-bar-fill" style={{ width: `${pct}%` }}></div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                <div className="glass-panel p-6 mb-4 flex items-start gap-4">
                  <Info size={24} className="text-purple-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold mb-1">About the ERC-8004 &amp; x402 Trust Layer</h4>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      ERC-8004 is a standard that creates a trust, identity, and reputation layer for autonomous AI agents on EVM blockchains. 
                      By combining ERC-8004 on-chain reputation scores with x402 payment support metadata, applications can query Google BigQuery 
                      to dynamically discover trustworthy, verified agents and invoke them utilizing zero-friction micro-payments.
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* TAB: DIRECTORY */}
            {activeTab === 'directory' && (
              <>
                <div className="glass-panel filter-panel">
                  <div className="search-wrapper">
                    <Search size={18} className="search-icon" />
                    <input 
                      type="text" 
                      placeholder="Search agents by ID, name, owner, or category..." 
                      className="search-input"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="filter-group">
                    <button 
                      className={`filter-btn ${filterX402 ? 'active' : ''}`}
                      onClick={() => setFilterX402(!filterX402)}
                    >
                      <DollarSign size={15} />
                      x402 Support
                    </button>
                    <button 
                      className={`filter-btn ${filterTEE ? 'active' : ''}`}
                      onClick={() => setFilterTEE(!filterTEE)}
                    >
                      <Shield size={15} />
                      TEE Validated
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <select
                      className="filter-btn active"
                      style={{ background: 'rgba(18, 12, 38, 0.8)', border: '1px solid var(--panel-border)', outline: 'none' }}
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                      <option value="all">All Categories</option>
                      {Object.keys(categoryCounts).map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {filteredAgents.length === 0 ? (
                  <div className="glass-panel p-16 text-center text-gray-500">
                    No agents match your current query filters.
                  </div>
                ) : (
                  <div className="agents-grid">
                    {filteredAgents.map(agent => (
                      <div className={`glass-panel agent-card ${agent.x402_support ? 'payable' : ''}`} key={agent.agent_id}>
                        <div>
                          <div className="agent-card-header">
                            <img 
                              src={agent.avatar_url || `https://api.dicebear.com/7.x/identicon/svg?seed=agent-${agent.agent_id}`}
                              alt={agent.name} 
                              className="agent-avatar"
                            />
                            <div className="agent-title-info">
                              <span className="agent-id-tag">AGENT #{agent.agent_id}</span>
                              <h3 className="agent-name">{agent.name}</h3>
                              <span className="agent-category-badge">{agent.category}</span>
                            </div>
                          </div>

                          <p className="agent-desc">{agent.description}</p>

                          <div className="agent-stats">
                            <div className="agent-stat-item">
                              <span className="agent-stat-label">Reputation</span>
                              <span className="agent-stat-value">
                                {agent.avg_score > 0 ? (
                                  <>
                                    <Star size={14} className="text-yellow-400" fill="currentColor" />
                                    <span>{(agent.avg_score / 20).toFixed(1)}</span>
                                    <span className="text-xs text-gray-400 font-normal">({agent.unique_clients} client{agent.unique_clients > 1 ? 's' : ''})</span>
                                  </>
                                ) : (
                                  <span className="text-gray-500 text-sm font-normal">No Reviews</span>
                                )}
                              </span>
                            </div>
                            <div className="agent-stat-item">
                              <span className="agent-stat-label">Onchain Sync</span>
                              <span className="agent-stat-value text-xs font-mono text-purple-400">
                                {agent.fully_onchain ? "100% onchain metadata" : "URI metadata resolved"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="agent-card-footer">
                          <div 
                            className="address-pill"
                            onClick={() => {
                              navigator.clipboard.writeText(agent.owner);
                              alert("Owner address copied to clipboard!");
                            }}
                          >
                            <span>{agent.owner.substring(0, 6)}...{agent.owner.substring(agent.owner.length - 4)}</span>
                            <Copy size={12} />
                          </div>

                          <div className="flex gap-2">
                            {agent.tee_validated && (
                              <span className="badge success" title="TEE Validated cryptography">
                                <Shield size={12} />
                                TEE
                              </span>
                            )}
                            {agent.x402_support ? (
                              <span className="badge success">
                                <DollarSign size={12} />
                                x402
                              </span>
                            ) : (
                              <span className="badge muted">
                                Free/No payment metadata
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* TAB: LEADERBOARD */}
            {activeTab === 'leaderboard' && (
              <div className="glass-panel leaderboard-container">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <Award className="text-yellow-400" />
                      On-Chain Reputation Leaderboard
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">
                      Aggregates client feedback ratings. Implements Sybil protection by excluding agents with &lt; 3 unique clients.
                    </p>
                  </div>
                </div>

                <div className="leaderboard-table-wrapper">
                  <table className="leaderboard-table">
                    <thead>
                      <tr>
                        <th className="rank-cell">Rank</th>
                        <th>Agent</th>
                        <th>Avg Rating</th>
                        <th>Total Reviews</th>
                        <th>Unique Clients</th>
                        <th>x402 Payments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center text-gray-500 py-12">
                            No agents have met the Sybil barrier threshold (minimum 3 unique client reviews).
                          </td>
                        </tr>
                      ) : (
                        leaderboard.map((item, index) => (
                          <tr key={item.agent_id}>
                            <td className={`rank-cell top-${index + 1}`}>
                              {index + 1}
                            </td>
                            <td>
                              <div className="agent-cell">
                                <div className="logo-icon" style={{ width: '30px', height: '30px', borderRadius: '6px' }}>
                                  <Cpu size={14} />
                                </div>
                                <div>
                                  <span className="font-bold block">{item.name}</span>
                                  <span className="text-xs text-gray-400 font-mono">Agent ID: #{item.agent_id}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="flex items-center gap-1">
                                <Star size={14} className="text-yellow-400" fill="currentColor" />
                                <span className="font-bold font-mono">{(item.avg_score / 20).toFixed(1)}</span>
                                <span className="text-xs text-gray-400">/ 5.0</span>
                              </div>
                            </td>
                            <td className="font-mono">{item.feedback_count}</td>
                            <td className="font-mono">{item.unique_clients}</td>
                            <td>
                              {item.x402_support ? (
                                <span className="badge success w-fit">
                                  <DollarSign size={12} />
                                  x402 Enabled
                                </span>
                              ) : (
                                <span className="badge muted w-fit">No Pay Meta</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB: SQL PLAYGROUND */}
            {activeTab === 'console' && (
              <div className="console-layout">
                <div className="console-sidebar">
                  {SQL_QUERIES.map(q => (
                    <button
                      key={q.id}
                      className={`query-selector-btn ${selectedQueryId === q.id ? 'active' : ''}`}
                      onClick={() => setSelectedQueryId(q.id)}
                    >
                      <span className="query-selector-title">{q.title}</span>
                      <span className="query-selector-desc">{q.desc}</span>
                    </button>
                  ))}
                </div>

                <div className="glass-panel console-main">
                  {(() => {
                    const q = SQL_QUERIES.find(x => x.id === selectedQueryId)!;
                    return (
                      <>
                        <div className="code-header">
                          <div className="code-header-info">
                            <Terminal size={18} className="text-purple-400" />
                            <h3 className="code-title">{q.title} Query</h3>
                          </div>
                          <button 
                            className="code-btn"
                            onClick={() => handleCopyCode(q.code)}
                          >
                            <Copy size={14} />
                            {copiedQuery ? "Copied!" : "Copy SQL"}
                          </button>
                        </div>

                        <p className="text-sm text-gray-300 leading-relaxed mb-2">{q.desc}</p>

                        <pre>
                          <code>
                            {q.code.split('\n').map((line, idx) => {
                              if (line.trim().startsWith('--')) {
                                return <div key={idx} className="sql-comment">{line}</div>;
                              }
                              return <div key={idx}>{line}</div>;
                            })}
                          </code>
                        </pre>

                        <div className="flex items-start gap-3 bg-purple-950/20 border border-purple-900/30 p-4 rounded-lg text-sm text-purple-200">
                          <Info size={16} className="text-purple-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <strong>BigQuery Integration Note:</strong> These queries execute in real-time on our Go server against the 
                            <code>bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs</code> table, which provides Ethereum event logs 
                            synced on Google Cloud BigQuery in near real-time.
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

          </div>
        )}
      </main>

      {/* Setup Config Modal */}
      {showSetupModal && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(6, 4, 10, 0.85)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '2rem'
        }}>
          <div className="glass-panel setup-page-container fade-in" style={{ margin: 0, maxWidth: '650px', background: 'var(--bg-base)', border: '1px solid var(--panel-border-hover)' }}>
            <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Key className="text-purple-400" />
                GCP BigQuery Connection Setup
              </h3>
              <button 
                onClick={() => setShowSetupModal(false)} 
                className="code-btn"
                style={{ padding: '0.25rem 0.6rem' }}
              >
                ✕
              </button>
            </div>

            <div className="setup-steps text-left mb-6" style={{ background: 'rgba(0,0,0,0.3)', maxHeight: '350px', overflowY: 'auto' }}>
              <div className="setup-step">
                <div className="step-num">1</div>
                <div className="step-text">
                  Go to your <strong>Google Cloud Console</strong> &gt; <strong>IAM &amp; Admin</strong> &gt; <strong>Service Accounts</strong>.
                </div>
              </div>
              <div className="setup-step">
                <div className="step-num">2</div>
                <div className="step-text">
                  Create a service account with the <strong>BigQuery User</strong> role (for reading public datasets).
                </div>
              </div>
              <div className="setup-step">
                <div className="step-num">3</div>
                <div className="step-text">
                  Create a new <strong>JSON Key</strong> for this service account, download it, and rename it to <code>gcp-service-account.json</code>.
                </div>
              </div>
              <div className="setup-step">
                <div className="step-num">4</div>
                <div className="step-text">
                  Place <code>gcp-service-account.json</code> in the project's root folder: <br />
                  <code style={{ fontSize: '11px', display: 'inline-block', marginTop: '6px', wordBreak: 'break-all' }}>/Users/jlin/work/eth-global-nyc-2026/gcp-service-account.json</code>
                </div>
              </div>
              <div className="setup-step">
                <div className="step-num">5</div>
                <div className="step-text">
                  Create a <code>.env</code> file in the root folder with:<br />
                  <code>GOOGLE_APPLICATION_CREDENTIALS=gcp-service-account.json</code>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowSetupModal(false)} 
                className="filter-btn"
              >
                Close
              </button>
              <button 
                onClick={handleTestConnection} 
                disabled={testingConnection}
                className="retry-btn flex items-center gap-2"
                style={{ padding: '0.6rem 1.5rem', fontSize: '0.9rem' }}
              >
                {testingConnection ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Test &amp; Connect Live
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto border-t border-panel-border py-6 text-center text-xs text-text-muted">
        <p>Trust402 Explorer &copy; 2026 - Powered by Google BigQuery Ethereum Logs Platform &amp; Go</p>
      </footer>
    </>
  );
}
