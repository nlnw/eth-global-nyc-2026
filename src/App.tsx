import { useState, useEffect, useCallback } from 'react';
import { usePrivy, useDepositAddress, useWallets } from '@privy-io/react-auth';
import { IDKitRequestWidget, deviceLegacy } from '@worldcoin/idkit';
import type { IDKitResult } from '@worldcoin/idkit';


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
  ensName: string;
  avatar: string | null;
  totalTrades: number;
  pnl: number;
  winrate: number;
}

interface FollowedTrader extends Trader {
  multiplier: number;
  active: number;
}

interface CopiedTrade {
  id: string;
  userId: string;
  traderAddress: string;
  traderTxHash: string;
  copyTxHash: string | null;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string | null;
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
  const { wallets } = useWallets();
  const userId = user?.id;

  // World ID state
  const [verifiedHumanId, setVerifiedHumanId] = useState<string | null>(() => localStorage.getItem('worldid_human_id'));

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

  const [activeRpContext, setActiveRpContext] = useState<any | null>(null);
  const [fetchingRpContext, setFetchingRpContext] = useState(false);
  const [isVerifierOpen, setIsVerifierOpen] = useState(false);

  const handleVerifyRealWorldId = async (proofResult: IDKitResult) => {
    if (!userId) return;
    console.log("[World ID] Proof received from IDKit widget:", proofResult);

    const res = await fetch('/api/verify-human-real', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        ...proofResult
      })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Verification failed on backend" }));
      throw new Error(data.error || "Verification failed");
    }
  };

  const handleVerifySuccess = (result: IDKitResult) => {
    console.log("[World ID] Verification success:", result);
    const nullifierHash = (result.responses?.[0] as any)?.nullifier;
    if (nullifierHash) {
      localStorage.setItem('worldid_human_id', nullifierHash);
      setVerifiedHumanId(nullifierHash);
      fetchWallet();
    }
  };

  const triggerVerification = async () => {
    if (!userId) {
      alert("Please login first!");
      return;
    }
    setFetchingRpContext(true);
    try {
      const res = await fetch('/api/rp-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: import.meta.env.VITE_WORLD_ACTION || 'verify' })
      });
      const data = await res.json();
      if (res.ok && data.rp_context) {
        setActiveRpContext(data.rp_context);
        setIsVerifierOpen(true);
      } else {
        alert(data.error || "Failed to initiate World ID verification context.");
      }
    } catch (err) {
      console.error("Error fetching RP context:", err);
      alert("Failed to initiate World ID verification.");
    } finally {
      setFetchingRpContext(false);
    }
  };

  const handlePurchaseTrades = async () => {
    if (!userId || !verifiedHumanId) {
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
          body: JSON.stringify({ userId, humanId: verifiedHumanId, amount: purchaseAmount })
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
  const [sendingEth, setSendingEth] = useState(false);

  const handleSendTestnetEth = async () => {
    if (!copyWallet) return;
    const activeWallet = wallets?.[0];
    if (!activeWallet) {
      alert("No active wallet found. Please connect your wallet first.");
      return;
    }
    setSendingEth(true);
    try {
      try {
        if (activeWallet.switchChain) {
          await activeWallet.switchChain(84532);
        }
      } catch (switchErr) {
        console.warn("Could not switch chain automatically:", switchErr);
      }

      const provider = await activeWallet.getEthereumProvider();
      const txParams = {
        from: activeWallet.address,
        to: copyWallet.address,
        value: '0x71afd498d0000', // 0.002 ETH in hex
        chainId: 84532,
      };

      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      });

      console.log("Transaction result:", txHash);
      alert("0.002 Sepolia Base ETH sent successfully! Checking for updated balance in a few seconds...");
      setTimeout(fetchWallet, 5000);
    } catch (err: any) {
      console.error("Failed to send transaction:", err);
      alert(err.message || "Failed to send transaction");
    } finally {
      setSendingEth(false);
    }
  };
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [traders, setTraders] = useState<Trader[]>([]);
  const [followed, setFollowed] = useState<FollowedTrader[]>([]);
  const [trades, setTrades] = useState<CopiedTrade[]>([]);

  const [expandedTrader, setExpandedTrader] = useState<string | null>(null);
  const [traderTrades, setTraderTrades] = useState<any[]>([]);
  const [loadingTraderTrades, setLoadingTraderTrades] = useState<string | null>(null);

  const toggleTraderTrades = async (address: string) => {
    if (expandedTrader === address) {
      setExpandedTrader(null);
      setTraderTrades([]);
      return;
    }
    setExpandedTrader(address);
    setLoadingTraderTrades(address);
    setTraderTrades([]);
    try {
      const res = await fetch(`/api/trader-trades?address=${encodeURIComponent(address)}`);
      const data = await res.json();
      setTraderTrades(data);
    } catch (err) {
      console.error("Failed to fetch trader trades:", err);
    } finally {
      setLoadingTraderTrades(null);
    }
  };

  const [ensInput, setEnsInput] = useState('');
  const [multiplierInput, setMultiplierInput] = useState(1.0);
  const [submittingFollow, setSubmittingFollow] = useState(false);

  const [simTrader, setSimTrader] = useState('');
  const [simAmount, setSimAmount] = useState('0.01');
  const simTokenIn = 'ETH';
  const simTokenOut = 'USDC';
  const [simulating, setSimulating] = useState(false);
  const [simSuccessHash, setSimSuccessHash] = useState<string | null>(null);
  const [simResults, setSimResults] = useState<any[] | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

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
    if (!userId) return;
    try {
      const res = await fetch(`/api/followed?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      setFollowed(data);
      if (data.length > 0 && !simTrader) {
        setSimTrader(data[0].address);
      }
    } catch (err) {
      console.error("Failed to fetch followed traders:", err);
    }
  }, [userId, simTrader]);

  const fetchTrades = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/trades?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      setTrades(data);
    } catch (err) {
      console.error("Failed to fetch trade history:", err);
    }
  }, [userId]);

  const fetchWallet = useCallback(async () => {
    if (!userId) return;
    setLoadingWallet(true);
    try {
      const res = await fetch('/api/get-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      setCopyWallet(data);
    } catch (err) {
      console.error("Failed to fetch copy-trading wallet:", err);
    } finally {
      setLoadingWallet(false);
    }
  }, [userId]);

  const followTraderDirect = async (ensName: string, multiplier = 1.0) => {
    if (!userId || !ensName) return;
    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ensName, multiplier })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Follow failed");
      } else {
        await fetchFollowed();
        await fetchTraders();
      }
    } catch (err) {
      console.error("Direct follow error:", err);
    }
  };

  const handleFollow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !ensInput) return;
    setSubmittingFollow(true);
    try {
      await followTraderDirect(ensInput, multiplierInput);
      setEnsInput('');
      setMultiplierInput(1.0);
    } finally {
      setSubmittingFollow(false);
    }
  };

  const handleUnfollow = async (traderAddress: string) => {
    if (!userId) return;
    if (!confirm("Are you sure you want to stop copy-trading this address?")) return;
    try {
      const res = await fetch('/api/unfollow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, traderAddress })
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
    setSimResults(null);
    setSimError(null);
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
        setSimResults(data.results || []);
        setTimeout(() => { fetchTrades(); fetchWallet(); }, 1500);
      } else {
        setSimError(data.error || "Simulation failed");
      }
    } catch (err: any) {
      console.error("Simulation error:", err);
      setSimError(err.message || "Simulation error");
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    fetchTraders();
  }, [fetchTraders]);

  useEffect(() => {
    if (authenticated && userId) {
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
  }, [authenticated, userId, fetchWallet, fetchFollowed, fetchTrades]);

  const shortenAddress = (address: string) => {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const totalCopyLimit = 3 + purchasedTrades;

  if (!ready) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base)' }}>
        <div className="spinner"></div>
        <div style={{ marginTop: '1.5rem', color: 'var(--text-muted)', fontFamily: 'Outfit', fontWeight: 500 }}>Initializing Vouch Engine...</div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', padding: '0.4rem 0.9rem', borderRadius: '8px', background: '#f4f4f5', border: '1px solid var(--panel-border)', color: 'var(--text-main)' }}>
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
                <Search size={20} style={{ color: 'var(--accent)' }} />
                <div className="feature-card-title">Discover</div>
                <div className="feature-card-desc">Track elite traders by their <code>.eth</code> identity.</div>
              </div>
              <div className="feature-card">
                <Wallet size={20} style={{ color: 'var(--success)' }} />
                <div className="feature-card-title">Fund</div>
                <div className="feature-card-desc">Universal deposit addresses accept any chain or token.</div>
              </div>
              <div className="feature-card">
                <Globe size={20} style={{ color: 'var(--primary)' }} />
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
                  <Plus size={17} style={{ color: 'var(--accent)' }} />
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

                <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Suggested ENS Handles</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {[
                      { name: 'vitalik.eth', desc: 'Founder of Ethereum' },
                      { name: 'hot.cooperm.eth', desc: 'drkmttr Vault' },
                      { name: 'bmac.eth', desc: 'Citadel Vault' },
                      { name: 'theneetguy.eth', desc: 'NEET WORLD ORDER Vault' },
                      { name: 'guapalterman.eth', desc: 'OIB Vault' },
                      { name: 'junkai.eth', desc: 'one life Vault' }
                    ].map(sug => (
                      <button
                        key={sug.name}
                        type="button"
                        onClick={() => setEnsInput(sug.name)}
                        className="btn-ghost"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', borderRadius: '6px', border: '1px solid var(--panel-border)', background: 'transparent', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', cursor: 'pointer' }}
                        title={sug.desc}
                      >
                        {sug.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Followed Traders */}
              <div className="glass-panel section-card">
                <h2 className="section-title">
                  <Users size={17} style={{ color: 'var(--accent)' }} />
                  Your Followed Traders
                  <span className="count-badge">{followed.length}</span>
                </h2>
                {followed.length === 0 ? (
                  <div className="empty-state">No traders followed yet. Search above to start copy-trading.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {followed.map((f) => (
                      <div key={f.address} style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <div className="trader-row" style={{ border: 'none', padding: 0 }}>
                          <img
                            src={f.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${f.ensName}`}
                            alt={f.ensName}
                            style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid var(--panel-border)', cursor: 'pointer' }}
                            onClick={() => toggleTraderTrades(f.address)}
                            title="Click to view recent trades"
                          />
                          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggleTraderTrades(f.address)} title="Click to view recent trades">
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.ensName}</div>
                            <div style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ color: '#6b7280', fontFamily: 'var(--font-mono)' }}>{shortenAddress(f.address)}</span>
                              <a
                                href={`https://hyperdash.com/address/${f.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
                                title="View on Hyperdash"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink size={12} />
                              </a>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', background: '#f4f4f5', border: '1px solid var(--panel-border)', borderRadius: '6px', padding: '0.1rem 0.35rem' }}>
                            <input
                              type="number"
                              step="0.1"
                              min="0.1"
                              max="10"
                              style={{ width: '40px', border: 'none', background: 'transparent', textAlign: 'center', fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-main)', padding: 0 }}
                              value={f.multiplier}
                              onChange={async (e) => {
                                const val = Number(e.target.value);
                                if (val >= 0.1 && val <= 10) {
                                  // Update local state for immediate response
                                  setFollowed(prev => prev.map(item => item.address === f.address ? { ...item, multiplier: val } : item));
                                  // Call API to persist new multiplier
                                  await followTraderDirect(f.ensName, val);
                                }
                              }}
                            />
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>×</span>
                          </div>
                          <button onClick={() => toggleTraderTrades(f.address)} className="btn-ghost" style={{ padding: '0.25rem 0.4rem', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.1rem', height: 'auto', border: '1px solid var(--panel-border)', cursor: 'pointer' }} title="Toggle recent trades">
                            {expandedTrader === f.address ? 'Hide Fills' : 'Show Fills'}
                          </button>
                          <button onClick={() => handleUnfollow(f.address)} className="btn-danger-icon" title="Unfollow" style={{ marginLeft: '0.25rem' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* Collapsible Recent Trades activity */}
                        {expandedTrader === f.address && (
                          <div style={{ marginLeft: '40px', padding: '0.5rem 0.75rem', background: '#fafafa', border: '1px solid var(--panel-border)', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem', letterSpacing: '0.02em' }}>Hyperliquid Activity</div>
                            {loadingTraderTrades === f.address ? (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <div className="spinner" style={{ width: '10px', height: '10px', borderWidth: '1.5px', borderTopColor: 'var(--accent)' }}></div>
                                Loading live fills...
                              </div>
                            ) : traderTrades.length === 0 ? (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No recent fills found on Hyperliquid.</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {traderTrades.map((t: any, idx: number) => (
                                  <div key={idx} style={{ fontSize: '0.72rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-main)', alignItems: 'center' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '0.1rem 0.3rem', borderRadius: '4px', background: t.side === 'BUY' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: t.side === 'BUY' ? 'var(--success)' : 'var(--danger)' }}>
                                        {t.side}
                                      </span>
                                      <strong>{t.sz}</strong> {t.coin}
                                    </span>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#6b7280' }}>
                                      ${Number(t.px) < 1 ? Number(t.px).toFixed(4) : Number(t.px).toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Leaderboard */}
              <div className="glass-panel section-card">
                <h2 className="section-title">
                  <Award size={17} style={{ color: 'var(--warning)' }} />
                  Global Leaderboard
                </h2>
                {traders.length === 0 ? (
                  <div className="empty-state">No traders in leaderboard yet.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="leaderboard-table" style={{ width: '100%' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', fontSize: '0.75rem', color: '#6b7280', borderBottom: '1px solid var(--panel-border)' }}>
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
                            <tr key={trader.address} style={{ borderBottom: '1px solid #f4f4f5' }}>
                              <td style={{ paddingTop: '0.85rem', paddingBottom: '0.85rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <img
                                    src={trader.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${trader.ensName}`}
                                    alt={trader.ensName}
                                    style={{ width: '22px', height: '22px', borderRadius: '50%' }}
                                  />
                                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>{trader.ensName}</span>
                                  <a
                                    href={`https://hyperdash.com/address/${trader.address}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', marginLeft: '0.25rem' }}
                                    title="View on Hyperdash"
                                  >
                                    <ExternalLink size={12} />
                                  </a>
                                </div>
                              </td>
                              <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{trader.totalTrades}</td>
                              <td style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: trader.pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {trader.pnl >= 0 ? '+' : ''}{trader.pnl}%
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {isFollowed ? (
                                  <span className="badge-following">Following</span>
                                ) : (
                                  <button onClick={() => followTraderDirect(trader.ensName, 1.0)} className="btn-sm">Follow</button>
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
                  <Wallet size={17} style={{ color: 'var(--accent)' }} />
                  Copy-Trading Wallet
                </h2>
                <div className="wallet-row">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Address (Base Sepolia)</div>
                    <div
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-main)', cursor: 'pointer' }}
                      onClick={() => { if (copyWallet) { navigator.clipboard.writeText(copyWallet.address); } }}
                      title="Click to copy"
                    >
                      {loadingWallet && !copyWallet ? <span style={{ color: '#6b7280' }}>Deploying wallet...</span> : (copyWallet ? shortenAddress(copyWallet.address) : '—')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.25rem' }}>
                      Privy Server Wallet
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Balance</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-main)' }}>
                      {copyWallet ? `${Number(copyWallet.balance).toFixed(5)} ETH` : '—'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
                  <button onClick={handleFundWallet} className="btn-primary" style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem' }}>
                    Universal Deposit
                  </button>
                  <button onClick={handleSendTestnetEth} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem' }} disabled={sendingEth}>
                    {sendingEth ? 'Sending...' : 'Send 0.002 ETH'}
                  </button>
                </div>
              </div>

              {/* World ID + WLD Hub */}
              <div className="glass-panel section-card worldid-card">
                <h2 className="section-title" style={{ marginBottom: '1.25rem' }}>
                  <Globe size={17} style={{ color: 'var(--accent)' }} />
                  World ID & WLD Hub
                </h2>

                {/* Verification Status */}
                <div className="worldid-status-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: verifiedHumanId ? 'rgba(5,150,105,0.15)' : 'rgba(217,119,6,0.12)', border: `1px solid ${verifiedHumanId ? 'rgba(5,150,105,0.3)' : 'rgba(217,119,6,0.3)'}` }}>
                      {verifiedHumanId ? <Check size={18} style={{ color: 'var(--success)' }} /> : <Shield size={18} style={{ color: 'var(--warning)' }} />}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: verifiedHumanId ? 'var(--success)' : 'var(--warning)' }}>
                        {verifiedHumanId ? 'Verified Human' : 'Not Verified'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'var(--font-mono)' }}>
                        {verifiedHumanId ? `ID: ${verifiedHumanId.substring(0, 20)}...` : '3 free copy-trades on verification'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={triggerVerification}
                    disabled={fetchingRpContext}
                    className="btn-sm"
                    style={{ background: verifiedHumanId ? 'rgba(5,150,105,0.1)' : 'rgba(217,119,6,0.1)', borderColor: verifiedHumanId ? 'rgba(5,150,105,0.3)' : 'rgba(217,119,6,0.3)', color: verifiedHumanId ? 'var(--success)' : 'var(--warning)' }}
                  >
                    {fetchingRpContext ? '...' : (verifiedHumanId ? 'Refill' : 'Verify')}
                  </button>
                </div>

                <div className="worldid-divider"></div>

                {/* WLD Balance & Purchase */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #1d4ed8, #0ea5e9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 800, color: 'white' }}>W</div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>WLD Balance</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>{wldBalance.toFixed(2)} WLD</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Copy-trade capacity
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginLeft: '0.5rem', fontWeight: 700 }}>
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
              <div className="glass-panel section-card">
                <h2 className="section-title">
                  <Play size={17} style={{ color: 'var(--accent)' }} />
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
                      <option key={f.address} value={f.address}>{f.ensName} ({shortenAddress(f.address)})</option>
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
                    <div className="success-banner" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <Check size={14} style={{ color: 'var(--success)' }} />
                      <div>
                        <div style={{ fontWeight: 700 }}>Simulated trade broadcasted!</div>
                        <div style={{ fontSize: '0.72rem', opacity: 0.8, fontFamily: 'var(--font-mono)' }}>
                          Tx: {shortenAddress(simSuccessHash)}
                        </div>
                      </div>
                    </div>
                  )}

                  {simError && (
                    <div className="error-banner" style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', padding: '0.75rem', borderRadius: '8px', fontSize: '0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '1rem' }}>❌</span>
                      <div>
                        <div style={{ fontWeight: 700 }}>Simulation failed</div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>{simError}</div>
                      </div>
                    </div>
                  )}

                  {simResults && (
                    <div style={{ marginTop: '0.75rem', border: '1px solid var(--panel-border)', borderRadius: '8px', background: '#fafafa', padding: '0.75rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.03em' }}>Copy Execution Logs</div>
                      {simResults.length === 0 ? (
                        <div style={{ fontSize: '0.78rem', color: '#6b7280', fontStyle: 'italic' }}>
                          No active followers found for this trader.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {simResults.map((res: any, idx: number) => {
                            const shortenedFollower = res.followerId.startsWith('did:privy:')
                              ? `did:${res.followerId.split(':').slice(-1)[0].substring(0, 8)}...`
                              : res.followerId.substring(0, 12) + '...';
                            return (
                              <div key={idx} style={{ fontSize: '0.76rem', display: 'flex', alignItems: 'flex-start', gap: '0.35rem', lineHeight: 1.4 }}>
                                {res.status === 'success' ? (
                                  <>
                                    <span style={{ color: '#10b981' }}>✅</span>
                                    <div style={{ flex: 1 }}>
                                      <strong>{shortenedFollower}</strong>: Success! Copy Tx:{' '}
                                      <a
                                        href={`https://sepolia.basescan.org/tx/${res.copyTxHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
                                      >
                                        {shortenAddress(res.copyTxHash)}
                                      </a>
                                    </div>
                                  </>
                                ) : res.status === 'gated' ? (
                                  <>
                                    <span style={{ color: '#f59e0b' }}>⚠️</span>
                                    <div style={{ flex: 1 }}>
                                      <strong>{shortenedFollower}</strong>: <span style={{ color: '#d97706', fontWeight: 500 }}>Gated (402)</span>
                                      <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>{res.message}</div>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <span style={{ color: '#ef4444' }}>❌</span>
                                    <div style={{ flex: 1 }}>
                                      <strong>{shortenedFollower}</strong>: <span style={{ color: '#dc2626', fontWeight: 500 }}>Failed</span>
                                      <div style={{ fontSize: '0.7rem', color: '#ef4444' }}>{res.message}</div>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </form>
              </div>

              {/* Copied Trades History */}
              <div className="glass-panel section-card">
                <h2 className="section-title">
                  <Activity size={17} style={{ color: 'var(--accent)' }} />
                  Copied Trades
                  <span className="count-badge">{trades.length}</span>
                </h2>
                {trades.length === 0 ? (
                  <div className="empty-state">No trades yet. Simulate a swap above or wait for a followed trader to execute on Hyperliquid.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="leaderboard-table" style={{ width: '100%' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', fontSize: '0.72rem', color: '#6b7280', borderBottom: '1px solid var(--panel-border)' }}>
                          <th style={{ paddingBottom: '0.6rem' }}>Trader</th>
                          <th style={{ paddingBottom: '0.6rem' }}>Trade</th>
                          <th style={{ paddingBottom: '0.6rem' }}>Base Sepolia Tx</th>
                          <th style={{ paddingBottom: '0.6rem' }}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.slice(0, 10).map((trade) => {
                          const traderAddr = trade.traderAddress || "";
                          const traderName = traders.find(t => t.address === traderAddr.toLowerCase())?.ensName || shortenAddress(traderAddr);
                          return (
                            <tr key={trade.id} style={{ borderBottom: '1px solid #f4f4f5' }}>
                              <td style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-main)' }}>
                                <a href={`https://hyperdash.com/address/${traderAddr}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                                  {traderName}
                                </a>
                              </td>
                              <td style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>
                                <span style={{ color: 'var(--text-main)' }}>{trade.amountIn} ETH</span>
                                <span style={{ color: '#6b7280', margin: '0 0.3rem' }}>→</span>
                                <span style={{ color: 'var(--success)' }}>USDC</span>
                              </td>
                              <td>
                                {trade.copyTxHash ? (
                                  <a
                                    href={`https://sepolia.basescan.org/tx/${trade.copyTxHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontSize: '0.78rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '0.25rem', textDecoration: 'none' }}
                                  >
                                    {shortenAddress(trade.copyTxHash)}
                                    <ExternalLink size={11} />
                                  </a>
                                ) : (
                                  <span style={{ fontSize: '0.78rem', color: '#6b7280', fontStyle: 'italic' }}>Pending / Failed</span>
                                )}
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

        {/* Real World ID Verifier Widget */}
        {activeRpContext && (
          <IDKitRequestWidget
            open={isVerifierOpen}
            onOpenChange={setIsVerifierOpen}
            app_id={(import.meta.env.VITE_WORLD_APP_ID || "app_f12b89cfd3bad7bfae952ddc2aa05a2e") as `app_${string}`}
            action={import.meta.env.VITE_WORLD_ACTION || "verify"}
            allow_legacy_proofs={true}
            rp_context={activeRpContext}
            preset={deviceLegacy()}
            handleVerify={handleVerifyRealWorldId}
            onSuccess={handleVerifySuccess}
          />
        )}

      </main>



      {/* WLD Purchase Modal */}
      {showPurchaseModal && (
        <div className="modal-overlay" onClick={() => !purchasingTrades && setShowPurchaseModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon-wrap" style={{ background: 'rgba(37,99,235,0.15)', border: '1px solid rgba(37,99,235,0.3)' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #1d4ed8, #0ea5e9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 800, color: 'white' }}>W</div>
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.4rem' }}>Purchase Copy-Trades</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.6, textAlign: 'center', maxWidth: '280px' }}>
              Spend <strong style={{ color: 'var(--text-main)' }}>1.0 WLD</strong> to unlock <strong style={{ color: 'var(--text-main)' }}>10 additional copy-trades</strong> beyond your free trial.
            </p>

            <div className="purchase-summary">
              <div className="purchase-row">
                <span>Copy-trades purchased</span>
                <span style={{ fontWeight: 700, color: 'var(--accent)' }}>+{purchaseAmount}</span>
              </div>
              <div className="purchase-row">
                <span>Cost</span>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{wldCostPerPurchase} WLD</span>
              </div>
              <div className="purchase-row" style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '0.6rem', marginTop: '0.25rem' }}>
                <span>Remaining balance</span>
                <span style={{ fontWeight: 700, color: wldBalance - wldCostPerPurchase < 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {(wldBalance - wldCostPerPurchase).toFixed(2)} WLD
                </span>
              </div>
            </div>

            {/* Purchase QR */}
            <div className="qr-scanner-box" style={{ borderColor: 'var(--panel-border)' }}>
              {purchasingTrades ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="spinner" style={{ borderTopColor: '#0ea5e9' }}></div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Confirming in World App...</span>
                </div>
              ) : (
                <>
                  <div className="mock-qr" style={{ borderColor: '#1d4ed8' }}>
                    {Array.from({ length: 25 }).map((_, i) => (
                      <div key={i} style={{ background: (i % 2 === 0 || i % 5 === 1 || i < 5 || i > 18) ? 'var(--primary)' : 'transparent', borderRadius: '2px', width: '100%', height: '100%' }}></div>
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

