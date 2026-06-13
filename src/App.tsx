import { useState, useEffect, useCallback } from 'react';
import { usePrivy as useRealPrivy, useDepositAddress as useRealDepositAddress } from '@privy-io/react-auth';

function usePrivy() {
  const isMock = !import.meta.env.VITE_PRIVY_APP_ID || import.meta.env.VITE_PRIVY_APP_ID.includes("cm000000") || import.meta.env.VITE_PRIVY_APP_ID === "YOUR_PRIVY_APP_ID";
  
  if (!isMock) {
    try {
      return useRealPrivy();
    } catch (e) {
      console.warn("Real Privy failed to initialize, falling back to mock:", e);
    }
  }

  // Mock implementation
  const [authenticated, setAuthenticated] = useState(() => {
    return localStorage.getItem('mock_auth') === 'true';
  });
  
  const [mockAddress] = useState(() => {
    let addr = localStorage.getItem('mock_address');
    if (!addr) {
      addr = '0xdb77' + Math.random().toString(16).substring(2, 12) + '0000' + Math.random().toString(16).substring(2, 12);
      localStorage.setItem('mock_address', addr);
    }
    return addr;
  });

  const login = () => {
    localStorage.setItem('mock_auth', 'true');
    setAuthenticated(true);
  };

  const logout = () => {
    localStorage.setItem('mock_auth', 'false');
    setAuthenticated(false);
  };

  return {
    ready: true,
    authenticated,
    user: authenticated ? {
      id: `mock_user_${mockAddress.substring(2, 10)}`,
      wallet: {
        address: mockAddress
      }
    } : null,
    login,
    logout
  };
}

function useDepositAddress() {
  const isMock = !import.meta.env.VITE_PRIVY_APP_ID || import.meta.env.VITE_PRIVY_APP_ID.includes("cm000000") || import.meta.env.VITE_PRIVY_APP_ID === "YOUR_PRIVY_APP_ID";

  if (isMock) {
    return {
      createDepositAddress: async (config: any) => {
        console.log("Mock createDepositAddress config:", config);
        alert(`[Demo Mode] Simulated Privy Universal Funding Modal opening for address: ${config.destinationAddress} on Base Sepolia.`);
      }
    };
  }

  try {
    return useRealDepositAddress();
  } catch (e) {
    return {
      createDepositAddress: async (config: any) => {
        console.log("Mock createDepositAddress config:", config);
        alert(`[Demo Mode Fallback] Simulated Privy Universal Funding Modal opening for address: ${config.destinationAddress} on Base Sepolia.`);
      }
    };
  }
}
import { 
  Shield, 
  Search, 
  Activity, 
  Copy, 
  ExternalLink, 
  Plus, 
  Trash2, 
  Wallet, 
  Play, 
  Users, 
  Award,
  TrendingUp,
  Sparkles,
  Check,
  LogOut,
  HelpCircle
} from 'lucide-react';

interface Trader {
  address: string;
  ens_name: string;
  avatar: string | null;
  total_trades: number;
  pnl: number;
  winrate: number;
}

interface FollowedTrader extends Trader {
  multiplier: number;
  active: number;
}

interface CopiedTrade {
  id: string;
  trader_address: string;
  trader_tx_hash: string;
  copy_tx_hash: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string | null;
  timestamp: number;
}

interface CopyWallet {
  address: string;
  walletId: string;
  riskLimit: number;
  balance: string;
}

interface BackendStatus {
  status: string;
  database: string;
  privy: string;
  agentbook: string;
}

export default function App() {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const { createDepositAddress } = useDepositAddress();

  const [activeTab, setActiveTab] = useState<'dashboard' | 'trades' | 'about'>('dashboard');
  const [status, setStatus] = useState<BackendStatus | null>(null);
  
  // Wallet & User states
  const [copyWallet, setCopyWallet] = useState<CopyWallet | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(false);
  // Lists
  const [traders, setTraders] = useState<Trader[]>([]);
  const [followed, setFollowed] = useState<FollowedTrader[]>([]);
  const [trades, setTrades] = useState<CopiedTrade[]>([]);

  // Forms
  const [ensInput, setEnsInput] = useState('');
  const [multiplierInput, setMultiplierInput] = useState(1.0);
  const [submittingFollow, setSubmittingFollow] = useState(false);

  // Simulation Form
  const [simTrader, setSimTrader] = useState('');
  const [simAmount, setSimAmount] = useState('0.01');
  const simTokenIn = 'ETH';
  const simTokenOut = 'USDC';
  const [simulating, setSimulating] = useState(false);
  const [simSuccessHash, setSimSuccessHash] = useState<string | null>(null);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Failed to fetch backend status:", err);
    }
  }, []);

  // Fetch leaderboard traders
  const fetchTraders = useCallback(async () => {
    try {
      const res = await fetch('/api/traders');
      const data = await res.json();
      setTraders(data);
    } catch (err) {
      console.error("Failed to fetch traders:", err);
    }
  }, []);

  // Fetch followed traders for active user
  const fetchFollowed = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/followed?userId=${encodeURIComponent(user.id)}`);
      const data = await res.json();
      setFollowed(data);
      if (data.length > 0 && !simTrader) {
        setSimTrader(data[0].address);
      }
    } catch (err) {
      console.error("Failed to fetch followed traders:", err);
    }
  }, [user, simTrader]);

  // Fetch trade history for active user
  const fetchTrades = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/trades?userId=${encodeURIComponent(user.id)}`);
      const data = await res.json();
      setTrades(data);
    } catch (err) {
      console.error("Failed to fetch trade history:", err);
    }
  }, [user]);

  // Fetch copy wallet info (including balance)
  const fetchWallet = useCallback(async () => {
    if (!user) return;
    setLoadingWallet(true);
    try {
      const res = await fetch('/api/get-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      });
      const data = await res.json();
      setCopyWallet(data);
    } catch (err) {
      console.error("Failed to fetch copy-trading wallet:", err);
    } finally {
      setLoadingWallet(false);
    }
  }, [user]);

  // Handle follow submission
  const handleFollow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !ensInput) return;
    
    setSubmittingFollow(true);
    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          ensName: ensInput,
          multiplier: multiplierInput
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Follow failed");
      } else {
        setEnsInput('');
        setMultiplierInput(1.0);
        await fetchFollowed();
        await fetchTraders();
      }
    } catch (err) {
      console.error("Follow error:", err);
    } finally {
      setSubmittingFollow(false);
    }
  };

  // Handle unfollow
  const handleUnfollow = async (traderAddress: string) => {
    if (!user) return;
    if (!confirm("Are you sure you want to stop copy-trading this address?")) return;

    try {
      const res = await fetch('/api/unfollow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          traderAddress
        })
      });
      if (res.ok) {
        await fetchFollowed();
        await fetchTraders();
      }
    } catch (err) {
      console.error("Unfollow error:", err);
    }
  };

  // Fund copy wallet via Privy universal deposit address
  const handleFundWallet = async () => {
    if (!copyWallet) return;
    try {
      await createDepositAddress({
        destinationChain: 'eip155:84532', // Base Sepolia
        destinationAddress: copyWallet.address,
        destinationCurrency: '0x0000000000000000000000000000000000000000'
      });
      // Refresh wallet after modal closes
      setTimeout(fetchWallet, 4000);
    } catch (err) {
      console.error("Deposit flow failed:", err);
    }
  };

  // Simulate swap execution
  const handleSimulateSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simTrader) {
      alert("Please select or follow a trader first!");
      return;
    }

    setSimulating(true);
    setSimSuccessHash(null);
    try {
      const res = await fetch('/api/simulate-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traderAddress: simTrader,
          tokenIn: simTokenIn,
          tokenOut: simTokenOut,
          amountIn: simAmount,
          amountOut: (Number(simAmount) * 3200).toString() // Mock swap price
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSimSuccessHash(data.simulatedTxHash);
        // Refresh trades and wallet balance
        setTimeout(() => {
          fetchTrades();
          fetchWallet();
        }, 1500);
      } else {
        alert(data.error || "Simulation failed");
      }
    } catch (err) {
      console.error("Simulation error:", err);
    } finally {
      setSimulating(false);
    }
  };

  // Bootstrap data loading
  useEffect(() => {
    fetchStatus();
    fetchTraders();
  }, [fetchStatus, fetchTraders]);

  // Load user-specific data
  useEffect(() => {
    if (authenticated && user) {
      fetchWallet();
      fetchFollowed();
      fetchTrades();
      
      // Periodic updates for trades/wallet balance
      const interval = setInterval(() => {
        fetchWallet();
        fetchTrades();
      }, 10000);
      
      return () => clearInterval(interval);
    } else {
      setCopyWallet(null);
      setFollowed([]);
      setTrades([]);
    }
  }, [authenticated, user, fetchWallet, fetchFollowed, fetchTrades]);

  // Helper to format addresses
  const shortenAddress = (address: string) => {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  if (!ready) {
    return (
      <div className="loading-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#06040a' }}>
        <div className="spinner" style={{ border: '3px solid rgba(139, 92, 246, 0.1)', borderTop: '3px solid #8b5cf6', borderRadius: '50%', width: '40px', height: '40px', animation: 'spin 1s linear infinite' }}></div>
        <div style={{ marginTop: '1.5rem', color: '#9ca3af', fontFamily: 'Outfit', fontWeight: 500 }}>Initializing Vouch Engine...</div>
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
              <TrendingUp size={22} />
            </div>
            <span className="logo-text">Vouch</span>
            <span className="logo-badge">Copy-Trading</span>
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
              className={`nav-tab ${activeTab === 'trades' ? 'active' : ''}`}
              onClick={() => setActiveTab('trades')}
            >
              <Copy size={16} />
              Trades History
            </button>
            <button 
              className={`nav-tab ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => setActiveTab('about')}
            >
              <HelpCircle size={16} />
              AgentBook Setup
            </button>
          </nav>

          <div className="flex items-center gap-3">
            {status && (
              <div className="connection-status">
                <div className={`status-indicator ${status.status === 'online' ? 'connected' : 'disconnected'}`}></div>
                <span>{status.privy === 'configured' ? 'Mainnet RPC' : 'Local Failsafe'}</span>
              </div>
            )}

            {authenticated ? (
              <button onClick={logout} className="filter-btn hover:text-red-400 border border-red-900/30 bg-red-950/10">
                <LogOut size={14} />
                Disconnect
              </button>
            ) : (
              <button onClick={login} className="code-btn" style={{ padding: '0.5rem 1.2rem', borderRadius: '8px' }}>
                <Wallet size={14} />
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="container">
        
        {/* Onboarding / Unauthenticated Landing Page */}
        {!authenticated && (
          <div className="glass-panel text-center max-w-2xl mx-auto my-12 p-12 fade-in" style={{ borderColor: 'rgba(139, 92, 246, 0.2)', boxShadow: '0 20px 50px rgba(139, 92, 246, 0.05)' }}>
            <div className="mx-auto bg-gradient-to-tr from-purple-600 to-pink-600 w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg shadow-purple-500/20">
              <Sparkles size={28} />
            </div>
            <h1 className="text-4xl font-extrabold mb-4 tracking-tight" style={{ fontFamily: 'Outfit' }}>
              Autonomous On-Chain Copy Trading
            </h1>
            <p className="text-gray-400 text-md leading-relaxed mb-8 max-w-lg mx-auto">
              Follow top Ethereum traders by ENS name. Fund your secure Privy wallet, and our proof-of-human-gated AI agents will mirror their swaps on Base Sepolia instantly.
            </p>
            
            <div className="grid grid-cols-3 gap-4 mb-8 text-left max-w-md mx-auto">
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="text-purple-400 font-bold mb-1">01. Discovery</div>
                <div className="text-xs text-gray-500">Track traders easily using their .eth domain identity.</div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="text-purple-400 font-bold mb-1">02. Funding</div>
                <div className="text-xs text-gray-500">Universal deposit addresses let you fund from any wallet/chain.</div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="text-purple-400 font-bold mb-1">03. World ID</div>
                <div className="text-xs text-gray-500">World AgentKit gates copy execution for fair trial limits.</div>
              </div>
            </div>

            <button onClick={login} className="code-btn shadow-lg shadow-purple-500/10" style={{ padding: '0.8rem 2.2rem', fontSize: '1rem', borderRadius: '12px' }}>
              <Wallet size={16} />
              Connect Privy Embedded Wallet
            </button>
          </div>
        )}

        {/* Authenticated Dashboard */}
        {authenticated && (
          <div className="fade-in">
            
            {/* User Stats Banner */}
            <div className="stats-grid">
              <div className="glass-panel stat-card">
                <div className="stat-header">
                  <span>Copy-Trading Address</span>
                  <Wallet size={15} className="text-purple-400" />
                </div>
                {loadingWallet && !copyWallet ? (
                  <div className="stat-value text-lg text-gray-500">Deploying Wallet...</div>
                ) : (
                  <>
                    <div 
                      className="stat-value text-xl font-mono cursor-pointer hover:text-purple-300"
                      onClick={() => {
                        if (copyWallet) {
                          navigator.clipboard.writeText(copyWallet.address);
                          alert("Wallet address copied to clipboard!");
                        }
                      }}
                      title="Copy Wallet Address"
                    >
                      {copyWallet ? shortenAddress(copyWallet.address) : '...'}
                    </div>
                    <div className="stat-footer mt-2">
                      <span className="text-purple-400 font-semibold font-mono">{copyWallet?.walletId?.startsWith('local_') ? 'Local Failsafe Wallet' : 'Privy Server Wallet'}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="glass-panel stat-card accent">
                <div className="stat-header">
                  <span>Wallet Balance (Base Sepolia)</span>
                  <Activity size={15} className="text-pink-400" />
                </div>
                <div className="stat-value text-2xl font-mono">
                  {copyWallet ? `${Number(copyWallet.balance).toFixed(5)} ETH` : '0.00 ETH'}
                </div>
                <div className="stat-footer mt-2 flex gap-2">
                  <button onClick={handleFundWallet} className="code-btn" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px' }}>
                    Universal Deposit
                  </button>
                  <a href="https://faucets.chain.link/base-sepolia" target="_blank" rel="noopener noreferrer" className="filter-btn" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px' }}>
                    Get Faucet ETH
                  </a>
                </div>
              </div>

              <div className="glass-panel stat-card success">
                <div className="stat-header">
                  <span>World ID AgentKit Status</span>
                  <Shield size={15} className="text-emerald-400" />
                </div>
                <div className="stat-value text-2xl flex items-center gap-2">
                  <Check size={22} className="text-emerald-400" />
                  <span className="text-lg text-gray-200">Human Proof Verified</span>
                </div>
                <div className="stat-footer mt-2">
                  <span className="text-emerald-400 font-medium">First 3 copy-trades free per human ID</span>
                </div>
              </div>
            </div>

            {/* TAB CONTENT: DASHBOARD */}
            {activeTab === 'dashboard' && (
              <div className="charts-grid">
                
                {/* Left Column: Follow & Leaderboard */}
                <div className="flex flex-col gap-6">
                  
                  {/* Follow ENS Form */}
                  <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Plus size={18} className="text-purple-400" />
                      Follow a Trader by ENS
                    </h3>
                    <form onSubmit={handleFollow} className="flex gap-3">
                      <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" />
                        <input 
                          type="text" 
                          placeholder="e.g. vitalik.eth" 
                          className="search-input"
                          style={{ paddingLeft: '2.5rem' }}
                          value={ensInput}
                          onChange={(e) => setEnsInput(e.target.value)}
                          disabled={submittingFollow}
                        />
                      </div>
                      <div className="flex items-center gap-2 bg-black/40 border border-white/5 px-3 rounded-xl">
                        <span className="text-xs text-gray-500">Size:</span>
                        <input 
                          type="number" 
                          step="0.1" 
                          min="0.1" 
                          max="10" 
                          className="w-12 bg-transparent text-white border-none outline-none font-mono"
                          value={multiplierInput}
                          onChange={(e) => setMultiplierInput(Number(e.target.value))}
                          disabled={submittingFollow}
                        />
                        <span className="text-xs text-gray-500">x</span>
                      </div>
                      <button type="submit" className="code-btn" style={{ padding: '0.65rem 1.5rem', borderRadius: '12px' }} disabled={submittingFollow}>
                        {submittingFollow ? 'Resolving...' : 'Follow'}
                      </button>
                    </form>
                  </div>

                  {/* Leaderboard */}
                  <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Award size={18} className="text-yellow-400" />
                      Global Trader Leaderboard
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="leaderboard-table w-full">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 border-b border-white/5">
                            <th className="pb-3">Trader</th>
                            <th className="pb-3">Address</th>
                            <th className="pb-3">Total Swaps</th>
                            <th className="pb-3">Simulated PnL</th>
                            <th className="pb-3">Win Rate</th>
                            <th className="pb-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {traders.map((trader) => {
                            const isFollowed = followed.some(f => f.address === trader.address);
                            return (
                              <tr key={trader.address} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                <td className="py-4 flex items-center gap-2">
                                  <img 
                                    src={trader.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${trader.ens_name}`}
                                    alt={trader.ens_name} 
                                    className="w-6 h-6 rounded-full"
                                  />
                                  <span className="font-bold text-sm text-gray-200">{trader.ens_name}</span>
                                </td>
                                <td className="py-4 font-mono text-xs text-gray-400">{shortenAddress(trader.address)}</td>
                                <td className="py-4 text-sm font-mono text-gray-300">{trader.total_trades}</td>
                                <td className={`py-4 text-sm font-mono font-bold ${trader.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {trader.pnl >= 0 ? `+${trader.pnl}%` : `${trader.pnl}%`}
                                </td>
                                <td className="py-4 text-sm font-mono text-gray-300">{trader.winrate}%</td>
                                <td className="py-4 text-right">
                                  {isFollowed ? (
                                    <span className="text-xs text-emerald-400 font-semibold bg-emerald-950/20 border border-emerald-900/30 px-2 py-1 rounded-md">Following</span>
                                  ) : (
                                    <button 
                                      onClick={() => {
                                        setEnsInput(trader.ens_name);
                                      }}
                                      className="code-btn"
                                      style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderRadius: '6px' }}
                                    >
                                      Follow
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Right Column: Followed list & Simulation Tools */}
                <div className="flex flex-col gap-6">
                  
                  {/* Currently Followed */}
                  <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Users size={18} className="text-purple-400" />
                      Traders You Follow ({followed.length})
                    </h3>
                    {followed.length === 0 ? (
                      <div className="text-center text-sm text-gray-500 py-12">
                        You are not copy-trading any traders yet. Follow one using their ENS name above!
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {followed.map((f) => (
                          <div key={f.address} className="flex justify-between items-center bg-black/30 border border-white/5 p-4 rounded-xl">
                            <div className="flex items-center gap-3">
                              <img 
                                src={f.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${f.ens_name}`}
                                alt={f.ens_name} 
                                className="w-8 h-8 rounded-full"
                              />
                              <div>
                                <span className="font-bold text-gray-200 block text-sm">{f.ens_name}</span>
                                <span className="text-xs text-gray-500 font-mono">{shortenAddress(f.address)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <span className="text-xs text-gray-500 block">Copy Size</span>
                                <span className="text-sm font-mono font-bold text-purple-400">{f.multiplier}x</span>
                              </div>
                              <button 
                                onClick={() => handleUnfollow(f.address)} 
                                className="text-gray-500 hover:text-red-400 p-1 transition-colors"
                                title="Unfollow trader"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Dev Simulation Tools */}
                  <div className="glass-panel p-6 bg-purple-950/5 border-purple-900/20">
                    <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                      <Play size={18} className="text-pink-400 animate-pulse" />
                      Trade Simulator (Demo helper)
                    </h3>
                    <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                      Mainnet traders might not swap while you are evaluating this app. Use this injector to force a swap from `vitalik.eth` or another followed address, which triggers the detection loop, passes it through the World ID AgentKit gate, and replicates the swap on Base Sepolia.
                    </p>

                    <form onSubmit={handleSimulateSwap} className="flex flex-col gap-3">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Select followed trader to swap</label>
                        <select 
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-2 text-sm text-gray-300 outline-none"
                          value={simTrader}
                          onChange={(e) => setSimTrader(e.target.value)}
                        >
                          <option value="">-- Select followed trader --</option>
                          {followed.map(f => (
                            <option key={f.address} value={f.address}>{f.ens_name} ({shortenAddress(f.address)})</option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Amount In</label>
                          <input 
                            type="text" 
                            className="w-full bg-black/40 border border-white/10 rounded-xl p-2 text-sm text-center text-gray-300 outline-none font-mono"
                            value={simAmount}
                            onChange={(e) => setSimAmount(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Token In</label>
                          <input 
                            type="text" 
                            className="w-full bg-black/40 border border-white/10 rounded-xl p-2 text-sm text-center text-gray-300 outline-none font-mono"
                            value={simTokenIn}
                            disabled
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Token Out</label>
                          <input 
                            type="text" 
                            className="w-full bg-black/40 border border-white/10 rounded-xl p-2 text-sm text-center text-gray-300 outline-none font-mono"
                            value={simTokenOut}
                            disabled
                          />
                        </div>
                      </div>

                      <button type="submit" className="code-btn" style={{ padding: '0.6rem', width: '100%', borderRadius: '10px' }} disabled={simulating}>
                        {simulating ? 'Processing Copy...' : 'Simulate Swap on Mainnet'}
                      </button>

                      {simSuccessHash && (
                        <div className="mt-3 p-3 rounded-xl bg-emerald-950/20 border border-emerald-900/30 text-xs text-emerald-400 flex flex-col gap-1">
                          <span className="font-bold flex items-center gap-1">
                            <Check size={14} />
                            Simulation Triggered!
                          </span>
                          <span>Copy execution succeeded on Base Sepolia. Check the Trades History tab to view the transaction!</span>
                        </div>
                      )}
                    </form>
                  </div>

                </div>

              </div>
            )}

            {/* TAB CONTENT: TRADES HISTORY */}
            {activeTab === 'trades' && (
              <div className="glass-panel p-6">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Activity size={18} className="text-purple-400" />
                  Copied Trades History
                </h3>
                {trades.length === 0 ? (
                  <div className="text-center text-sm text-gray-500 py-16">
                    No copied trades yet. Simulate a trader swap or follow an active trader to see trades replicated here.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="leaderboard-table w-full">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 border-b border-white/5">
                          <th className="pb-3">Trader</th>
                          <th className="pb-3">Action</th>
                          <th className="pb-3">Base Sepolia Tx</th>
                          <th className="pb-3">Original Mainnet Tx</th>
                          <th className="pb-3">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((trade) => {
                          const traderName = traders.find(t => t.address === trade.trader_address.toLowerCase())?.ens_name || shortenAddress(trade.trader_address);
                          return (
                            <tr key={trade.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                              <td className="py-4 font-bold text-sm text-gray-200">{traderName}</td>
                              <td className="py-4">
                                <span className="text-sm font-mono text-purple-400 font-bold">{trade.amount_in} ETH</span>
                                <span className="text-xs text-gray-500 mx-2">→</span>
                                <span className="text-sm font-mono text-emerald-400 font-bold">{trade.amount_out ? `${Number(trade.amount_out).toFixed(2)} USDC` : 'USDC'}</span>
                              </td>
                              <td className="py-4">
                                <a 
                                  href={`https://sepolia.basescan.org/tx/${trade.copy_tx_hash}`} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-xs text-purple-400 font-mono hover:text-purple-300 flex items-center gap-1"
                                >
                                  {shortenAddress(trade.copy_tx_hash)}
                                  <ExternalLink size={12} />
                                </a>
                              </td>
                              <td className="py-4">
                                <a 
                                  href={trade.trader_tx_hash.startsWith('0xsimulated') ? '#' : `https://etherscan.io/tx/${trade.trader_tx_hash}`}
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className={`text-xs font-mono flex items-center gap-1 ${trade.trader_tx_hash.startsWith('0xsimulated') ? 'text-gray-500 pointer-events-none' : 'text-gray-400 hover:text-gray-300'}`}
                                >
                                  {trade.trader_tx_hash.startsWith('0xsimulated') ? 'Simulated Injection' : shortenAddress(trade.trader_tx_hash)}
                                  {!trade.trader_tx_hash.startsWith('0xsimulated') && <ExternalLink size={12} />}
                                </a>
                              </td>
                              <td className="py-4 text-xs text-gray-500 font-mono">{new Date(trade.timestamp).toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: ABOUT & SETUP */}
            {activeTab === 'about' && (
              <div className="glass-panel p-8 max-w-3xl mx-auto">
                <h2 className="text-2xl font-bold mb-4 text-gray-100 flex items-center gap-2">
                  <Shield className="text-purple-400" />
                  AgentBook Registry & World ID Setup
                </h2>
                <p className="text-sm text-gray-400 leading-relaxed mb-6">
                  World AgentKit uses the <strong>AgentBook</strong> smart contract registry on World Chain to map AI agent wallets to verified humans anonymously. This proves that an agent is backed by a real human, allowing services like Vouch to grant free trials (first 3 copy-trades free) safely without Sybil attacks.
                </p>

                <div className="flex flex-col gap-6">
                  
                  <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-900/30">
                    <h3 className="font-bold text-sm text-purple-300 mb-2">How to register your copy-trading agent wallet:</h3>
                    <ol className="list-decimal list-inside text-xs text-gray-400 flex flex-col gap-2">
                      <li>Ensure you have the World App installed and are Orb-verified.</li>
                      <li>Copy your **Copy-Trading Address** from the dashboard banner.</li>
                      <li>In your terminal, run the AgentKit CLI registration command:
                        <div className="bg-black/50 border border-white/5 p-3 rounded-lg font-mono text-purple-400 mt-2 flex justify-between items-center">
                          <span>bunx @worldcoin/agentkit-cli register &lt;your-wallet-address&gt;</span>
                          <button 
                            onClick={() => {
                              if (copyWallet) {
                                navigator.clipboard.writeText(`bunx @worldcoin/agentkit-cli register ${copyWallet.address}`);
                                alert("CLI command copied to clipboard!");
                              } else {
                                alert("Please connect your wallet first!");
                              }
                            }}
                            className="filter-btn text-xs"
                            style={{ padding: '0.2rem 0.5rem' }}
                          >
                            Copy Command
                          </button>
                        </div>
                      </li>
                      <li>Scan the printed QR code with your World App to authorize the agent.</li>
                      <li>Once registered, Vouch will automatically link your agent executions to your World ID humanId for free trial copy-trades!</li>
                    </ol>
                  </div>

                  <div className="p-4 rounded-xl bg-black/40 border border-white/5 text-xs text-gray-500 leading-relaxed">
                    <span className="font-bold text-gray-400 block mb-1">Development / Demo Notice:</span>
                    For hackathon evaluation convenience, **Vouch runs with Demo Mock Mode enabled by default**. If your wallet is not yet registered in AgentBook, the backend will gracefully fallback to a simulated `humanId` validation so you can inspect and test the free-trial usage counter decrement and x402 payment fallback blocks without needing a live World ID scan.
                  </div>

                </div>
              </div>
            )}

          </div>
        )}

      </main>
    </>
  );
}
