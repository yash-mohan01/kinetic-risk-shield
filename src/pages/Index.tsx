import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { toast } from "@/hooks/use-toast";
import {
  Activity,
  Bell,
  Globe,
  MapPin,
  MousePointer2,
  Settings as SettingsIcon,
  ShieldAlert,
  Smartphone,
  Wallet,
  Send,
  ReceiptText,
  LogIn
} from "lucide-react";

// Design system helpers
const easePrimary = (t: number) => {
  // cubic-bezier(.22,.9,.35,1)
  const p0 = 0, p1 = 0.22, p2 = 0.9, p3 = 0.35, p4 = 1;
  // We'll approximate with easeOutCubic for rAF; visual match is close
  return 1 - Math.pow(1 - t, 3);
};

// Risk config (tunable by product team)
const riskConfig = {
  weights: {
    SIM_SWAP: 30,
    VPN: 25,
    DEVICE_CHANGE: 20,
    LOCATION_MISMATCH: 15,
    TYPING_ANOMALY: 10,
    LARGE_TRANSFER: 35,
  },
  thresholds: {
    largeTransfer: 50000,
  },
};

type RiskEventType = keyof typeof riskConfig.weights;

// Simple event bus for broadcasting events across panels
const createEventBus = () => {
  type Listener = (evt: { type: RiskEventType; at: number; meta?: Record<string, any> }) => void;
  const listeners = new Set<Listener>();
  return {
    on: (fn: Listener) => {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    emit: (type: RiskEventType, meta?: Record<string, any>) => {
      const payload = { type, at: Date.now(), meta };
      listeners.forEach((l) => l(payload));
    },
  };
};

const bus = createEventBus();

// Utils
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Risk score store inside the page (demo only)
function useRiskEngine() {
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState<Array<{ t: number; v: number }>>([]);
  const [indicators, setIndicators] = useState({
    SIM_SWAP: false,
    VPN: false,
    DEVICE_CHANGE: false,
    LOCATION_MISMATCH: false,
    TYPING_ANOMALY: false,
  });

  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // Decay score toward 0 over time
  useEffect(() => {
    const id = setInterval(() => {
      setScore((s) => Math.max(0, Math.round(s * 0.9)));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Append history every 1s
  useEffect(() => {
    const id = setInterval(() => {
      setHistory((h) => {
        const next = [...h, { t: Date.now(), v: score }];
        return next.slice(-60);
      });
    }, 1000);
    return () => clearInterval(id);
  }, [score]);

  // Listen to events
  useEffect(() => {
    const off = bus.on(({ type }) => {
      const weight = riskConfig.weights[type];
      setScore((s) => clamp(s + weight, 0, 100));
      setIndicators((prev) => ({ ...prev, [type]: true } as any));
    });
    return off;
  }, []);

  // API to manually toggle indicators (e.g., in Settings)
  const toggleIndicator = (key: keyof typeof indicators, on?: boolean) => {
    setIndicators((prev) => ({ ...prev, [key]: on ?? !prev[key] }));
    if (key === "VPN" && (on ?? !indicators[key])) {
      toast({ title: "VPN detected", description: "Network anomaly may increase risk." });
    }
  };

  return { score, history, indicators, toggleIndicator, reducedMotion };
}

// Gauge component (SVG) with animated arc + numeric tween
const Gauge: React.FC<{ value: number; reducedMotion?: boolean }> = ({ value, reducedMotion }) => {
  const size = 180;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const [display, setDisplay] = useState(0);
  const [animScale, setAnimScale] = useState(1);
  const prev = useRef(0);
  const rafRef = useRef<number | null>(null);

  const bandColor = (v: number) => {
    if (v >= 70) return "var(--risk-red)";
    if (v >= 31) return "var(--risk-yellow)";
    return "var(--risk-green)";
  };

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(value);
      prev.current = value;
      return;
    }
    const start = performance.now();
    const from = prev.current;
    const to = value;

    const duration = 420;

    const step = (now: number) => {
      const p = clamp((now - start) / duration, 0, 1);
      const t = easePrimary(p);
      const n = Math.round(lerp(from, to, t));
      setDisplay(n);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prev.current = to;
      }
    };

    // micro bounce
    setAnimScale(1.02);
    const bounceId = setTimeout(() => setAnimScale(1), duration);
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimeout(bounceId);
    };
  }, [value, reducedMotion]);

  const dashOffset = useMemo(() => {
    const pct = clamp(display, 0, 100) / 100;
    return circumference * (1 - pct);
  }, [display, circumference]);

  const color = bandColor(display);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="will-change-transform"
        style={{ transform: `scale(${animScale})`, transition: reducedMotion ? undefined : "transform 420ms" }}
        aria-label={`Risk score gauge ${display}`}
      >
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={color} floodOpacity="0.5" />
          </filter>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
          fill="none"
          opacity={0.4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - dashOffset}
          style={{ filter: "url(#glow)", transition: reducedMotion ? undefined : "stroke 300ms" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-5xl font-bold tracking-tight" aria-live="polite" aria-atomic="true">{display}</div>
          <div className="text-sm text-muted-foreground">Risk Score</div>
        </div>
      </div>
    </div>
  );
};

// Sparkline (SVG)
const Sparkline: React.FC<{ data: Array<{ t: number; v: number }> }> = ({ data }) => {
  const width = 240;
  const height = 64;
  if (!data.length) return (
    <svg width={width} height={height} aria-hidden>
      <rect width={width} height={height} className="fill-muted/40" />
    </svg>
  );
  const min = 0;
  const max = 100;
  const pts = data.map((d, i) => [
    (i / Math.max(1, data.length - 1)) * (width - 8) + 4,
    height - 8 - ((d.v - min) / (max - min)) * (height - 16),
  ] as const);
  const path = pts.reduce((acc, [x, y], i) => (i === 0 ? `M ${x},${y}` : acc + ` L ${x},${y}`), "");
  return (
    <svg width={width} height={height} role="img" aria-label="Last 60 seconds risk sparkline">
      <defs>
        <linearGradient id="spark" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="hsl(var(--accent))" />
          <stop offset="100%" stopColor="hsl(var(--primary))" />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke="url(#spark)" strokeWidth={2} />
    </svg>
  );
};

// Indicator toggle pill
type IndicatorKey = "SIM_SWAP" | "VPN" | "DEVICE_CHANGE" | "LOCATION_MISMATCH" | "TYPING_ANOMALY";
const INDICATOR_META: Record<IndicatorKey, { label: string; icon: React.ElementType }> = {
  SIM_SWAP: { label: "SIM Swap", icon: ShieldAlert },
  VPN: { label: "VPN/Proxy", icon: Globe },
  DEVICE_CHANGE: { label: "Device Change", icon: Smartphone },
  LOCATION_MISMATCH: { label: "Location", icon: MapPin },
  TYPING_ANOMALY: { label: "Typing", icon: Activity },
};

const IndicatorToggle: React.FC<{
  k: IndicatorKey;
  on: boolean;
  onChange: (on: boolean) => void;
}> = ({ k, on, onChange }) => {
  const Icon = INDICATOR_META[k].icon as any;
  return (
    <button
      className={`flex items-center justify-between w-full px-3 py-2 rounded-full transition-all duration-200 hover-scale ${
        on ? "indicator-on" : "indicator-off"
      }`}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="text-sm">{INDICATOR_META[k].label}</span>
      </span>
      <span className={`toggle ${on ? "on" : "off"}`} aria-hidden />
    </button>
  );
};

// Risk Panel (fixed)
const RiskPanel: React.FC<{
  score: number;
  history: Array<{ t: number; v: number }>;
  indicators: Record<IndicatorKey, boolean>;
  reducedMotion?: boolean;
}> = ({ score, history, indicators, reducedMotion }) => {
  const bandText = score >= 70 ? "High Risk" : score >= 31 ? "Caution" : "Safe";
  const bandColor = score >= 70 ? "var(--risk-red)" : score >= 31 ? "var(--risk-yellow)" : "var(--risk-green)";

  return (
    <aside className="fixed left-0 top-0 bottom-0 hidden md:flex" style={{ width: "var(--risk-width)" }} aria-label="Risk Meter panel">
      <div className="h-full w-full p-4 md:p-5 lg:p-6 flex flex-col gap-4 glass-panel border-r border-border">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="boi-logo" aria-hidden />
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Risk Meter — Live</div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground"><span className="live-dot" aria-hidden /> live</div>
            </div>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Gauge value={score} reducedMotion={reducedMotion} />
          <div className="text-sm" style={{ color: bandColor }}>{bandText}</div>
          <Sparkline data={history} />
        </div>

        <section aria-label="Risk indicators" className="grid grid-cols-1 gap-2">
          {(Object.keys(INDICATOR_META) as IndicatorKey[]).map((k) => (
            <IndicatorToggle key={k} k={k} on={indicators[k]} onChange={() => { /* readonly in panel */ }} />
          ))}
        </section>

        <footer className="mt-auto pt-2 border-t border-border/50 text-xs text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="timeline-dot" aria-hidden />
              ))}
            </div>
            <span>Simulated events</span>
          </div>
          <Button variant="glass" size="sm" aria-label="Replay last 30 seconds">Replay 30s</Button>
        </footer>
      </div>
    </aside>
  );
};

// Custom Cursor with trail (respects reduced motion)
const CustomCursor: React.FC = () => {
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // use system cursor

    const ring = document.createElement("div");
    ring.className = "cursor-ring";
    document.body.appendChild(ring);

    let last = 0;
    const particles: HTMLDivElement[] = [];

    const move = (e: MouseEvent) => {
      const now = performance.now();
      if (now - last < 16) return; // ~60fps throttle
      last = now;
      const x = e.clientX;
      const y = e.clientY;
      ring.style.transform = `translate3d(${x - 12}px, ${y - 12}px, 0)`;

      // trail
      const p = document.createElement("div");
      p.className = "cursor-particle";
      p.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${0.8 + Math.random() * 0.4})`;
      document.body.appendChild(p);
      particles.push(p);
      setTimeout(() => {
        p.style.opacity = "0";
        p.style.transform += " scale(0.7)";
        setTimeout(() => {
          p.remove();
          particles.shift();
        }, 420);
      }, 30);
      if (particles.length > 12) {
        const old = particles.shift();
        old?.remove();
      }
    };

    const down = () => {
      ring.classList.add("active");
      // burst
      for (let i = 0; i < 6; i++) {
        const b = document.createElement("div");
        b.className = "cursor-particle";
        const angle = (Math.PI * 2 * i) / 6;
        const r = 20 + Math.random() * 10;
        const x = r * Math.cos(angle);
        const y = r * Math.sin(angle);
        b.style.transform = `translate3d(calc(var(--cursor-x) + ${x}px), calc(var(--cursor-y) + ${y}px), 0)`;
        document.body.appendChild(b);
        setTimeout(() => {
          b.style.opacity = "0";
          setTimeout(() => b.remove(), 360);
        }, 20);
      }
    };
    const up = () => ring.classList.remove("active");

    const pointer = (e: MouseEvent) => {
      document.documentElement.style.setProperty("--cursor-x", `${e.clientX}px`);
      document.documentElement.style.setProperty("--cursor-y", `${e.clientY}px`);
    };

    window.addEventListener("mousemove", pointer);
    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);

    return () => {
      ring.remove();
      window.removeEventListener("mousemove", pointer);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("mouseup", up);
    };
  }, []);
  return null;
};

// Top navigation bar
const TopNav: React.FC<{ page: string; setPage: (p: string) => void; balance: number }> = ({ page, setPage, balance }) => {
  return (
    <div className="sticky top-4 z-40 mx-5">
      <div className="glass-bar rounded-lg px-4 py-3 flex items-center justify-between shadow-soft">
        <div className="flex items-center gap-3">
          <div className="boi-logo" aria-hidden />
          <div className="text-sm text-muted-foreground">Bank of India</div>
        </div>
        <div className="hidden md:flex items-center gap-6">
          <nav className="flex items-center gap-4 text-sm">
            {[
              ["home", "Home"],
              ["payments", "Payments"],
              ["passbook", "Passbook"],
              ["settings", "Settings"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPage(key)}
                className={`story-link ${page === key ? "text-primary" : "text-muted-foreground"}`}
                aria-current={page === key ? "page" : undefined}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="text-lg font-semibold">₹ {balance.toLocaleString()}</div>
          <button className="relative">
            <Bell className="h-5 w-5" aria-label="Notifications" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-primary" aria-hidden />
          </button>
          <div className="avatar-circle" role="img" aria-label="Profile" />
        </div>
        <div className="md:hidden">
          <SettingsIcon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
};

// Pages
const LoginPage: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const [typingCount, setTyping] = useState(0);
  return (
    <div className="flex min-h-[70vh] items-center justify-center animate-enter">
      <Card className="glass-panel p-6 w-full max-w-md">
        <h2 className="text-2xl font-semibold mb-4">Sign in</h2>
        <div className="space-y-3">
          <label className="block text-sm">Account or Email</label>
          <input className="input-glass" placeholder="e.g. 1234-5678-90 or you@bank.com" onChange={() => {
            setTyping((c) => c + 1);
            if (typingCount % 4 === 0) bus.emit("TYPING_ANOMALY");
          }} />
          <label className="block text-sm">Password</label>
          <input type="password" className="input-glass" placeholder="Enter password" onChange={() => {
            setTyping((c) => c + 1);
            if (typingCount % 3 === 0) bus.emit("TYPING_ANOMALY");
          }} />
          <Button variant="hero" className="w-full mt-2" onClick={onLogin}>
            <LogIn className="mr-2 h-4 w-4" /> Continue
          </Button>
        </div>
      </Card>
    </div>
  );
};

const HomePage: React.FC<{ setPage: (p: string) => void }> = ({ setPage }) => {
  return (
    <div className="space-y-6 animate-enter">
      <Card className="glass-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Current Balance</div>
            <div className="text-3xl font-semibold">₹ 2,54,220.33</div>
          </div>
          <Sparkline data={[]} />
        </div>
        <div className="mt-4 flex gap-3">
          <Button variant="glass" onClick={() => setPage("payments")}><Send /> Transfer</Button>
          <Button variant="glass" onClick={() => setPage("payments")}><Wallet /> Pay Bill</Button>
          <Button variant="glass" onClick={() => setPage("passbook")}><ReceiptText /> Passbook</Button>
        </div>
      </Card>
      <Card className="glass-panel p-6">
        <div className="text-sm text-muted-foreground mb-3">Recent Activity</div>
        <div className="divide-y divide-border/60">
          {[
            { title: "UPI to Rohan", amt: "-₹ 1,250" },
            { title: "Salary", amt: "+₹ 1,20,000" },
            { title: "Electricity Bill", amt: "-₹ 2,340" },
          ].map((r, i) => (
            <div key={i} className="flex items-center justify-between py-3 group">
              <div className="flex items-center gap-3">
                <MousePointer2 className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                <div>{r.title}</div>
              </div>
              <div className="opacity-80 group-hover:opacity-100 transition-opacity">{r.amt}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

const PaymentsPage: React.FC = () => {
  const [amount, setAmount] = useState(0);
  const submit = () => {
    if (amount > riskConfig.thresholds.largeTransfer) {
      bus.emit("LARGE_TRANSFER", { amount });
    }
    toast({ title: "Transfer submitted", description: `₹ ${amount.toLocaleString()} scheduled.` });
  };
  return (
    <Card className="glass-panel p-6 animate-enter">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-1">Recipient</label>
          <input className="input-glass" placeholder="UPI / Account" />
        </div>
        <div>
          <label className="block text-sm mb-1">Amount (₹)</label>
          <input className="input-glass" placeholder="0" type="number" onChange={(e) => setAmount(parseFloat(e.target.value || "0"))} />
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <Button variant="hero" onClick={submit}><Send className="mr-2 h-4 w-4" /> Confirm</Button>
        <Button variant="glass">Advanced</Button>
      </div>
    </Card>
  );
};

const PassbookPage: React.FC = () => {
  const txs = Array.from({ length: 12 }).map((_, i) => ({
    id: i,
    title: i % 3 === 0 ? "Transfer" : "UPI payment",
    amt: i % 3 === 0 ? -5320 : -(120 + i * 3),
    risk: i % 5 === 0 ? "red" : i % 4 === 0 ? "yellow" : "green",
  }));
  const colorVar = (r: string) => (r === "red" ? "var(--risk-red)" : r === "yellow" ? "var(--risk-yellow)" : "var(--risk-green)");
  return (
    <Card className="glass-panel p-6 animate-enter">
      <div className="space-y-3">
        {txs.map((t) => (
          <div key={t.id} className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorVar(t.risk) }} aria-hidden />
              <span>{t.title}</span>
            </div>
            <div className="opacity-80">{t.amt < 0 ? "-" : "+"}₹ {Math.abs(t.amt).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const SettingsPage: React.FC<{ toggle: (k: IndicatorKey, on?: boolean) => void }> = ({ toggle }) => {
  const [vpn, setVpn] = useState(false);
  const [device, setDevice] = useState(false);
  return (
    <Card className="glass-panel p-6 animate-enter">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Globe className="h-4 w-4" /><span>VPN/Proxy</span></div>
          <button className={`toggle ${vpn ? "on" : "off"}`} onClick={() => { const n = !vpn; setVpn(n); toggle("VPN", n); }} aria-pressed={vpn} aria-label="Toggle VPN" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Smartphone className="h-4 w-4" /><span>Register new device</span></div>
          <button className={`toggle ${device ? "on" : "off"}`} onClick={() => { const n = !device; setDevice(n); toggle("DEVICE_CHANGE", n); }} aria-pressed={device} aria-label="Toggle device" />
        </div>
      </div>
    </Card>
  );
};

const MobileRiskWidget: React.FC<{ score: number }> = ({ score }) => {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button className="fixed md:hidden top-4 left-4 z-50 risk-fab" aria-label={`Open Risk Meter (score ${score})`}>
          <span className="text-sm font-semibold">{score}</span>
        </button>
      </DrawerTrigger>
      <DrawerContent className="p-0">
        <DrawerHeader>
          <DrawerTitle>Risk Meter</DrawerTitle>
        </DrawerHeader>
        <div className="p-4">
          {/* Minimal embed: we inform users the full live panel is on larger screens */}
          <div className="text-sm text-muted-foreground mb-2">Live risk details are best viewed on tablet/desktop.</div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

const PageShell: React.FC = () => {
  const { score, history, indicators, toggleIndicator, reducedMotion } = useRiskEngine();
  const [page, setPage] = useState<string>("login");
  const [balance] = useState(254220.33);

  useEffect(() => {
    // Demo choreography: small simulated anomalies on load
    const t1 = setTimeout(() => bus.emit("TYPING_ANOMALY"), 1200);
    const t2 = setTimeout(() => bus.emit("LOCATION_MISMATCH"), 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const onLogin = () => setPage("home");

  // Accessibility: announce risk score
  useEffect(() => {
    const el = document.getElementById("sr-risk");
    if (el) el.textContent = `Risk score updated to ${score} — ${score >= 70 ? "High Risk" : score >= 31 ? "Caution" : "Safe"}`;
  }, [score]);

  return (
    <div>
      <h1 className="sr-only">Bank of India Risk-Aware Banking</h1>
      <RiskPanel score={score} history={history} indicators={indicators as any} reducedMotion={reducedMotion} />
      <MobileRiskWidget score={score} />
      <div className="ml-0 md:ml-[var(--risk-width)] min-h-screen">
        <TopNav page={page} setPage={setPage} balance={balance} />
        <main className="px-5 pb-10 space-y-6">
          {page === "login" && <LoginPage onLogin={onLogin} />}
          {page === "home" && <HomePage setPage={setPage} />}
          {page === "payments" && <PaymentsPage />}
          {page === "passbook" && <PassbookPage />}
          {page === "settings" && <SettingsPage toggle={toggleIndicator as any} />}
        </main>
      </div>
      <div id="sr-risk" className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
      <CustomCursor />
    </div>
  );
};

const Index = () => {
  return (
    <div className="min-h-screen bg-app">
      <PageShell />
    </div>
  );
};

export default Index;
