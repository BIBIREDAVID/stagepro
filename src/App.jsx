import { useState, useEffect, useRef } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useParams,
  Navigate,
} from "react-router-dom";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
} from "firebase/firestore";

// ── Firebase ───────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCdCYZ4gc1sVhwhIxI0TwK9j9ZXr46DiQo",
  authDomain: "stagepro-327e8.firebaseapp.com",
  projectId: "stagepro-327e8",
  storageBucket: "stagepro-327e8.firebasestorage.app",
  messagingSenderId: "520605020480",
  appId: "1:520605020480:web:c73d3d4e9c26f3a9a74aa5",
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ── Google Sheets logger (non-blocking) ────────────────────────────────────
const logToSheets = async (payload) => {
  try {
    await fetch(import.meta.env.VITE_SHEETS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("Sheets log failed (non-critical):", err);
  }
};

// ── CSV Download ───────────────────────────────────────────────────────────
function downloadCSV(event, tickets) {
  const eventTickets = tickets.filter(t => t.eventId === event.id);
  if (eventTickets.length === 0) { alert("No tickets sold for this event yet."); return; }
  const headers = ["Ticket ID", "Event", "Tier", "Buyer Name", "Price (₦)", "Date Purchased", "Used"];
  const rows = eventTickets.map(t => [
    t.id, t.eventTitle, t.tierName, t.userName, t.price,
    new Date(t.purchasedAt).toLocaleString("en-NG"),
    t.used ? "Yes" : "No",
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.replace(/\s+/g, "_")}_tickets.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── QR Code — now encodes a full URL ──────────────────────────────────────
const QRCode = ({ ticketId, size = 160 }) => {
  const url = `${window.location.origin}/ticket/${ticketId}`;
  return (
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=0a0a0a&color=f5a623&format=svg`}
      alt="QR Code" width={size} height={size} style={{ borderRadius: 8 }}
    />
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => `₦${Number(n).toLocaleString()}`;
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-NG", {
    weekday: "short", year: "numeric", month: "long", day: "numeric",
  });

// ── Seed events ────────────────────────────────────────────────────────────
const SEED_EVENTS = [
  {
    id: "evt-001", title: "Neon Dystopia", subtitle: "Electronic Music Festival",
    date: "2025-08-15", time: "20:00", venue: "Lagos Arena, Victoria Island",
    category: "Festival", image: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80",
    tiers: [
      { id: "t1", name: "General", price: 8500, total: 500, sold: 312 },
      { id: "t2", name: "VIP", price: 25000, total: 100, sold: 67 },
      { id: "t3", name: "VVIP Table", price: 120000, total: 20, sold: 8 },
    ],
    organizer: "seed",
    description: "An immersive electronic music experience featuring Africa's top DJs and international acts across 3 stages.",
  },
  {
    id: "evt-002", title: "Champions Cup 2025", subtitle: "Football — Group Stage",
    date: "2025-09-03", time: "18:30", venue: "National Stadium, Surulere",
    category: "Sports", image: "https://images.unsplash.com/photo-1508098682722-e99c643e7f0b?w=800&q=80",
    tiers: [
      { id: "t1", name: "Terrace", price: 3000, total: 1000, sold: 754 },
      { id: "t2", name: "Main Stand", price: 7500, total: 400, sold: 280 },
      { id: "t3", name: "Executive Box", price: 45000, total: 50, sold: 22 },
    ],
    organizer: "seed",
    description: "Watch the continent's finest clubs battle for supremacy in this electrifying group-stage clash.",
  },
  {
    id: "evt-003", title: "Afrobeats Live", subtitle: "A Night with Burna & Friends",
    date: "2025-10-20", time: "19:00", venue: "Eko Convention Centre",
    category: "Concert", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80",
    tiers: [
      { id: "t1", name: "Floor", price: 15000, total: 800, sold: 430 },
      { id: "t2", name: "Balcony", price: 35000, total: 200, sold: 88 },
    ],
    organizer: "seed",
    description: "An unforgettable night celebrating the global phenomenon of Afrobeats with Nigeria's biggest superstar.",
  },
];

// ── Global styles ──────────────────────────────────────────────────────────
const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --gold: #f5a623; --gold-dim: #c47d0e;
    --bg: #080808; --bg2: #111111; --bg3: #1a1a1a;
    --border: #2a2a2a; --text: #e8e0d0; --muted: #666;
    --red: #e84040; --green: #3ddc84;
  }
  body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  h1, h2, h3 { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.04em; }
  a { color: inherit; text-decoration: none; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg2); }
  ::-webkit-scrollbar-thumb { background: var(--gold-dim); border-radius: 2px; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
`;

// ── Shared components ──────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"60vh" }}>
      <div style={{ width:40, height:40, border:"3px solid var(--border)", borderTop:"3px solid var(--gold)", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
    </div>
  );
}

function Notification({ msg, type }) {
  return (
    <div style={{ position:"fixed", top:24, right:24, zIndex:9999, background: type==="success"?"var(--green)":"var(--red)", color:"#000", padding:"12px 20px", borderRadius:8, fontWeight:600, fontSize:14, animation:"fadeUp 0.3s ease", boxShadow:"0 8px 32px rgba(0,0,0,0.4)" }}>
      {msg}
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div>
      {label && <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>{label.toUpperCase()}</label>}
      <input {...props} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none", fontFamily:"DM Sans" }} />
    </div>
  );
}

// ── Nav ────────────────────────────────────────────────────────────────────
function Nav({ currentUser, logout, notification }) {
  return (
    <>
      <style>{STYLE}</style>
      {notification && <Notification {...notification} />}
      <nav style={{ position:"sticky", top:0, zIndex:100, background:"rgba(8,8,8,0.92)", backdropFilter:"blur(12px)", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 32px", height:60 }}>
        <Link to="/" style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontFamily:"Bebas Neue", fontSize:26, color:"var(--gold)", letterSpacing:2 }}>STAGE</span>
          <span style={{ fontFamily:"Bebas Neue", fontSize:26, color:"var(--text)", letterSpacing:2 }}>PRO</span>
        </Link>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {currentUser ? (
            <>
              {currentUser.role === "organizer" && (
                <>
                  <Link to="/dashboard" style={{ color:"var(--muted)", fontSize:14, fontWeight:500, padding:"6px 12px" }}>Dashboard</Link>
                  <Link to="/validate" style={{ color:"var(--muted)", fontSize:14, fontWeight:500, padding:"6px 12px" }}>Scan</Link>
                </>
              )}
              {currentUser.role === "customer" && (
                <Link to="/tickets" style={{ color:"var(--muted)", fontSize:14, fontWeight:500, padding:"6px 12px" }}>My Tickets</Link>
              )}
              <div style={{ width:32, height:32, borderRadius:"50%", background:"var(--gold)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:"#000", fontSize:13 }}>
                {currentUser.name?.[0] ?? "U"}
              </div>
              <button onClick={logout} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:13 }}>Sign out</button>
            </>
          ) : (
            <>
              <Link to="/login" style={{ color:"var(--muted)", fontSize:14, fontWeight:500, padding:"6px 12px" }}>Login</Link>
              <Link to="/register" style={{ background:"var(--gold)", color:"#000", padding:"8px 18px", borderRadius:6, fontWeight:600, fontSize:14 }}>Get Started</Link>
            </>
          )}
        </div>
      </nav>
    </>
  );
}

// ── Root App ───────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [notification, setNotification] = useState(null);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (snap.exists()) setCurrentUser({ uid: firebaseUser.uid, ...snap.data() });
      } else {
        setCurrentUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const init = async () => {
      setEventsLoading(true);
      try {
        for (const ev of SEED_EVENTS) {
          const ref = doc(db, "events", ev.id);
          const snap = await getDoc(ref);
          if (!snap.exists()) await setDoc(ref, ev);
        }
        const snapshot = await getDocs(collection(db, "events"));
        setEvents(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) { console.error(err); }
      setEventsLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (!currentUser) { setTickets([]); return; }
    const load = async () => {
      try {
        const q = currentUser.role === "organizer"
          ? collection(db, "tickets")
          : query(collection(db, "tickets"), where("userId", "==", currentUser.uid));
        const snap = await getDocs(q);
        setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) { console.error(err); }
    };
    load();
  }, [currentUser]);

  const login = async (email, password) => {
    try {
      const res = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, "users", res.user.uid));
      const userData = { uid: res.user.uid, ...snap.data() };
      setCurrentUser(userData);
      notify(`Welcome back, ${userData.name.split(" ")[0]}!`);
      return { ok: true, role: userData.role };
    } catch { return { ok: false }; }
  };

  const register = async (name, email, password, role) => {
    try {
      const res = await createUserWithEmailAndPassword(auth, email, password);
      const userData = { name, email, role };
      await setDoc(doc(db, "users", res.user.uid), userData);
      setCurrentUser({ uid: res.user.uid, ...userData });
      notify(`Account created! Welcome, ${name.split(" ")[0]}!`);
      return { ok: true, role };
    } catch (err) { console.error(err); return { ok: false }; }
  };

  const logout = async () => { await signOut(auth); setCurrentUser(null); };

  const purchaseTickets = async (eventId, cartSelections) => {
    const event = events.find(e => e.id === eventId);
    const newTickets = [];
    try {
      for (const tier of event.tiers) {
        const qty = cartSelections[tier.id] || 0;
        if (!qty) continue;
        for (let i = 0; i < qty; i++) {
          const ticketData = {
            eventId, eventTitle: event.title, eventDate: event.date,
            eventTime: event.time, venue: event.venue,
            tierName: tier.name, price: tier.price,
            userId: currentUser.uid, userName: currentUser.name,
            used: false, purchasedAt: new Date().toISOString(),
          };
          const ref = await addDoc(collection(db, "tickets"), ticketData);
          const newTicket = { id: ref.id, ...ticketData };
          newTickets.push(newTicket);
          logToSheets({
            action: "purchase", ticketId: ref.id,
            eventTitle: event.title, tierName: tier.name,
            userName: currentUser.name, email: currentUser.email,
            price: tier.price, purchasedAt: new Date().toLocaleString("en-NG"),
          });
        }
        const updatedTiers = event.tiers.map(t =>
          t.id === tier.id ? { ...t, sold: t.sold + qty } : t
        );
        await updateDoc(doc(db, "events", eventId), { tiers: updatedTiers });
      }
      setTickets(prev => [...prev, ...newTickets]);
      setEvents(prev => prev.map(e => e.id !== eventId ? e : {
        ...e, tiers: e.tiers.map(t => ({ ...t, sold: t.sold + (cartSelections[t.id] || 0) })),
      }));
      notify(`${newTickets.length} ticket(s) purchased!`);
      return true;
    } catch (err) {
      console.error(err);
      notify("Purchase failed. Try again.", "error");
      return false;
    }
  };

  // ── Core validate logic — reused by both ValidatePage and TicketPage ────
  const validateTicket = async (id) => {
    try {
      const ref = doc(db, "tickets", id.trim());
      const snap = await getDoc(ref);
      if (!snap.exists()) return { ok: false, msg: "Ticket not found" };
      const ticket = { id: snap.id, ...snap.data() };
      if (ticket.used) return { ok: false, msg: "Ticket already used", ticket };
      await updateDoc(ref, { used: true });
      setTickets(prev => prev.map(t => t.id === id.trim() ? { ...t, used: true } : t));
      logToSheets({ action: "validate", ticketId: id.trim(), eventTitle: ticket.eventTitle });
      return { ok: true, msg: "Valid! Entry granted", ticket: { ...ticket, used: true } };
    } catch {
      return { ok: false, msg: "Error checking ticket" };
    }
  };

  const createEvent = async (eventData) => {
    try {
      const data = {
        ...eventData,
        image: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&q=80",
        organizer: currentUser.uid,
        tiers: eventData.tiers.map((t, i) => ({
          ...t, id: `t${i+1}`, price: Number(t.price), total: Number(t.total), sold: 0,
        })),
      };
      const ref = await addDoc(collection(db, "events"), data);
      const newEvent = { id: ref.id, ...data };
      setEvents(prev => [...prev, newEvent]);
      notify("Event published!");
      return newEvent;
    } catch (err) {
      console.error(err);
      notify("Failed to create event.", "error");
      return null;
    }
  };

  if (authLoading) return <><style>{STYLE}</style><Spinner /></>;

  const ctx = { currentUser, events, tickets, eventsLoading, notify, login, register, logout, purchaseTickets, validateTicket, createEvent };

  return (
    <BrowserRouter>
      <Nav currentUser={currentUser} logout={logout} notification={notification} />
      <main style={{ minHeight:"calc(100vh - 60px)" }}>
        <Routes>
          <Route path="/" element={<HomePage ctx={ctx} />} />
          <Route path="/login" element={<AuthPage mode="login" ctx={ctx} />} />
          <Route path="/register" element={<AuthPage mode="register" ctx={ctx} />} />
          <Route path="/event/:eventId" element={<EventPage ctx={ctx} />} />
          <Route path="/event/:eventId/checkout" element={<CheckoutPage ctx={ctx} />} />
          <Route path="/tickets" element={currentUser ? <MyTicketsPage ctx={ctx} /> : <Navigate to="/login" />} />
          <Route path="/ticket/:ticketId" element={<TicketPage ctx={ctx} />} />
          <Route path="/dashboard" element={currentUser?.role === "organizer" ? <DashboardPage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/dashboard/create" element={currentUser?.role === "organizer" ? <CreateEventPage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/validate" element={currentUser?.role === "organizer" ? <ValidatePage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

// ── Ticket Page (/ticket/:ticketId) — public, QR scan destination ──────────
function TicketPage({ ctx }) {
  const { ticketId } = useParams();
  const { currentUser, validateTicket } = ctx;
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "tickets", ticketId));
        if (snap.exists()) setTicket({ id: snap.id, ...snap.data() });
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [ticketId]);

  const handleValidate = async () => {
    setValidating(true);
    const res = await validateTicket(ticketId);
    setResult(res);
    if (res.ok) setTicket(prev => ({ ...prev, used: true }));
    setValidating(false);
  };

  if (loading) return <Spinner />;

  if (!ticket) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"60vh", gap:16, padding:24, textAlign:"center" }}>
      <div style={{ fontSize:64 }}>❌</div>
      <h2 style={{ fontFamily:"Bebas Neue", fontSize:40, color:"var(--red)" }}>TICKET NOT FOUND</h2>
      <p style={{ color:"var(--muted)" }}>This ticket ID does not exist in our system.</p>
    </div>
  );

  const isOrganizer = currentUser?.role === "organizer";
  const alreadyUsed = result ? result.ticket?.used : ticket.used;

  return (
    <div style={{ maxWidth:480, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>

      {/* Status banner */}
      <div style={{
        borderRadius:16, padding:"20px 24px", marginBottom:24, textAlign:"center",
        background: alreadyUsed ? "rgba(232,64,64,0.1)" : "rgba(61,220,132,0.1)",
        border: `2px solid ${alreadyUsed ? "var(--red)" : "var(--green)"}`,
      }}>
        <div style={{ fontSize:48, marginBottom:8 }}>{alreadyUsed ? "❌" : "✅"}</div>
        <div style={{ fontFamily:"Bebas Neue", fontSize:36, color: alreadyUsed ? "var(--red)" : "var(--green)" }}>
          {alreadyUsed ? "TICKET USED" : "VALID TICKET"}
        </div>
        <div style={{ color:"var(--muted)", fontSize:13, marginTop:4 }}>
          {alreadyUsed ? "This ticket has already been scanned at entry" : "This ticket is valid for entry"}
        </div>
      </div>

      {/* Ticket details */}
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden", marginBottom:20 }}>
        <div style={{ padding:"20px 24px", borderBottom:"1px solid var(--border)" }}>
          <div style={{ fontSize:11, letterSpacing:3, color:"var(--gold)", marginBottom:6 }}>EVENT</div>
          <div style={{ fontFamily:"Bebas Neue", fontSize:32, lineHeight:1, marginBottom:4 }}>{ticket.eventTitle}</div>
        </div>
        <div style={{ padding:"20px 24px", display:"grid", gap:16 }}>
          {[
            ["🎫 Tier", ticket.tierName],
            ["📅 Date", fmtDate(ticket.eventDate)],
            ["🕐 Time", ticket.eventTime],
            ["📍 Venue", ticket.venue],
            ["👤 Holder", ticket.userName],
            ["💰 Price", fmt(ticket.price)],
          ].map(([label, value]) => (
            <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:14 }}>
              <span style={{ color:"var(--muted)" }}>{label}</span>
              <span style={{ fontWeight:600, textAlign:"right", maxWidth:"60%" }}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{ padding:"16px 24px", borderTop:"1px solid var(--border)", background:"var(--bg3)" }}>
          <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:4 }}>TICKET ID</div>
          <div style={{ fontFamily:"DM Mono", fontSize:12, color:"var(--gold)", wordBreak:"break-all" }}>{ticket.id}</div>
        </div>
      </div>

      {/* Organizer: validate button */}
      {isOrganizer && !alreadyUsed && !result && (
        <button
          onClick={handleValidate}
          disabled={validating}
          style={{ width:"100%", padding:18, background:"var(--green)", color:"#000", border:"none", borderRadius:12, fontFamily:"Bebas Neue", fontSize:24, letterSpacing:2, cursor: validating?"not-allowed":"pointer", opacity: validating?0.7:1, marginBottom:12 }}
        >
          {validating ? "VALIDATING..." : "✓ MARK AS USED — GRANT ENTRY"}
        </button>
      )}

      {/* Result after organizer validates */}
      {result && (
        <div style={{ background: result.ok?"rgba(61,220,132,0.1)":"rgba(232,64,64,0.1)", border:`1px solid ${result.ok?"var(--green)":"var(--red)"}`, borderRadius:12, padding:20, textAlign:"center", animation:"fadeUp 0.3s ease", marginBottom:12 }}>
          <div style={{ fontFamily:"Bebas Neue", fontSize:28, color: result.ok?"var(--green)":"var(--red)" }}>
            {result.ok ? "✅ ENTRY GRANTED" : "❌ " + result.msg}
          </div>
        </div>
      )}

      {/* Organizer: already used notice */}
      {isOrganizer && alreadyUsed && (
        <div style={{ background:"rgba(232,64,64,0.1)", border:"1px solid var(--red)", borderRadius:12, padding:20, textAlign:"center", marginBottom:12 }}>
          <div style={{ fontFamily:"Bebas Neue", fontSize:24, color:"var(--red)" }}>⛔ DO NOT ALLOW ENTRY</div>
          <div style={{ color:"var(--muted)", fontSize:13, marginTop:4 }}>This ticket was already used for entry</div>
        </div>
      )}

      {/* Non-organizer: sign-in prompt */}
      {!currentUser && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:20, textAlign:"center", marginTop:8 }}>
          <p style={{ color:"var(--muted)", fontSize:13, marginBottom:12 }}>Are you an event organizer?</p>
          <Link to={`/login`} style={{ background:"var(--gold)", color:"#000", padding:"10px 24px", borderRadius:8, fontWeight:700, fontSize:14 }}>Sign in to validate</Link>
        </div>
      )}

      {/* Customer: not their ticket notice */}
      {currentUser?.role === "customer" && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:20, textAlign:"center", marginTop:8 }}>
          <p style={{ color:"var(--muted)", fontSize:13 }}>Present this page at the event entrance for scanning.</p>
        </div>
      )}
    </div>
  );
}

// ── Home Page ──────────────────────────────────────────────────────────────
function HomePage({ ctx }) {
  const { events, eventsLoading } = ctx;
  const [filter, setFilter] = useState("All");
  const cats = ["All", "Concert", "Festival", "Sports"];
  const filtered = filter === "All" ? events : events.filter(e => e.category === filter);

  if (eventsLoading) return <Spinner />;

  return (
    <div style={{ maxWidth:1200, margin:"0 auto", padding:"48px 24px" }}>
      <div style={{ textAlign:"center", marginBottom:64, animation:"fadeUp 0.6s ease" }}>
        <div style={{ fontSize:13, letterSpacing:4, color:"var(--gold)", textTransform:"uppercase", marginBottom:16, fontWeight:500 }}>Nigeria's Premier Ticketing Platform</div>
        <h1 style={{ fontSize:"clamp(56px,10vw,120px)", lineHeight:0.9, marginBottom:24 }}>
          YOUR NEXT<br />
          <span style={{ color:"var(--gold)", WebkitTextStroke:"2px var(--gold)", WebkitTextFillColor:"transparent" }}>EXPERIENCE</span>
          <br />AWAITS
        </h1>
        <p style={{ color:"var(--muted)", maxWidth:480, margin:"0 auto", lineHeight:1.7 }}>
          Discover concerts, festivals, and sporting events. Secure tickets with instant QR delivery.
        </p>
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:40, flexWrap:"wrap" }}>
        {cats.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{ background: filter===c?"var(--gold)":"var(--bg3)", color: filter===c?"#000":"var(--muted)", border:`1px solid ${filter===c?"var(--gold)":"var(--border)"}`, padding:"8px 20px", borderRadius:100, cursor:"pointer", fontWeight:600, fontSize:13, transition:"all 0.2s" }}>{c}</button>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))", gap:24 }}>
        {filtered.map((event, i) => <EventCard key={event.id} event={event} index={i} />)}
      </div>
    </div>
  );
}

function EventCard({ event, index }) {
  const minPrice = Math.min(...event.tiers.map(t => t.price));
  const totalSold = event.tiers.reduce((s,t) => s+t.sold, 0);
  const totalCap = event.tiers.reduce((s,t) => s+t.total, 0);
  const pct = Math.round((totalSold/totalCap)*100);
  return (
    <Link to={`/event/${event.id}`} style={{ display:"block", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden", transition:"transform 0.3s, border-color 0.3s", animation:`fadeUp 0.5s ${index*0.1}s ease both` }}
      onMouseEnter={e => { e.currentTarget.style.transform="translateY(-4px)"; e.currentTarget.style.borderColor="var(--gold-dim)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform=""; e.currentTarget.style.borderColor="var(--border)"; }}
    >
      <div style={{ height:200, overflow:"hidden", position:"relative" }}>
        <img src={event.image} alt={event.title} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        <div style={{ position:"absolute", top:12, left:12, background:"var(--gold)", color:"#000", fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:100 }}>{event.category?.toUpperCase()}</div>
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(8,8,8,0.8) 0%, transparent 60%)" }} />
      </div>
      <div style={{ padding:"20px 24px 24px" }}>
        <h3 style={{ fontFamily:"Bebas Neue", fontSize:28, lineHeight:1, marginBottom:4 }}>{event.title}</h3>
        <p style={{ color:"var(--muted)", fontSize:13, marginBottom:16 }}>{event.subtitle}</p>
        <div style={{ fontSize:13, marginBottom:4 }}>📅 {fmtDate(event.date)} · {event.time}</div>
        <div style={{ fontSize:13, color:"var(--muted)", marginBottom:16 }}>📍 {event.venue}</div>
        <div style={{ marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--muted)", marginBottom:6 }}>
            <span>{totalSold} sold</span><span>{pct}% full</span>
          </div>
          <div style={{ height:3, background:"var(--border)", borderRadius:2 }}>
            <div style={{ height:"100%", width:`${pct}%`, background: pct>80?"var(--red)":"var(--gold)", borderRadius:2 }} />
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <span style={{ fontSize:11, color:"var(--muted)" }}>FROM </span>
            <span style={{ fontFamily:"Bebas Neue", fontSize:24, color:"var(--gold)" }}>{fmt(minPrice)}</span>
          </div>
          <span style={{ background:"var(--gold)", color:"#000", padding:"8px 18px", borderRadius:8, fontWeight:700, fontSize:13 }}>Get Tickets →</span>
        </div>
      </div>
    </Link>
  );
}

// ── Auth Page ──────────────────────────────────────────────────────────────
function AuthPage({ mode, ctx }) {
  const { login, register, currentUser } = ctx;
  const navigate = useNavigate();
  const [form, setForm] = useState({ name:"", email:"", password:"", role:"customer" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  if (currentUser) return <Navigate to="/" />;
  const F = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    setError(""); setLoading(true);
    if (mode === "login") {
      const res = await login(form.email, form.password);
      if (!res.ok) { setError("Invalid email or password."); setLoading(false); return; }
      navigate(res.role === "organizer" ? "/dashboard" : "/");
    } else {
      if (!form.name || !form.email || !form.password) { setError("All fields required."); setLoading(false); return; }
      const res = await register(form.name, form.email, form.password, form.role);
      if (!res.ok) { setError("Email already in use or invalid."); setLoading(false); return; }
      navigate(res.role === "organizer" ? "/dashboard" : "/");
    }
    setLoading(false);
  };

  const handleReset = async () => {
    if (!resetEmail) { setResetMsg("Please enter your email address."); return; }
    setResetLoading(true); setResetMsg("");
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setResetMsg("✅ Reset email sent! Check your inbox.");
    } catch {
      setResetMsg("❌ Could not send reset email. Check the address and try again.");
    }
    setResetLoading(false);
  };

  // ── Reset password modal ──────────────────────────────────────────────
  if (showReset) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"calc(100vh - 60px)", padding:24 }}>
      <div style={{ width:"100%", maxWidth:420, animation:"fadeUp 0.4s ease" }}>
        <div style={{ textAlign:"center", marginBottom:40 }}>
          <h1 style={{ fontSize:48, marginBottom:8 }}>RESET PASSWORD</h1>
          <p style={{ color:"var(--muted)", fontSize:14 }}>We'll send a reset link to your email</p>
        </div>
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:32, display:"flex", flexDirection:"column", gap:16 }}>
          <Input label="Email Address" type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="you@email.com" />
          {resetMsg && (
            <div style={{ fontSize:13, textAlign:"center", color: resetMsg.startsWith("✅") ? "var(--green)" : "var(--red)", padding:"10px 14px", background: resetMsg.startsWith("✅") ? "rgba(61,220,132,0.08)" : "rgba(232,64,64,0.08)", borderRadius:8 }}>
              {resetMsg}
            </div>
          )}
          <button onClick={handleReset} disabled={resetLoading} style={{ background:"var(--gold)", color:"#000", border:"none", padding:14, borderRadius:10, cursor: resetLoading?"not-allowed":"pointer", opacity: resetLoading?0.7:1, fontWeight:700, fontSize:16, fontFamily:"Bebas Neue", letterSpacing:2 }}>
            {resetLoading ? "SENDING..." : "SEND RESET LINK"}
          </button>
          <button onClick={() => { setShowReset(false); setResetMsg(""); setResetEmail(""); }} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:13, textAlign:"center" }}>
            ← Back to sign in
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"calc(100vh - 60px)", padding:24 }}>
      <div style={{ width:"100%", maxWidth:420, animation:"fadeUp 0.4s ease" }}>
        <div style={{ textAlign:"center", marginBottom:40 }}>
          <h1 style={{ fontSize:48, marginBottom:8 }}>{mode==="login"?"WELCOME BACK":"JOIN STAGEPRO"}</h1>
          <p style={{ color:"var(--muted)", fontSize:14 }}>{mode==="login"?"Sign in to your account":"Create your account"}</p>
        </div>
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:32, display:"flex", flexDirection:"column", gap:16 }}>
          {mode==="register" && <Input label="Full Name" value={form.name} onChange={F("name")} placeholder="Amara Okafor" />}
          <Input label="Email" type="email" value={form.email} onChange={F("email")} placeholder="you@email.com" />
          <Input label="Password" type="password" value={form.password} onChange={F("password")} placeholder="••••••••" />
          {mode==="register" && (
            <div>
              <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>ACCOUNT TYPE</label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {["customer","organizer"].map(r => (
                  <button key={r} onClick={() => setForm(p=>({...p,role:r}))} style={{ background: form.role===r?"rgba(245,166,35,0.15)":"var(--bg3)", border:`1px solid ${form.role===r?"var(--gold)":"var(--border)"}`, color: form.role===r?"var(--gold)":"var(--muted)", padding:12, borderRadius:8, cursor:"pointer", fontWeight:600, fontSize:13 }}>
                    {r==="customer"?"🎟 Attendee":"🎪 Organizer"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <div style={{ color:"var(--red)", fontSize:13, textAlign:"center" }}>{error}</div>}
          <button onClick={submit} disabled={loading} style={{ background:"var(--gold)", color:"#000", border:"none", padding:14, borderRadius:10, cursor: loading?"not-allowed":"pointer", opacity: loading?0.7:1, fontWeight:700, fontSize:16, fontFamily:"Bebas Neue", letterSpacing:2, marginTop:8 }}>
            {loading?"PLEASE WAIT...":mode==="login"?"SIGN IN":"CREATE ACCOUNT"}
          </button>
          {mode === "login" && (
            <button onClick={() => setShowReset(true)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:13, textAlign:"center" }}>
              Forgot your password?
            </button>
          )}
          <p style={{ textAlign:"center", fontSize:13, color:"var(--muted)" }}>
            {mode==="login"?"No account? ":"Already registered? "}
            <Link to={mode==="login"?"/register":"/login"} style={{ color:"var(--gold)", fontWeight:600 }}>
              {mode==="login"?"Sign up":"Sign in"}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Event Page ──────────────────────────────────────────────────────────────
function EventPage({ ctx }) {
  const { eventId } = useParams();
  const { events, currentUser } = ctx;
  const navigate = useNavigate();
  const [cart, setCart] = useState({});
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const local = events.find(e => e.id === eventId);
    if (local) { setEvent(local); setLoading(false); return; }
    const fetchEvent = async () => {
      const snap = await getDoc(doc(db, "events", eventId));
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      setLoading(false);
    };
    fetchEvent();
  }, [eventId, events]);

  if (loading) return <Spinner />;
  if (!event) return <div style={{ textAlign:"center", padding:80, color:"var(--muted)" }}>Event not found.</div>;

  const totalItems = Object.values(cart).reduce((s,q) => s+q, 0);
  const totalPrice = event.tiers.reduce((s,t) => s+(cart[t.id]||0)*t.price, 0);

  const adjust = (tierId, delta) => {
    setCart(prev => {
      const tier = event.tiers.find(t => t.id===tierId);
      const qty = Math.min(Math.max(0,(prev[tierId]||0)+delta), tier.total-tier.sold);
      return { ...prev, [tierId]: qty };
    });
  };

  const handleCheckout = () => {
    if (!currentUser) { navigate("/login"); return; }
    sessionStorage.setItem("cart", JSON.stringify(cart));
    navigate(`/event/${eventId}/checkout`);
  };

  return (
    <div style={{ maxWidth:1100, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
        <button onClick={() => navigate(-1)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:14 }}>← Back</button>
        <button onClick={() => { navigator.clipboard.writeText(window.location.href); }} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", gap:6 }}>🔗 Copy Link</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 380px", gap:40, alignItems:"start" }}>
        <div>
          <div style={{ borderRadius:16, overflow:"hidden", marginBottom:32, position:"relative" }}>
            <img src={event.image} alt={event.title} style={{ width:"100%", height:360, objectFit:"cover" }} />
            <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(8,8,8,0.9) 0%, transparent 50%)" }} />
            <div style={{ position:"absolute", bottom:32, left:32 }}>
              <div style={{ fontSize:11, letterSpacing:3, color:"var(--gold)", marginBottom:8 }}>{event.category?.toUpperCase()}</div>
              <h1 style={{ fontSize:56, lineHeight:1, marginBottom:4 }}>{event.title}</h1>
              <p style={{ color:"rgba(232,224,208,0.7)", fontSize:18 }}>{event.subtitle}</p>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:32 }}>
            {[["📅 Date",fmtDate(event.date)],["🕐 Time",event.time],["📍 Venue",event.venue],["🎫 Category",event.category]].map(([l,v]) => (
              <div key={l} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:20 }}>
                <div style={{ fontSize:12, color:"var(--muted)", marginBottom:4 }}>{l}</div>
                <div style={{ fontWeight:600 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:24 }}>
            <h3 style={{ fontSize:20, marginBottom:12 }}>ABOUT THIS EVENT</h3>
            <p style={{ color:"rgba(232,224,208,0.7)", lineHeight:1.8 }}>{event.description}</p>
          </div>
        </div>
        <div style={{ position:"sticky", top:80 }}>
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28 }}>
            <h3 style={{ fontSize:22, marginBottom:24 }}>SELECT TICKETS</h3>
            <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:24 }}>
              {event.tiers.map(tier => {
                const available = tier.total-tier.sold;
                const qty = cart[tier.id]||0;
                return (
                  <div key={tier.id} style={{ background:"var(--bg3)", border:`1px solid ${qty>0?"var(--gold)":"var(--border)"}`, borderRadius:12, padding:16, transition:"border-color 0.2s" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <div>
                        <div style={{ fontWeight:600, marginBottom:2 }}>{tier.name}</div>
                        <div style={{ fontFamily:"Bebas Neue", fontSize:22, color:"var(--gold)" }}>{fmt(tier.price)}</div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                        <button onClick={() => adjust(tier.id,-1)} disabled={qty===0} style={{ width:32, height:32, borderRadius:"50%", border:"1px solid var(--border)", background:"var(--bg2)", color:"var(--text)", cursor:"pointer", fontSize:18 }}>−</button>
                        <span style={{ fontFamily:"DM Mono", fontSize:18, minWidth:20, textAlign:"center" }}>{qty}</span>
                        <button onClick={() => adjust(tier.id,1)} disabled={available===0} style={{ width:32, height:32, borderRadius:"50%", border:"1px solid var(--border)", background: qty>0?"var(--gold)":"var(--bg2)", color: qty>0?"#000":"var(--text)", cursor:"pointer", fontSize:18 }}>+</button>
                      </div>
                    </div>
                    <div style={{ fontSize:12, color: available<20?"var(--red)":"var(--muted)" }}>{available===0?"SOLD OUT":`${available} remaining`}</div>
                  </div>
                );
              })}
            </div>
            {totalItems>0 && (
              <div style={{ borderTop:"1px solid var(--border)", paddingTop:20, marginBottom:20 }}>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ color:"var(--muted)" }}>{totalItems} ticket(s)</span>
                  <span style={{ fontFamily:"Bebas Neue", fontSize:22, color:"var(--gold)" }}>{fmt(totalPrice)}</span>
                </div>
              </div>
            )}
            <button disabled={totalItems===0} onClick={handleCheckout} style={{ width:"100%", padding:15, background: totalItems>0?"var(--gold)":"var(--bg3)", color: totalItems>0?"#000":"var(--muted)", border:"none", borderRadius:10, cursor: totalItems>0?"pointer":"not-allowed", fontFamily:"Bebas Neue", fontSize:20, letterSpacing:2 }}>
              {!currentUser?"SIGN IN TO BUY":totalItems===0?"SELECT TICKETS":"PROCEED TO CHECKOUT →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Checkout Page ──────────────────────────────────────────────────────────
function CheckoutPage({ ctx }) {
  const { eventId } = useParams();
  const { events, currentUser, purchaseTickets } = ctx;
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [processing, setProcessing] = useState(false);

  const cart = JSON.parse(sessionStorage.getItem("cart") || "{}");
  const event = events.find(e => e.id === eventId);

  if (!currentUser) return <Navigate to="/login" />;
  if (!event || Object.keys(cart).length === 0) return <Navigate to={`/event/${eventId}`} />;

  const selections = event.tiers.filter(t => (cart[t.id]||0) > 0);
  const total = selections.reduce((s,t) => s+cart[t.id]*t.price, 0);

  const handleConfirm = async () => {
    setProcessing(true);
    const ok = await purchaseTickets(eventId, cart);
    if (ok) { sessionStorage.removeItem("cart"); navigate("/tickets"); }
    setProcessing(false);
  };

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <button onClick={() => navigate(-1)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", marginBottom:24, fontSize:14 }}>← Back</button>
      <h1 style={{ fontSize:48, marginBottom:32 }}>CHECKOUT</h1>
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, marginBottom:20 }}>
        <div style={{ fontSize:12, color:"var(--muted)", letterSpacing:2, marginBottom:16 }}>ORDER SUMMARY</div>
        <div style={{ fontFamily:"Bebas Neue", fontSize:24, marginBottom:4 }}>{event.title}</div>
        <div style={{ color:"var(--muted)", fontSize:13, marginBottom:24 }}>{fmtDate(event.date)} · {event.venue}</div>
        {selections.map(t => (
          <div key={t.id} style={{ display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid var(--border)" }}>
            <div><span style={{ fontWeight:600 }}>{t.name}</span><span style={{ color:"var(--muted)", fontSize:13 }}> × {cart[t.id]}</span></div>
            <span style={{ fontFamily:"DM Mono" }}>{fmt(t.price*cart[t.id])}</span>
          </div>
        ))}
        <div style={{ display:"flex", justifyContent:"space-between", paddingTop:16 }}>
          <span style={{ fontWeight:600 }}>Total</span>
          <span style={{ fontFamily:"Bebas Neue", fontSize:28, color:"var(--gold)" }}>{fmt(total)}</span>
        </div>
      </div>
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, marginBottom:20 }}>
        <div style={{ fontSize:12, color:"var(--muted)", letterSpacing:2, marginBottom:16 }}>ATTENDEE</div>
        <div style={{ fontWeight:600 }}>{currentUser.name}</div>
        <div style={{ color:"var(--muted)", fontSize:13 }}>{currentUser.email}</div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24, cursor:"pointer" }} onClick={() => setAgreed(p=>!p)}>
        <div style={{ width:20, height:20, border:`2px solid ${agreed?"var(--gold)":"var(--border)"}`, borderRadius:4, background: agreed?"var(--gold)":"transparent", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s", flexShrink:0 }}>
          {agreed && <span style={{ color:"#000", fontSize:12, fontWeight:900 }}>✓</span>}
        </div>
        <span style={{ fontSize:13, color:"var(--muted)" }}>I agree to the terms and conditions. All sales are final.</span>
      </div>
      <button disabled={!agreed||processing} onClick={handleConfirm} style={{ width:"100%", padding:16, background: agreed?"var(--gold)":"var(--bg3)", color: agreed?"#000":"var(--muted)", border:"none", borderRadius:12, fontFamily:"Bebas Neue", fontSize:22, letterSpacing:2, cursor: agreed?"pointer":"not-allowed", opacity: processing?0.7:1 }}>
        {processing?"PROCESSING...":`CONFIRM PURCHASE · ${fmt(total)}`}
      </button>
    </div>
  );
}

// ── My Tickets Page ────────────────────────────────────────────────────────
function MyTicketsPage({ ctx }) {
  const { tickets } = ctx;
  const [selected, setSelected] = useState(null);

  if (tickets.length===0) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"60vh", gap:16, color:"var(--muted)" }}>
      <div style={{ fontSize:64 }}>🎟</div>
      <h2 style={{ fontFamily:"Bebas Neue", fontSize:36, color:"var(--text)" }}>NO TICKETS YET</h2>
      <p>Purchase tickets to events to see them here</p>
      <Link to="/" style={{ background:"var(--gold)", color:"#000", padding:"10px 24px", borderRadius:8, fontWeight:700 }}>Browse Events</Link>
    </div>
  );

  return (
    <div style={{ maxWidth:900, margin:"0 auto", padding:"40px 24px" }}>
      <h1 style={{ fontSize:48, marginBottom:8 }}>MY TICKETS</h1>
      <p style={{ color:"var(--muted)", fontSize:13, marginBottom:32 }}>Click a ticket to reveal its QR code. Scan at the entrance for entry.</p>
      <div style={{ display:"grid", gap:16 }}>
        {tickets.map(ticket => (
          <div key={ticket.id} onClick={() => setSelected(selected?.id===ticket.id?null:ticket)} style={{ background:"var(--bg2)", border:`1px solid ${ticket.used?"var(--border)":"var(--gold-dim)"}`, borderRadius:16, padding:24, cursor:"pointer", opacity: ticket.used?0.6:1, transition:"all 0.2s" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"start", flexWrap:"wrap", gap:16 }}>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <h3 style={{ fontFamily:"Bebas Neue", fontSize:28 }}>{ticket.eventTitle}</h3>
                  {ticket.used && <span style={{ background:"var(--border)", color:"var(--muted)", fontSize:11, padding:"2px 8px", borderRadius:100, fontWeight:700 }}>USED</span>}
                </div>
                <div style={{ color:"var(--muted)", fontSize:13, marginBottom:4 }}>{fmtDate(ticket.eventDate)} · {ticket.eventTime}</div>
                <div style={{ color:"var(--muted)", fontSize:13, marginBottom:12 }}>{ticket.venue}</div>
                <div style={{ display:"inline-block", background:"rgba(245,166,35,0.15)", border:"1px solid var(--gold-dim)", color:"var(--gold)", padding:"4px 12px", borderRadius:100, fontSize:12, fontWeight:600 }}>{ticket.tierName}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"Bebas Neue", fontSize:28, color:"var(--gold)" }}>{fmt(ticket.price)}</div>
                <div style={{ fontFamily:"DM Mono", fontSize:11, color:"var(--muted)", marginTop:4, wordBreak:"break-all", maxWidth:180 }}>{ticket.id}</div>
              </div>
            </div>
            {selected?.id===ticket.id && (
              <div style={{ marginTop:24, paddingTop:24, borderTop:"1px solid var(--border)", display:"flex", flexDirection:"column", alignItems:"center", gap:16, animation:"fadeUp 0.3s ease" }}>
                <div style={{ padding:16, background:"var(--bg3)", borderRadius:12, display:"inline-block" }}>
                  <QRCode ticketId={ticket.id} size={200} />
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:"DM Mono", fontSize:12, color:"var(--gold)", wordBreak:"break-all", marginBottom:4 }}>{ticket.id}</div>
                  <div style={{ fontSize:12, color:"var(--muted)" }}>Scan QR code at entrance — or share your ticket link:</div>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${window.location.origin}/ticket/${ticket.id}`); }}
                    style={{ marginTop:8, background:"var(--bg2)", border:"1px solid var(--border)", color:"var(--text)", padding:"6px 14px", borderRadius:6, cursor:"pointer", fontSize:12 }}
                  >🔗 Copy ticket link</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard Page ─────────────────────────────────────────────────────────
function DashboardPage({ ctx }) {
  const { events, tickets, currentUser } = ctx;
  const myEvents = events.filter(e => e.organizer===currentUser.uid || e.organizer==="seed");
  const revenue = tickets.reduce((s,t) => s+t.price, 0);
  const totalSold = myEvents.reduce((s,e) => s+e.tiers.reduce((ss,t) => ss+t.sold,0), 0);
  const totalCap = myEvents.reduce((s,e) => s+e.tiers.reduce((ss,t) => ss+t.total,0), 0);

  return (
    <div style={{ maxWidth:1200, margin:"0 auto", padding:"40px 24px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:40 }}>
        <h1 style={{ fontSize:48 }}>DASHBOARD</h1>
        <Link to="/dashboard/create" style={{ background:"var(--gold)", color:"#000", padding:"12px 24px", borderRadius:10, fontWeight:700, fontSize:14 }}>+ Create Event</Link>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:16, marginBottom:40 }}>
        {[
          { label:"Total Revenue", value:fmt(revenue), icon:"💰" },
          { label:"Tickets Sold", value:totalSold.toLocaleString(), icon:"🎟" },
          { label:"Total Events", value:myEvents.length, icon:"🎪" },
          { label:"Avg. Fill Rate", value: totalCap?`${Math.round((totalSold/totalCap)*100)}%`:"0%", icon:"📊" },
        ].map(s => (
          <div key={s.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:24 }}>
            <div style={{ fontSize:28, marginBottom:8 }}>{s.icon}</div>
            <div style={{ fontFamily:"Bebas Neue", fontSize:32, color:"var(--gold)" }}>{s.value}</div>
            <div style={{ fontSize:12, color:"var(--muted)", marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden" }}>
        <div style={{ padding:"20px 24px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h3 style={{ fontSize:22 }}>YOUR EVENTS</h3>
          <span style={{ fontSize:12, color:"var(--muted)" }}>⬇ CSV downloads buyer list</span>
        </div>
        {myEvents.length===0 ? (
          <div style={{ padding:40, textAlign:"center", color:"var(--muted)" }}>No events yet. <Link to="/dashboard/create" style={{ color:"var(--gold)" }}>Create your first one!</Link></div>
        ) : myEvents.map((event, i) => {
          const sold = event.tiers.reduce((s,t) => s+t.sold, 0);
          const cap = event.tiers.reduce((s,t) => s+t.total, 0);
          const rev = event.tiers.reduce((s,t) => s+t.sold*t.price, 0);
          const pct = Math.round((sold/cap)*100);
          const eventTicketCount = tickets.filter(t => t.eventId === event.id).length;
          return (
            <div key={event.id} style={{ display:"flex", alignItems:"center", gap:20, padding:"20px 24px", borderBottom: i<myEvents.length-1?"1px solid var(--border)":"none", flexWrap:"wrap" }}>
              <img src={event.image} style={{ width:60, height:60, objectFit:"cover", borderRadius:8, flexShrink:0 }} alt="" />
              <div style={{ flex:1, minWidth:200 }}>
                <div style={{ fontWeight:600, marginBottom:2 }}>{event.title}</div>
                <div style={{ fontSize:13, color:"var(--muted)" }}>{fmtDate(event.date)}</div>
              </div>
              <div style={{ minWidth:120 }}>
                <div style={{ height:4, background:"var(--border)", borderRadius:2, marginBottom:4 }}>
                  <div style={{ height:"100%", width:`${pct}%`, background: pct>80?"var(--red)":"var(--gold)", borderRadius:2 }} />
                </div>
                <div style={{ fontSize:13, fontFamily:"DM Mono" }}>{sold}/{cap}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"Bebas Neue", fontSize:22, color:"var(--gold)" }}>{fmt(rev)}</div>
                <div style={{ fontSize:12, color:"var(--muted)" }}>revenue</div>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <Link to={`/event/${event.id}`} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"8px 14px", borderRadius:8, fontSize:13 }}>View</Link>
                <Link to="/validate" style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"8px 14px", borderRadius:8, fontSize:13 }}>Scan ▶</Link>
                <button onClick={() => downloadCSV(event, tickets)} style={{ background:"var(--gold)", border:"none", color:"#000", padding:"8px 14px", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                  ⬇ CSV {eventTicketCount > 0 && <span style={{ background:"rgba(0,0,0,0.2)", borderRadius:100, padding:"1px 6px", fontSize:11 }}>{eventTicketCount}</span>}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Create Event Page ──────────────────────────────────────────────────────
function CreateEventPage({ ctx }) {
  const { createEvent } = ctx;
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title:"", subtitle:"", date:"", time:"", venue:"", category:"Concert", description:"", tiers:[{ name:"General", price:"", total:"" }] });
  const F = (k) => (e) => setForm(p=>({...p,[k]:e.target.value}));
  const updateTier = (i,k,v) => setForm(p=>({...p,tiers:p.tiers.map((t,j)=>j===i?{...t,[k]:v}:t)}));
  const addTier = () => setForm(p=>({...p,tiers:[...p.tiers,{name:"",price:"",total:""}]}));
  const removeTier = (i) => setForm(p=>({...p,tiers:p.tiers.filter((_,j)=>j!==i)}));
  const valid = form.title && form.date && form.venue && form.tiers.every(t=>t.name&&t.price&&t.total);

  const handle = async () => {
    setSaving(true);
    const ev = await createEvent(form);
    if (ev) navigate(`/event/${ev.id}`);
    setSaving(false);
  };

  return (
    <div style={{ maxWidth:700, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <button onClick={() => navigate("/dashboard")} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", marginBottom:24, fontSize:14 }}>← Dashboard</button>
      <h1 style={{ fontSize:48, marginBottom:32 }}>CREATE EVENT</h1>
      <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <Input label="Event Title" value={form.title} onChange={F("title")} placeholder="e.g. Neon Festival 2025" />
          <Input label="Subtitle / Artist" value={form.subtitle} onChange={F("subtitle")} placeholder="e.g. ft. Burna Boy" />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
          <Input label="Date" type="date" value={form.date} onChange={F("date")} />
          <Input label="Time" type="time" value={form.time} onChange={F("time")} />
          <div>
            <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>CATEGORY</label>
            <select value={form.category} onChange={F("category")} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14 }}>
              {["Concert","Festival","Sports","Comedy","Conference"].map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <Input label="Venue" value={form.venue} onChange={F("venue")} placeholder="e.g. Eko Convention Centre, Lagos" />
        <div>
          <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>DESCRIPTION</label>
          <textarea value={form.description} onChange={F("description")} rows={3} placeholder="Describe your event..." style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, resize:"vertical", fontFamily:"DM Sans" }} />
        </div>
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1 }}>TICKET TIERS</label>
            <button onClick={addTier} style={{ background:"none", border:"1px solid var(--gold-dim)", color:"var(--gold)", padding:"4px 12px", borderRadius:6, cursor:"pointer", fontSize:12 }}>+ Add Tier</button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {form.tiers.map((tier,i) => (
              <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:10, background:"var(--bg3)", padding:16, borderRadius:10, border:"1px solid var(--border)" }}>
                <Input label="Tier Name" value={tier.name} onChange={e=>updateTier(i,"name",e.target.value)} placeholder="e.g. VIP" />
                <Input label="Price (₦)" type="number" value={tier.price} onChange={e=>updateTier(i,"price",e.target.value)} placeholder="15000" />
                <Input label="Capacity" type="number" value={tier.total} onChange={e=>updateTier(i,"total",e.target.value)} placeholder="200" />
                <div style={{ display:"flex", alignItems:"flex-end" }}>
                  <button onClick={()=>removeTier(i)} disabled={form.tiers.length===1} style={{ width:38, height:38, background:"var(--bg2)", border:"1px solid var(--border)", color:"var(--red)", borderRadius:8, cursor:"pointer", fontSize:18 }}>×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <button onClick={handle} disabled={!valid||saving} style={{ width:"100%", padding:16, background: valid?"var(--gold)":"var(--bg3)", color: valid?"#000":"var(--muted)", border:"none", borderRadius:12, fontFamily:"Bebas Neue", fontSize:22, letterSpacing:2, cursor: valid?"pointer":"not-allowed", opacity: saving?0.7:1 }}>
          {saving?"SAVING TO FIREBASE...":"PUBLISH EVENT"}
        </button>
      </div>
    </div>
  );
}

// ── Validate Page (/validate) — html5-qrcode scanner + manual fallback ────
function ValidatePage({ ctx }) {
  const { validateTicket } = ctx;
  const [tab, setTab] = useState("camera");
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [camState, setCamState] = useState("idle"); // idle | loading | scanning | error
  const [camError, setCamError] = useState("");
  const scannerRef = useRef(null);
  const mountedRef = useRef(true);
  const SCANNER_ID = "html5qr-region";

  // Load html5-qrcode from CDN
  const loadLib = () => new Promise((resolve, reject) => {
    if (window.Html5Qrcode) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const startScanner = async () => {
    setCamState("loading"); setCamError(""); setResult(null);
    try {
      await loadLib();
      if (!mountedRef.current) return;

      // Stop any previous instance
      if (scannerRef.current) {
        try { await scannerRef.current.stop(); } catch {}
        scannerRef.current = null;
      }

      const scanner = new window.Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
        (decodedText) => {
          // QR detected — extract ticket ID from URL or use raw
          const match = decodedText.match(/\/ticket\/([a-zA-Z0-9]+)/);
          const ticketId = match ? match[1] : decodedText.trim();
          stopScanner();
          handleValidate(ticketId);
        },
        () => {} // ignore per-frame failures silently
      );

      if (mountedRef.current) setCamState("scanning");
    } catch (err) {
      const msg = String(err).includes("permission")
        ? "Camera permission denied. Please allow access and try again."
        : "Could not start camera. Try the manual entry tab.";
      setCamError(msg);
      setCamState("error");
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
    }
    if (mountedRef.current) setCamState("idle");
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (scannerRef.current) {
        try { scannerRef.current.stop(); } catch {}
      }
    };
  }, []);

  useEffect(() => {
    if (tab === "manual") stopScanner();
  }, [tab]);

  const handleValidate = async (id) => {
    if (!id) return;
    setChecking(true); setResult(null);
    const res = await validateTicket(id);
    if (mountedRef.current) { setResult(res); setChecking(false); }
  };

  const reset = () => {
    setResult(null); setInput("");
    if (tab === "camera") startScanner();
  };

  return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <h1 style={{ fontSize:48, marginBottom:8 }}>SCAN & VALIDATE</h1>
      <p style={{ color:"var(--muted)", marginBottom:24 }}>Use the camera to scan QR codes, or enter a ticket ID manually.</p>

      {/* Tab toggle */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:24 }}>
        {[["camera","📷 Camera Scan"],["manual","⌨️ Manual Entry"]].map(([t,label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:"10px 0", background: tab===t?"var(--gold)":"var(--bg3)", color: tab===t?"#000":"var(--muted)", border:`1px solid ${tab===t?"var(--gold)":"var(--border)"}`, borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:13 }}>{label}</button>
        ))}
      </div>

      {/* ── Camera tab ── */}
      {tab === "camera" && !result && !checking && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden", marginBottom:24 }}>

          {/* html5-qrcode mounts into this div — must always be in the DOM when camera tab is active */}
          <div
            id={SCANNER_ID}
            style={{
              width:"100%",
              display: camState === "scanning" ? "block" : "none",
              borderRadius:0,
            }}
          />

          {/* Idle state */}
          {camState === "idle" && (
            <div style={{ textAlign:"center", padding:48 }}>
              <div style={{ fontSize:52, marginBottom:16 }}>📷</div>
              <p style={{ color:"var(--muted)", fontSize:14, marginBottom:24 }}>Point your camera at an attendee's QR code</p>
              <button onClick={startScanner} style={{ background:"var(--gold)", color:"#000", border:"none", padding:"14px 32px", borderRadius:10, cursor:"pointer", fontFamily:"Bebas Neue", fontSize:20, letterSpacing:2 }}>
                START CAMERA
              </button>
            </div>
          )}

          {/* Loading state */}
          {camState === "loading" && (
            <div style={{ textAlign:"center", padding:48 }}>
              <div style={{ width:40, height:40, border:"3px solid var(--border)", borderTop:"3px solid var(--gold)", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 16px" }} />
              <p style={{ color:"var(--muted)", fontSize:14 }}>Starting camera...</p>
            </div>
          )}

          {/* Scanning status bar */}
          {camState === "scanning" && (
            <div style={{ padding:"12px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", borderTop:"1px solid var(--border)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, color:"var(--green)", fontSize:13, fontWeight:600 }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:"var(--green)", animation:"pulse 1s infinite" }} />
                SCANNING...
              </div>
              <button onClick={stopScanner} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:"5px 14px", borderRadius:6, cursor:"pointer", fontSize:13 }}>Stop</button>
            </div>
          )}

          {/* Error state */}
          {camState === "error" && (
            <div style={{ textAlign:"center", padding:36 }}>
              <div style={{ fontSize:40, marginBottom:12 }}>🚫</div>
              <p style={{ color:"var(--red)", fontSize:13, marginBottom:20 }}>{camError}</p>
              <button onClick={startScanner} style={{ background:"var(--gold)", color:"#000", border:"none", padding:"10px 24px", borderRadius:8, cursor:"pointer", fontWeight:700, marginRight:8 }}>Try Again</button>
              <button onClick={() => setTab("manual")} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:"10px 24px", borderRadius:8, cursor:"pointer", fontSize:13 }}>Use Manual</button>
            </div>
          )}
        </div>
      )}

      {/* Checking spinner */}
      {checking && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:40, textAlign:"center", marginBottom:24 }}>
          <div style={{ width:40, height:40, border:"3px solid var(--border)", borderTop:"3px solid var(--gold)", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 16px" }} />
          <p style={{ color:"var(--muted)", fontSize:14 }}>Checking ticket in Firebase...</p>
        </div>
      )}

      {/* ── Manual tab ── */}
      {tab === "manual" && !result && !checking && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:32, marginBottom:24 }}>
          <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:2, marginBottom:10, display:"block" }}>TICKET ID</label>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleValidate(input)} placeholder="e.g. aB3dEfGhIjKl..." style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"14px 16px", color:"var(--text)", fontSize:14, fontFamily:"DM Mono", marginBottom:16, outline:"none" }} />
          <button onClick={() => handleValidate(input)} disabled={!input} style={{ width:"100%", background: input?"var(--gold)":"var(--bg3)", color: input?"#000":"var(--muted)", border:"none", padding:14, borderRadius:10, cursor: input?"pointer":"not-allowed", fontFamily:"Bebas Neue", fontSize:20, letterSpacing:2 }}>
            VALIDATE TICKET
          </button>
        </div>
      )}

      {/* Result */}
      {result && !checking && (
        <div style={{ background: result.ok?"rgba(61,220,132,0.08)":"rgba(232,64,64,0.08)", border:`2px solid ${result.ok?"var(--green)":"var(--red)"}`, borderRadius:16, padding:28, animation:"fadeUp 0.3s ease", marginBottom:24 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <span style={{ fontSize:40 }}>{result.ok?"✅":"❌"}</span>
            <div>
              <div style={{ fontFamily:"Bebas Neue", fontSize:32, color: result.ok?"var(--green)":"var(--red)" }}>
                {result.ok ? "VALID — GRANT ENTRY" : "INVALID"}
              </div>
              <div style={{ color:"var(--muted)", fontSize:13 }}>{result.msg}</div>
            </div>
          </div>
          {result.ticket && (
            <div style={{ display:"grid", gap:10, background:"var(--bg3)", borderRadius:10, padding:16, marginBottom:20 }}>
              {[["Event",result.ticket.eventTitle],["Tier",result.ticket.tierName],["Attendee",result.ticket.userName],["Date",fmtDate(result.ticket.eventDate)]].map(([k,v]) => (
                <div key={k} style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
                  <span style={{ color:"var(--muted)" }}>{k}</span>
                  <span style={{ fontWeight:600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={reset} style={{ width:"100%", background:"var(--gold)", border:"none", color:"#000", padding:12, borderRadius:8, cursor:"pointer", fontFamily:"Bebas Neue", fontSize:18, letterSpacing:2 }}>
            {tab === "camera" ? "📷 SCAN NEXT TICKET" : "VALIDATE ANOTHER"}
          </button>
        </div>
      )}
    </div>
  );
}
