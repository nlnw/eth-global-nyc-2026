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
      wallet: { address: mockAddress }
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
  Globe,
  Zap,
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

export default function App() {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const { createDepositAddress } = useDepositAddress();

  // World ID state
  const [verifiedHumanId, setVerifiedHumanId] = useState<string | null>(() => localStorage.getItem('worldid_human_id'));
  const [showWorldIdModal, setShowWorldIdModal] = useState(false);
  const [verifyingWorldId, setVerifyingWorldId] = useState(false);

  // WLD purchase state
  const [wldBalance, setWldBalance] = useState<number>(() => {
    const stored = localStorage.getItem('wld_balance');
    return stored ? Number(stored) : 5.0;
  });
  const [purchasedTrades, setPurchasedTrades] = useState<number>(0);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchasingTrades, setPurchasingTrades] = useState(false);
  const [purchaseAmount] = useState(10); // Trades per purchase
  const wldCostPerPurchase = 1.0;

  const handleVerifyWorldId = async () => {
    if (!user) return;
    setVerifyingWorldId(true);
    setTimeout(async () => {
      const simulatedId = `phone_proof_hl_${Math.random().toString(36).substring(2, 8)}`;
      try {
        const res = await fetch('/api/verify-human', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, humanId: simulatedId })
        });
        if (res.ok) {
          localStorage.setItem('worldid_human_id', simulatedId);
          setVerifiedHumanId(simulatedId);
          setShowWorldIdModal(false);
        } else {
          alert("Verification failed on server.");
        }
      } catch (err) {
        console.error("World ID verification error:", err);
      } finally {
        setVerifyingWorldId(false);
      }
    }, 1500);
  };

  const handlePurchaseTrades = async () => {
    if (!user || !verifiedHumanId) {
      alert("Please verify your World ID first to purchase extra trades.");
      return;
    }
    if (wldBalance < wldCostPerPurchase) {
      alert("Insufficient WLD balance.");
      return;
    }
    setPurchasingTrades(true);
    setTimeout(async () => {
      try {
        const res = await fetch('/api/purchase-trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, humanId: verifiedHumanId, amount: purchaseAmount })
        });
        const data = await res.json();
        if (res.ok) {
          const newBalance = Math.max(0, wldBalance - wldCostPerPurchase);
          setWldBalance(newBalance);
          localStorage.setItem('wld_balance', String(newBalance));
          setPurchasedTrades(data.purchased || 0);
          setShowPurchaseModal(false);
        } else {
          alert(data.error || "Purchase failed.");
        }
      } catch (err) {
        console.error("Purchase error:", err);
        alert("Purchase failed.");
      } finally {
        setPurchasingTrades(false);
      }
    }, 1800);
  };

  const [copyWallet, setCopyWallet] = useState<CopyWallet | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [traders, setTraders] = useState<Trader[]>([]);
  const [followed, setFollowed] = useState<FollowedTrader[]>([]);
  const [trades, setTrades] = useState<CopiedTrade[]>([]);

  const [ensInput, setEnsInput] = useState('');
  const [multiplierInput, setMultiplierInput] = useState(1.0);
  const [submittingFollow, setSubmittingFollow] = useState(false);

  const [simTrader, setSimTrader] = useState('');
  const [simAmount, setSimAmount] = useState('0.01');
  const simTokenIn = 'ETH';
  const simTokenOut = 'USDC';
  const [simulating, setSimulating] = useState(false);
  const [simSuccessHash, setSimSuccessHash] = useState<string | null>(null);

  const fetchTraders = useCallback(async () => {
    try {
      const res = await fetch('/api/traders');
      const data = await res.json();
      setTraders(data);
    } catch (err) {
      console.error("Failed to fetch traders:", err);
    }
  }, []);

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

  const handleFollow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !ensInput) return;
    setSubmittingFollow(true);
    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, ensName: ensInput, multiplier: multiplierInput })
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

  const handleUnfollow = async (traderAddress: string) => {
    if (!user) return;
    if (!confirm("Are you sure you want to stop copy-trading this address?")) return;
    try {
      const res = await fetch('/api/unfollow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, traderAddress })
      });
      if (res.ok) {
        await fetchFollowed();
        await fetchTraders();
      }
    } catch (err) {
      console.error("Unfollow error:", err);
    }
  };

  const handleFundWallet = async () => {
    if (!copyWallet) return;
    try {
      await createDepositAddress({
        destinationChain: 'eip155:84532',
        destinationAddress: copyWallet.address,
        destinationCurrency: '0x0000000000000000000000000000000000000000'
      });
      setTimeout(fetchWallet, 4000);
    } catch (err) {
      console.error("Deposit flow failed:", err);
    }
  };

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
          amountOut: (Number(simAmount) * 3200).toString()
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSimSuccessHash(data.simulatedTxHash);
        setTimeout(() => { fetchTrades(); fetchWallet(); }, 1500);
      } else {
        alert(data.error || "Simulation failed");
      }
    } catch (err) {
      console.error("Simulation error:", err);
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    fetchTraders();
  }, [fetchTraders]);

  useEffect(() => {
    if (authenticated && user) {
      fetchWallet();
      fetchFollowed();
      fetchTrades();
      const interval = setInterval(() => { fetchWallet(); fetchTrades(); }, 10000);
      return () => clearInterval(interval);
    } else {
      setCopyWallet(null);
      setFollowed([]);
      setTrades([]);
    }
  }, [authenticated, user, fetchWallet, fetchFollowed, fetchTrades]);

  const shortenAddress = (address: string) => {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const totalCopyLimit = 3 + purchasedTrades;

  if (!ready) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#06040a' }}>
        <div className="spinner"></div>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {authenticated ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', padding: '0.4rem 0.9rem', borderRadius: '8px', background: 'rgba(6, 4, 10, 0.4)', border: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af' }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }}></div>
                  {user?.wallet?.address ? shortenAddress(user.wallet.address) : 'Connected'}
                </div>
                <button onClick={logout} className="btn-ghost" style={{ color: '#f87171', borderColor: 'rgba(127,29,29,0.3)' }}>
                  <LogOut size={14} />
                  Disconnect
                </button>
              </>
            ) : (
              <button onClick={login} className="btn-primary">
                <Wallet size={14} />
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container">

        {/* Landing / Unauthenticated */}
        {!authenticated && (
          <div className="landing-hero fade-in">
            <div className="hero-glow"></div>
            <div className="hero-icon">
              <Sparkles size={32} />
            </div>
            <h1 className="hero-title">Autonomous On-Chain<br />Copy Trading</h1>
            <p className="hero-subtitle">
              Follow top Ethereum traders by ENS name. Fund your Privy wallet, and our World ID–gated agents mirror their swaps on Base Sepolia.
            </p>

            <div className="feature-grid">
              <div className="feature-card">
                <Search size={20} style={{ color: '#c084fc' }} />
                <div className="feature-card-title">Discover</div>
                <div className="feature-card-desc">Track elite traders by their <code>.eth</code> identity.</div>
              </div>
              <div className="feature-card">
                <Wallet size={20} style={{ color: '#ec4899' }} />
                <div className="feature-card-title">Fund</div>
                <div className="feature-card-desc">Universal deposit addresses accept any chain or token.</div>
              </div>
              <div className="feature-card">
                <Globe size={20} style={{ color: '#38bdf8' }} />
                <div className="feature-card-title">World ID</div>
                <div className="feature-card-desc">Proof-of-human gates prevent Sybil bot farming.</div>
              </div>
            </div>

            <button onClick={login} className="btn-primary btn-lg">
              <Wallet size={18} />
              Connect with Privy
            </button>
          </div>
        )}

        {/* Authenticated Dashboard */}
        {authenticated && (
          <div className="dashboard fade-in">
            
            {/* Left Column */}
            <div className="dashboard-left">

              {/* Follow ENS */}
              <div className="glass-panel section-card">
                <h2 className="section-title">
                  <Plus size={17} style={{ color: '#c084fc' }} />
                  Follow a Trader
                </h2>
                <form onSubmit={handleFollow} className="follow-form">
                  <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }} />
                    <input
                      type="text"
                      placeholder="vitalik.eth"
                      className="search-input"
                      style={{ paddingLeft: '2.4rem' }}
                      value={ensInput}
                      onChange={(e) => setEnsInput(e.target.value)}
                      disabled={submittingFollow}
                    />
                  </div>
                  <div className="multiplier-control">
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Size</span>
                    <input
                      type="number" step="0.1" min="0.1" max="10"
                      className="multiplier-input"
                      value={multiplierInput}
                      onChange={(e) => setMultiplierInput(Number(e.target.value))}
                      disabled={submittingFollow}
                    />
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>×</span>
                  </div>
                  <button type="submit" className="btn-primary" disabled={submittingFollow}>
                    {submittingFollow ? 'Resolving...' : 'Follow'}
                  </button>
                </form>
              </div>

              {/* Followed Traders */}
              <div className="glass-panel section-card">
                <h2 className="section-title">
                  <Users size={17} style={{ color: '#c084fc' }} />
                  Your Followed Traders
                  <span className="count-badge">{followed.length}</span>
                </h2>
                {followed.length === 0 ? (
                  <div className="empty-state">No traders followed yet. Search above to start copy-trading.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {followed.map((f) => (
                      <div key={f.address} className="trader-row">
                        <img
                          src={f.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${f.ens_name}`}
                          alt={f.ens_name}
                          style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.ens_name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280', fontFamily: 'var(--font-mono)' }}>{shortenAddress(f.address)}</div>
                        </div>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#c084fc', fontFamily: 'var(--font-mono)' }}>{f.multiplier}×</span>
                        <button onClick={() => handleUnfollow(f.address)} className="btn-danger-icon" title="Unfollow">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Leaderboard */}
              <div className="glass-panel section-card">
                <h2 className="section-title">
                  <Award size={17} style={{ color: '#facc15' }} />
                  Global Leaderboard
                </h2>
                {traders.length === 0 ? (
                  <div className="empty-state">No traders in leaderboard yet.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="leaderboard-table" style={{ width: '100%' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', fontSize: '0.75rem', color: '#6b7280', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <th style={{ paddingBottom: '0.75rem' }}>Trader</th>
                          <th style={{ paddingBottom: '0.75rem' }}>Swaps</th>
                          <th style={{ paddingBottom: '0.75rem' }}>PnL</th>
                          <th style={{ paddingBottom: '0.75rem', textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {traders.map((trader) => {
                          const isFollowed = followed.some(f => f.address === trader.address);
                          return (
                            <tr key={trader.address} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                              <td style={{ paddingTop: '0.85rem', paddingBottom: '0.85rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <img
                                    src={trader.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${trader.ens_name}`}
                                    alt={trader.ens_name}
                                    style={{ width: '22px', height: '22px', borderRadius: '50%' }}
                                  />
                                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#e5e7eb' }}>{trader.ens_name}</span>
                                </div>
                              </td>
                              <td style={{ fontSize: '0.85rem', color: '#9ca3af', fontFamily: 'var(--font-mono)' }}>{trader.total_trades}</td>
                              <td style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: trader.pnl >= 0 ? '#34d399' : '#f87171' }}>
                                {trader.pnl >= 0 ? '+' : ''}{trader.pnl}%
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {isFollowed ? (
                                  <span className="badge-following">Following</span>
                                ) : (
                                  <button onClick={() => setEnsInput(trader.ens_name)} className="btn-sm">Follow</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column */}
            <div className="dashboard-right">

              {/* Wallet Card */}
              <div className="glass-panel section-card">
                <h2 className="section-title">
                  <Wallet size={17} style={{ color: '#ec4899' }} />
                  Copy-Trading Wallet
                </h2>
                <div className="wallet-row">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Address (Base Sepolia)</div>
                    <div
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: '#e5e7eb', cursor: 'pointer' }}
                      onClick={() => { if (copyWallet) { navigator.clipboard.writeText(copyWallet.address); } }}
                      title="Click to copy"
                    >
                      {loadingWallet && !copyWallet ? <span style={{ color: '#6b7280' }}>Deploying wallet...</span> : (copyWallet ? shortenAddress(copyWallet.address) : '—')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#c084fc', marginTop: '0.25rem' }}>
                      {copyWallet?.walletId?.startsWith('local_') ? 'Local Failsafe Wallet' : 'Privy Server Wallet'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Balance</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.1rem', color: '#f3f4f6' }}>
                      {copyWallet ? `${Number(copyWallet.balance).toFixed(5)} ETH` : '—'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
                  <button onClick={handleFundWallet} className="btn-primary" style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem' }}>
                    Universal Deposit
                  </button>
                  <a href="https://faucets.chain.link/base-sepolia" target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem', textDecoration: 'none' }}>
                    Get Faucet ETH
                  </a>
                </div>
              </div>

              {/* World ID + WLD Hub */}
              <div className="glass-panel section-card worldid-card">
                <h2 className="section-title" style={{ marginBottom: '1.25rem' }}>
                  <Globe size={17} style={{ color: '#38bdf8' }} />
                  World ID & WLD Hub
                </h2>

                {/* Verification Status */}
                <div className="worldid-status-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: verifiedHumanId ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.12)', border: `1px solid ${verifiedHumanId ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
                      {verifiedHumanId ? <Check size={18} style={{ color: '#34d399' }} /> : <Shield size={18} style={{ color: '#fbbf24' }} />}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: verifiedHumanId ? '#34d399' : '#fbbf24' }}>
                        {verifiedHumanId ? 'Verified Human' : 'Not Verified'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'var(--font-mono)' }}>
                        {verifiedHumanId ? `ID: ${verifiedHumanId.substring(0, 20)}...` : '3 free copy-trades on verification'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowWorldIdModal(true)}
                    className="btn-sm"
                    style={{ background: verifiedHumanId ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', borderColor: verifiedHumanId ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)', color: verifiedHumanId ? '#34d399' : '#fbbf24' }}
                  >
                    {verifiedHumanId ? 'Refill' : 'Verify'}
                  </button>
                </div>

                <div className="worldid-divider"></div>

                {/* WLD Balance & Purchase */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #1d4ed8, #0ea5e9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 800, color: 'white' }}>W</div>
                    <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>WLD Balance</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: '#f3f4f6' }}>{wldBalance.toFixed(2)} WLD</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                    Copy-trade capacity
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#c084fc', marginLeft: '0.5rem', fontWeight: 700 }}>
                      {totalCopyLimit} total
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#6b7280', marginLeft: '0.3rem' }}>
                      (3 free + {purchasedTrades} purchased)
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setShowPurchaseModal(true)}
                  className="btn-worldcoin"
                  disabled={!verifiedHumanId || wldBalance < wldCostPerPurchase}
                  title={!verifiedHumanId ? 'Verify World ID first' : ''}
                >
                  <Zap size={15} />
                  Buy {purchaseAmount} Trades — {wldCostPerPurchase} WLD
                </button>
                {!verifiedHumanId && (
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', textAlign: 'center', marginTop: '0.5rem' }}>
                    Verify your World ID above to unlock purchases
                  </div>
                )}
              </div>

              {/* Simulation Tools */}
              <div className="glass-panel section-card" style={{ borderColor: 'rgba(126,34,206,0.15)' }}>
                <h2 className="section-title">
                  <Play size={17} style={{ color: '#ec4899' }} />
                  Trade Simulator
                  <span style={{ fontSize: '0.7rem', color: '#6b7280', marginLeft: '0.5rem', fontWeight: 400 }}>demo helper</span>
                </h2>
                <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Force a swap from any followed trader to trigger the detection loop and copy execution on Base Sepolia.
                </p>
                <form onSubmit={handleSimulateSwap} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <select
                    className="search-input"
                    value={simTrader}
                    onChange={(e) => setSimTrader(e.target.value)}
                  >
                    <option value="">— Select a followed trader —</option>
                    {followed.map(f => (
                      <option key={f.address} value={f.address}>{f.ens_name} ({shortenAddress(f.address)})</option>
                    ))}
                  </select>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <label style={{ fontSize: '0.72rem', color: '#6b7280', display: 'block', marginBottom: '0.3rem' }}>Amount In</label>
                      <input type="text" className="search-input" style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }} value={simAmount} onChange={(e) => setSimAmount(e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', color: '#6b7280', display: 'block', marginBottom: '0.3rem' }}>Token In</label>
                      <input type="text" className="search-input" style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }} value={simTokenIn} disabled />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', color: '#6b7280', display: 'block', marginBottom: '0.3rem' }}>Token Out</label>
                      <input type="text" className="search-input" style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }} value={simTokenOut} disabled />
                    </div>
                  </div>

                  <button type="submit" className="btn-primary" style={{ justifyContent: 'center' }} disabled={simulating}>
                    {simulating ? 'Processing...' : 'Simulate Swap & Copy'}
                  </button>

                  {simSuccessHash && (
                    <div className="success-banner">
                      <Check size={14} />
                      <div>
                        <div style={{ fontWeight: 700 }}>Copy triggered!</div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>Check the trades list below for the Base Sepolia tx.</div>
                      </div>
                    </div>
                  )}
                </form>
              </div>

              {/* Copied Trades History */}
              <div className="glass-panel section-card">
                <h2 className="section-title">
                  <Activity size={17} style={{ color: '#c084fc' }} />
                  Copied Trades
                  <span className="count-badge">{trades.length}</span>
                </h2>
                {trades.length === 0 ? (
                  <div className="empty-state">No trades yet. Simulate a swap above or wait for a followed trader to execute on Hyperliquid.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="leaderboard-table" style={{ width: '100%' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', fontSize: '0.72rem', color: '#6b7280', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <th style={{ paddingBottom: '0.6rem' }}>Trader</th>
                          <th style={{ paddingBottom: '0.6rem' }}>Trade</th>
                          <th style={{ paddingBottom: '0.6rem' }}>Base Sepolia Tx</th>
                          <th style={{ paddingBottom: '0.6rem' }}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.slice(0, 10).map((trade) => {
                          const traderName = traders.find(t => t.address === trade.trader_address.toLowerCase())?.ens_name || shortenAddress(trade.trader_address);
                          return (
                            <tr key={trade.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                              <td style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', fontWeight: 600, fontSize: '0.82rem', color: '#e5e7eb' }}>{traderName}</td>
                              <td style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>
                                <span style={{ color: '#c084fc' }}>{trade.amount_in} ETH</span>
                                <span style={{ color: '#6b7280', margin: '0 0.3rem' }}>→</span>
                                <span style={{ color: '#34d399' }}>USDC</span>
                              </td>
                              <td>
                                <a
                                  href={`https://sepolia.basescan.org/tx/${trade.copy_tx_hash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ fontSize: '0.78rem', color: '#c084fc', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '0.25rem', textDecoration: 'none' }}
                                >
                                  {shortenAddress(trade.copy_tx_hash)}
                                  <ExternalLink size={11} />
                                </a>
                              </td>
                              <td style={{ fontSize: '0.75rem', color: '#6b7280', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                                {new Date(trade.timestamp).toLocaleTimeString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {trades.length > 10 && (
                      <div style={{ textAlign: 'center', fontSize: '0.78rem', color: '#6b7280', padding: '0.75rem 0 0' }}>
                        Showing latest 10 of {trades.length} trades
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* Copy credit info when logged in */}
        {authenticated && (
          <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#4b5563', marginTop: '2rem', marginBottom: '1rem' }}>
            Vouch uses <strong style={{ color: '#6b7280' }}>World AgentBook</strong> to link agents to verified humans · Swaps executed on <strong style={{ color: '#6b7280' }}>Base Sepolia</strong> · Trades detected via <strong style={{ color: '#6b7280' }}>Hyperliquid API</strong>
          </div>
        )}

      </main>

      {/* World ID Modal */}
      {showWorldIdModal && (
        <div className="modal-overlay" onClick={() => !verifyingWorldId && setShowWorldIdModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon-wrap" style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.25)' }}>
              <Shield size={32} style={{ color: '#38bdf8' }} />
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.4rem' }}>World ID Verification</h2>
            <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginBottom: '1.5rem', lineHeight: 1.6, textAlign: 'center', maxWidth: '280px' }}>
              Prove your humanity with World ID. This resets your free trial copy-trades and confirms you're a real person, not a Sybil bot.
            </p>

            {/* Mock QR Code */}
            <div className="qr-scanner-box">
              {verifyingWorldId ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="spinner" style={{ borderTopColor: '#38bdf8' }}></div>
                  <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Verifying with World App...</span>
                </div>
              ) : (
                <>
                  <div className="mock-qr">
                    {Array.from({ length: 25 }).map((_, i) => (
                      <div key={i} style={{ background: (i % 3 === 0 || i % 4 === 1 || i < 5 || i > 20 || i % 5 === 0 || i % 5 === 4) ? '#06040a' : 'transparent', borderRadius: '2px', width: '100%', height: '100%' }}></div>
                    ))}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'var(--font-mono)' }}>Scan with World App</span>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.25rem' }}>
              <button onClick={() => setShowWorldIdModal(false)} className="btn-ghost" disabled={verifyingWorldId} style={{ flex: 1, justifyContent: 'center' }}>
                Cancel
              </button>
              <button onClick={handleVerifyWorldId} className="btn-worldcoin" disabled={verifyingWorldId} style={{ flex: 1, justifyContent: 'center' }}>
                {verifyingWorldId ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WLD Purchase Modal */}
      {showPurchaseModal && (
        <div className="modal-overlay" onClick={() => !purchasingTrades && setShowPurchaseModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon-wrap" style={{ background: 'rgba(29,78,216,0.15)', border: '1px solid rgba(14,165,233,0.3)' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #1d4ed8, #0ea5e9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 800, color: 'white' }}>W</div>
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.4rem' }}>Purchase Copy-Trades</h2>
            <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginBottom: '1.25rem', lineHeight: 1.6, textAlign: 'center', maxWidth: '280px' }}>
              Spend <strong style={{ color: '#f3f4f6' }}>1.0 WLD</strong> to unlock <strong style={{ color: '#f3f4f6' }}>10 additional copy-trades</strong> beyond your free trial.
            </p>

            <div className="purchase-summary">
              <div className="purchase-row">
                <span>Copy-trades purchased</span>
                <span style={{ fontWeight: 700, color: '#c084fc' }}>+{purchaseAmount}</span>
              </div>
              <div className="purchase-row">
                <span>Cost</span>
                <span style={{ fontWeight: 700, color: '#f3f4f6' }}>{wldCostPerPurchase} WLD</span>
              </div>
              <div className="purchase-row" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.6rem', marginTop: '0.25rem' }}>
                <span>Remaining balance</span>
                <span style={{ fontWeight: 700, color: wldBalance - wldCostPerPurchase < 0 ? '#f87171' : '#34d399' }}>
                  {(wldBalance - wldCostPerPurchase).toFixed(2)} WLD
                </span>
              </div>
            </div>

            {/* Purchase QR */}
            <div className="qr-scanner-box" style={{ borderColor: 'rgba(14,165,233,0.3)' }}>
              {purchasingTrades ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="spinner" style={{ borderTopColor: '#0ea5e9' }}></div>
                  <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Confirming in World App...</span>
                </div>
              ) : (
                <>
                  <div className="mock-qr" style={{ borderColor: '#1d4ed8' }}>
                    {Array.from({ length: 25 }).map((_, i) => (
                      <div key={i} style={{ background: (i % 2 === 0 || i % 5 === 1 || i < 5 || i > 18) ? '#06040a' : 'transparent', borderRadius: '2px', width: '100%', height: '100%' }}></div>
                    ))}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'var(--font-mono)' }}>Confirm payment in World App</span>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.25rem' }}>
              <button onClick={() => setShowPurchaseModal(false)} className="btn-ghost" disabled={purchasingTrades} style={{ flex: 1, justifyContent: 'center' }}>
                Cancel
              </button>
              <button onClick={handlePurchaseTrades} disabled={purchasingTrades || wldBalance < wldCostPerPurchase} style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.2rem', borderRadius: '10px', background: 'linear-gradient(135deg, #1d4ed8, #0ea5e9)', color: 'white', border: 'none', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}>
                {purchasingTrades ? 'Confirming...' : 'Confirm — 1.0 WLD'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
