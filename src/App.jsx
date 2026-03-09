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
  deleteDoc,
  query,
  where,
} from "firebase/firestore";

// ── EmailJS setup (optional — for auto email tickets) ─────────────────────
// Add to .env and Vercel environment variables:
//   VITE_EMAILJS_SERVICE  = your EmailJS service ID
//   VITE_EMAILJS_TEMPLATE = your EmailJS template ID
//   VITE_EMAILJS_KEY      = your EmailJS public key
// Template variables to use: to_email, to_name, event_title, event_date,
//   venue, tier, ticket_id, ticket_url
// ──────────────────────────────────────────────────────────────────────────

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


// ── Email ticket via EmailJS ───────────────────────────────────────────────
// Setup: go to emailjs.com → create account → Email Templates → use template
// variables: to_email, to_name, event_title, event_date, venue, tier, ticket_id, ticket_url
const sendTicketEmail = async ({ toEmail, toName, ticket }) => {
  try {
    const EMAILJS_SERVICE  = import.meta.env.VITE_EMAILJS_SERVICE  || "";
    const EMAILJS_TEMPLATE = import.meta.env.VITE_EMAILJS_TEMPLATE || "";
    const EMAILJS_KEY      = import.meta.env.VITE_EMAILJS_KEY      || "";
    if (!EMAILJS_SERVICE || !EMAILJS_TEMPLATE || !EMAILJS_KEY) return; // not configured yet
    const ticketUrl = `${window.location.origin}/ticket/${ticket.id}`;
    await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id:  EMAILJS_SERVICE,
        template_id: EMAILJS_TEMPLATE,
        user_id:     EMAILJS_KEY,
        template_params: {
          to_email:    toEmail,
          to_name:     toName,
          event_title: ticket.eventTitle,
          event_date:  ticket.eventDate,
          venue:       ticket.venue,
          tier:        ticket.tierName,
          ticket_id:   ticket.id,
          ticket_url:  ticketUrl,
        },
      }),
    });
  } catch (err) {
    console.warn("Email send failed (non-critical):", err);
  }
};

// ── Seed events ────────────────────────────────────────────────────────────

// ── Global styles ──────────────────────────────────────────────────────────
const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --gold: #f5a623; --gold-dim: #c47d0e;
    --bg: #080808; --bg2: #111111; --bg3: #1a1a1a;
    --border: #2a2a2a; --text: #e8e0d0; --muted: #777;
    --red: #e84040; --green: #3ddc84;
    --nav-bg: rgba(8,8,8,0.92);
  }

  [data-theme="light"] {
    --gold: #d4880a; --gold-dim: #b56f08;
    --bg: #f5f3ef; --bg2: #ffffff; --bg3: #eeebe5;
    --border: #e0d9d0; --text: #1a1510; --muted: #8a8070;
    --red: #d93030; --green: #1e9e55;
    --nav-bg: rgba(245,243,239,0.92);
  }

  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --gold: #d4880a; --gold-dim: #b56f08;
      --bg: #f5f3ef; --bg2: #ffffff; --bg3: #eeebe5;
      --border: #e0d9d0; --text: #1a1510; --muted: #8a8070;
      --red: #d93030; --green: #1e9e55;
      --nav-bg: rgba(245,243,239,0.92);
    }
  }

  body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; transition: background 0.25s, color 0.25s; }
  h1, h2, h3 { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.04em; }
  a { color: inherit; text-decoration: none; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg2); }
  ::-webkit-scrollbar-thumb { background: var(--gold-dim); border-radius: 2px; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
  @media (max-width: 768px) {
    .footer-grid { grid-template-columns: 1fr 1fr !important; gap: 32px !important; }
    .footer-brand { grid-column: 1 / -1; }
    .event-layout { grid-template-columns: 1fr !important; gap: 20px !important; }
    .event-layout > div:last-child { position: static !important; }
  }
  @media (max-width: 480px) {
    .footer-grid { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 600px) {
    nav { padding: 0 16px !important; }
    nav a[href="/dashboard"], nav a[href="/validate"] { display: none; }
  }
`;

// ── Theme hook — pure auto-detect, follows OS preference ──────────────────
function useTheme() {
  const [theme, setTheme] = useState(
    () => window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e) => setTheme(e.matches ? "light" : "dark");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return { theme };
}

// ── Shared components ──────────────────────────────────────────────────────
// ── ShareButton — works on iOS Safari, Android, and desktop ─────────────────
function ShareButton({ url, label = "Copy Link", small, stopProp }) {
  const [state, setState] = useState("idle"); // idle | copied | modal

  const handle = (e) => {
    e.stopPropagation(); // always stop — button may be inside a clickable card
    // Native share sheet (Android Chrome, iOS Safari 12.1+)
    if (navigator.share) {
      navigator.share({ title: "StagePro Ticket", url })
        .catch(() => {}); // user cancelled — do nothing
      return;
    }
    // Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url)
        .then(() => { setState("copied"); setTimeout(() => setState("idle"), 2500); })
        .catch(() => setState("modal"));
      return;
    }
    // Fallback — show modal with the URL
    setState("modal");
  };

  return (
    <>
      <button
        onClick={handle}
        style={{ background:"var(--bg3)", border:"1px solid var(--border)", color: state==="copied" ? "var(--green)" : "var(--text)", padding: small ? "5px 12px" : "8px 14px", borderRadius:8, cursor:"pointer", fontSize: small ? 12 : 13, display:"flex", alignItems:"center", gap:6, transition:"color 0.2s", whiteSpace:"nowrap" }}
      >
        {state === "copied" ? "✅ Copied!" : `🔗 ${label}`}
      </button>

      {state === "modal" && (
        <div
          onClick={e => { e.stopPropagation(); setState("idle"); }}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, width:"100%", maxWidth:460, animation:"fadeUp 0.3s ease" }}
          >
            <h3 style={{ fontFamily:"Bebas Neue", fontSize:26, marginBottom:8 }}>SHARE LINK</h3>
            <p style={{ color:"var(--muted)", fontSize:13, marginBottom:16 }}>Tap the link to select it, then copy — or share directly to WhatsApp.</p>
            {/* URL input — tap to select all */}
            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              <input
                readOnly value={url}
                onFocus={e => e.target.select()}
                onClick={e => e.target.select()}
                style={{ flex:1, background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:12, fontFamily:"DM Mono", outline:"none", minWidth:0 }}
              />
              <button
                onClick={() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(url).then(() => setState("copied")).catch(() => {});
                  }
                }}
                style={{ background:"var(--gold)", border:"none", color:"#000", padding:"10px 16px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:13, whiteSpace:"nowrap", flexShrink:0 }}
              >Copy</button>
            </div>
            {/* WhatsApp */}
            <a
              href={`https://wa.me/?text=${encodeURIComponent(url)}`}
              target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, background:"#25D366", color:"#fff", padding:"13px 20px", borderRadius:10, fontWeight:700, fontSize:14, marginBottom:12, textDecoration:"none" }}
            >
              <span style={{ fontSize:20 }}>📱</span> Share on WhatsApp
            </a>
            <button onClick={e => { e.stopPropagation(); setState("idle"); }} style={{ width:"100%", background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:10, borderRadius:8, cursor:"pointer", fontSize:13 }}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}


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
      <nav style={{ position:"sticky", top:0, zIndex:100, background:"var(--nav-bg)", backdropFilter:"blur(12px)", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 32px", height:60 }}>
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
  const { theme } = useTheme();
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
      // Cleanup seed events separately — don't let failures block the fetch
      try {
        for (const id of ["evt-001", "evt-002", "evt-003"]) {
          const ref = doc(db, "events", id);
          const snap = await getDoc(ref);
          if (snap.exists()) await deleteDoc(ref);
        }
      } catch (err) { console.warn("Seed cleanup skipped:", err.message); }
      // Always fetch events regardless of cleanup result
      try {
        const snapshot = await getDocs(collection(db, "events"));
        setEvents(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) { console.error("Events fetch failed:", err); }
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
          sendTicketEmail({ toEmail: currentUser.email, toName: currentUser.name, ticket: newTicket });
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
          id: `t${i+1}`, name: t.name, price: Number(t.price), total: Number(t.total), sold: 0,
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

  const updateEvent = async (eventId, eventData) => {
    try {
      const data = {
        ...eventData,
        tiers: eventData.tiers.map((t, i) => ({
          id: t.id || `t${i+1}`, name: t.name, price: Number(t.price), total: Number(t.total), sold: t.sold||0,
        })),
      };
      await updateDoc(doc(db, "events", eventId), data);
      setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...data } : e));
      notify("Event updated!");
      return true;
    } catch (err) {
      console.error(err);
      notify("Failed to update event.", "error");
      return false;
    }
  };

  const deleteEvent = async (eventId) => {
    try {
      await deleteDoc(doc(db, "events", eventId));
      setEvents(prev => prev.filter(e => e.id !== eventId));
      notify("Event deleted.");
      return true;
    } catch (err) {
      console.error(err);
      notify("Failed to delete event.", "error");
      return false;
    }
  };

  const transferTicket = async (ticketId, toEmail) => {
    try {
      // find user by email
      const q = query(collection(db, "users"), where("email", "==", toEmail.trim().toLowerCase()));
      const snap = await getDocs(q);
      if (snap.empty) return { ok: false, msg: "No account found with that email." };
      const recipient = { id: snap.docs[0].id, ...snap.docs[0].data() };
      if (recipient.id === currentUser.uid) return { ok: false, msg: "You can't transfer to yourself." };
      await updateDoc(doc(db, "tickets", ticketId), { userId: recipient.id, userName: recipient.name });
      setTickets(prev => prev.filter(t => t.id !== ticketId));
      notify(`Ticket transferred to ${recipient.name}!`);
      return { ok: true };
    } catch (err) {
      console.error(err);
      return { ok: false, msg: "Transfer failed. Try again." };
    }
  };

  if (authLoading) return <><style>{STYLE}</style><Spinner /></>;

  const ctx = { currentUser, events, tickets, eventsLoading, notify, login, register, logout, purchaseTickets, validateTicket, createEvent, updateEvent, deleteEvent, transferTicket };

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
          <Route path="/dashboard/edit/:eventId" element={currentUser?.role === "organizer" ? <EditEventPage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/validate" element={currentUser?.role === "organizer" ? <ValidatePage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  );
}

// ── Footer ─────────────────────────────────────────────────────────────────
function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer style={{ background:"var(--bg2)", borderTop:"1px solid var(--border)", marginTop:80 }}>
      {/* Top section */}
      <div className="footer-grid" style={{ maxWidth:1200, margin:"0 auto", padding:"56px 32px 40px", display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr", gap:48 }}>

        {/* Brand column */}
        <div className="footer-brand">
          <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:16 }}>
            <span style={{ fontFamily:"Bebas Neue", fontSize:28, color:"var(--gold)", letterSpacing:2 }}>STAGE</span>
            <span style={{ fontFamily:"Bebas Neue", fontSize:28, color:"var(--text)", letterSpacing:2 }}>PRO</span>
          </div>
          <p style={{ color:"var(--muted)", fontSize:14, lineHeight:1.8, maxWidth:280, marginBottom:24 }}>
            Nigeria's premier event ticketing platform. Discover, book, and manage tickets for concerts, festivals, and sporting events.
          </p>
          {/* Social icons */}
          <div style={{ display:"flex", gap:10 }}>
            {[
              { label:"Twitter / X", icon:"𝕏", href:"#" },
              { label:"Instagram", icon:"📸", href:"#" },
              { label:"Facebook", icon:"f", href:"#" },
            ].map(s => (
              <a key={s.label} href={s.href} title={s.label} style={{ width:36, height:36, borderRadius:8, background:"var(--bg3)", border:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:700, color:"var(--muted)", transition:"all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor="var(--gold)"; e.currentTarget.style.color="var(--gold)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.color="var(--muted)"; }}
              >{s.icon}</a>
            ))}
          </div>
        </div>

        {/* Discover column */}
        <div>
          <div style={{ fontFamily:"Bebas Neue", fontSize:16, letterSpacing:2, color:"var(--text)", marginBottom:20 }}>DISCOVER</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {[["Browse Events","/"],["Concerts","/"],["Festivals","/"],["Sports","/"]].map(([label, href]) => (
              <Link key={label} to={href} style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
                onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
              >{label}</Link>
            ))}
          </div>
        </div>

        {/* Organizers column */}
        <div>
          <div style={{ fontFamily:"Bebas Neue", fontSize:16, letterSpacing:2, color:"var(--text)", marginBottom:20 }}>ORGANIZERS</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {[["Create Event","/dashboard/create"],["Dashboard","/dashboard"],["Scan Tickets","/validate"],["Sign Up","/register"]].map(([label, href]) => (
              <Link key={label} to={href} style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
                onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
              >{label}</Link>
            ))}
          </div>
        </div>

        {/* Support column */}
        <div>
          <div style={{ fontFamily:"Bebas Neue", fontSize:16, letterSpacing:2, color:"var(--text)", marginBottom:20 }}>SUPPORT</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {[["Help Centre","#"],["Contact Us","#"]].map(([label, href]) => (
              <a key={label} href={href} style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
                onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
              >{label}</a>
            ))}
            <Link to="/terms" style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >Terms of Service</Link>
            <Link to="/privacy" style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >Privacy Policy</Link>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop:"1px solid var(--border)" }} />

      {/* Bottom bar */}
      <div style={{ maxWidth:1200, margin:"0 auto", padding:"20px 32px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <p style={{ color:"var(--muted)", fontSize:13 }}>
          © {year} StagePro. All rights reserved. Made in Nigeria 🇳🇬
        </p>
        <div style={{ display:"flex", gap:20 }}>
          {[["Terms","/terms"],["Privacy","/privacy"]].map(([label, href]) => (
            <Link key={label} to={href} style={{ color:"var(--muted)", fontSize:13, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >{label}</Link>
          ))}
          <a href="#" style={{ color:"var(--muted)", fontSize:13, transition:"color 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
            onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
          >Cookies</a>
        </div>
      </div>
    </footer>
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
  const [search, setSearch] = useState("");
  const cats = ["All", "Concert", "Festival", "Sports"];
  const filtered = events
    .filter(e => filter === "All" || e.category === filter)
    .filter(e => {
      const q = search.toLowerCase();
      return !q || e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q) || (e.subtitle||"").toLowerCase().includes(q);
    });

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
      {/* Search bar */}
      <div style={{ position:"relative", maxWidth:560, margin:"0 auto 32px" }}>
        <span style={{ position:"absolute", left:18, top:"50%", transform:"translateY(-50%)", fontSize:18, pointerEvents:"none" }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search events, artists, venues..."
          style={{ width:"100%", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:100, padding:"14px 20px 14px 48px", color:"var(--text)", fontSize:15, outline:"none", transition:"border 0.2s" }}
          onFocus={e => e.target.style.borderColor="var(--gold)"}
          onBlur={e => e.target.style.borderColor="var(--border)"}
        />
        {search && (
          <button onClick={() => setSearch("")} style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>
        )}
      </div>
      {/* Category filters */}
      <div style={{ display:"flex", gap:8, marginBottom:40, flexWrap:"wrap" }}>
        {cats.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{ background: filter===c?"var(--gold)":"var(--bg3)", color: filter===c?"#000":"var(--muted)", border:`1px solid ${filter===c?"var(--gold)":"var(--border)"}`, padding:"8px 20px", borderRadius:100, cursor:"pointer", fontWeight:600, fontSize:13, transition:"all 0.2s" }}>{c}</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div style={{ textAlign:"center", padding:"80px 24px", color:"var(--muted)" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>🔍</div>
          <div style={{ fontFamily:"Bebas Neue", fontSize:28, color:"var(--text)", marginBottom:8 }}>NO RESULTS FOUND</div>
          <p>Try a different search or browse all events</p>
          <button onClick={() => { setSearch(""); setFilter("All"); }} style={{ marginTop:16, background:"var(--gold)", color:"#000", border:"none", padding:"10px 24px", borderRadius:8, cursor:"pointer", fontWeight:700 }}>Clear Filters</button>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))", gap:24 }}>
          {filtered.map((event, i) => <EventCard key={event.id} event={event} index={i} />)}
        </div>
      )}
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

  // redirect logged-in users away (but only if not viewing reset screen)
  if (currentUser && !showReset) return <Navigate to="/" />;

  // ── Reset password screen ─────────────────────────────────────────────
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
            <button onClick={() => { setResetEmail(form.email); setShowReset(true); }} style={{ background:"none", border:"none", color:"var(--gold)", cursor:"pointer", fontSize:13, textAlign:"center", textDecoration:"underline" }}>
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
    <div style={{ maxWidth:1100, margin:"0 auto", padding:"24px 16px", animation:"fadeUp 0.4s ease" }}>
      {/* Top bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20, padding:"0 8px" }}>
        <button onClick={() => navigate(-1)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:14, padding:0 }}>← Back</button>
<ShareButton url={window.location.href} />
      </div>

      {/* Hero image */}
      <div style={{ borderRadius:16, overflow:"hidden", marginBottom:20, position:"relative" }}>
        <img src={event.image} alt={event.title} style={{ width:"100%", height:"min(360px, 55vw)", objectFit:"cover", display:"block" }} />
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(8,8,8,0.92) 0%, transparent 55%)" }} />
        <div style={{ position:"absolute", bottom:20, left:20, right:20 }}>
          <div style={{ fontSize:11, letterSpacing:3, color:"var(--gold)", marginBottom:6 }}>{event.category?.toUpperCase()}</div>
          <h1 style={{ fontSize:"clamp(28px,6vw,56px)", lineHeight:1, marginBottom:4 }}>{event.title}</h1>
          <p style={{ color:"rgba(232,224,208,0.75)", fontSize:"clamp(14px,2.5vw,18px)" }}>{event.subtitle}</p>
        </div>
      </div>

      {/* Responsive layout: side-by-side on desktop, stacked on mobile */}
      <div className="event-layout" style={{ display:"grid", gridTemplateColumns:"1fr 360px", gap:32, alignItems:"start" }}>

        {/* Left — info */}
        <div>
          {/* Info cards — 2-col on desktop, 2-col on mobile too but smaller */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:24 }}>
            {[["📅","Date",fmtDate(event.date)],["🕐","Time",event.time||"TBA"],["📍","Venue",event.venue],["🎫","Category",event.category]].map(([icon,l,v]) => (
              <div key={l} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"14px 16px" }}>
                <div style={{ fontSize:13, color:"var(--muted)", marginBottom:4 }}>{icon} {l}</div>
                <div style={{ fontWeight:600, fontSize:14, lineHeight:1.3 }}>{v}</div>
              </div>
            ))}
          </div>
          {event.description && (
            <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:20 }}>
              <h3 style={{ fontSize:18, marginBottom:10 }}>ABOUT THIS EVENT</h3>
              <p style={{ color:"var(--muted)", lineHeight:1.8, fontSize:14 }}>{event.description}</p>
            </div>
          )}
        </div>

        {/* Right — ticket selector */}
        <div style={{ position:"sticky", top:80 }}>
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:24 }}>
            <h3 style={{ fontSize:20, marginBottom:20 }}>SELECT TICKETS</h3>
            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:20 }}>
              {event.tiers.map(tier => {
                const available = tier.total-tier.sold;
                const qty = cart[tier.id]||0;
                return (
                  <div key={tier.id} style={{ background:"var(--bg3)", border:`1px solid ${qty>0?"var(--gold)":"var(--border)"}`, borderRadius:12, padding:"14px 16px", transition:"border-color 0.2s" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                      <div>
                        <div style={{ fontWeight:600, fontSize:14, marginBottom:2 }}>{tier.name}</div>
                        <div style={{ fontFamily:"Bebas Neue", fontSize:22, color:"var(--gold)" }}>{tier.price===0||tier.price==="0" ? "FREE" : (tier.price===0||tier.price==="0"?"FREE":fmt(tier.price))}</div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <button onClick={() => adjust(tier.id,-1)} disabled={qty===0} style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", background:"var(--bg2)", color:"var(--text)", cursor: qty===0?"not-allowed":"pointer", fontSize:20, opacity: qty===0?0.4:1 }}>−</button>
                        <span style={{ fontFamily:"DM Mono", fontSize:18, minWidth:22, textAlign:"center" }}>{qty}</span>
                        <button onClick={() => adjust(tier.id,1)} disabled={available===0} style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", background: qty>0?"var(--gold)":"var(--bg2)", color: qty>0?"#000":"var(--text)", cursor: available===0?"not-allowed":"pointer", fontSize:20, opacity: available===0?0.4:1 }}>+</button>
                      </div>
                    </div>
                    <div style={{ fontSize:12, color: available===0?"var(--red)":available<20?"var(--red)":"var(--muted)" }}>
                      {available===0?"SOLD OUT":`${available} remaining`}
                    </div>
                  </div>
                );
              })}
            </div>
            {totalItems>0 && (
              <div style={{ borderTop:"1px solid var(--border)", paddingTop:16, marginBottom:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ color:"var(--muted)", fontSize:14 }}>{totalItems} ticket{totalItems>1?"s":""}</span>
                  <span style={{ fontFamily:"Bebas Neue", fontSize:24, color:"var(--gold)" }}>{fmt(totalPrice)}</span>
                </div>
              </div>
            )}
            <button disabled={totalItems===0} onClick={handleCheckout} style={{ width:"100%", padding:16, background: totalItems>0?"var(--gold)":"var(--bg3)", color: totalItems>0?"#000":"var(--muted)", border:"none", borderRadius:10, cursor: totalItems>0?"pointer":"not-allowed", fontFamily:"Bebas Neue", fontSize:20, letterSpacing:2 }}>
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
function TransferModal({ ticket, onTransfer, onClose }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const handle = async () => {
    if (!email.trim()) return;
    setLoading(true); setMsg(null);
    const res = await onTransfer(ticket.id, email);
    if (res.ok) { onClose(); return; }
    setMsg(res.msg);
    setLoading(false);
  };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:32, width:"100%", maxWidth:440, animation:"fadeUp 0.3s ease" }}>
        <h2 style={{ fontFamily:"Bebas Neue", fontSize:28, marginBottom:4 }}>TRANSFER TICKET</h2>
        <p style={{ color:"var(--muted)", fontSize:13, marginBottom:24 }}>Enter the email address of the person you want to send <strong style={{ color:"var(--text)" }}>{ticket.eventTitle} — {ticket.tierName}</strong> to.</p>
        <Input label="Recipient Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="friend@email.com" />
        {msg && <div style={{ marginTop:12, color:"var(--red)", fontSize:13 }}>{msg}</div>}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:12, borderRadius:10, cursor:"pointer", fontWeight:600 }}>Cancel</button>
          <button onClick={handle} disabled={!email.trim()||loading} style={{ background: email.trim()?"var(--gold)":"var(--bg3)", color: email.trim()?"#000":"var(--muted)", border:"none", padding:12, borderRadius:10, cursor: email.trim()?"pointer":"not-allowed", fontFamily:"Bebas Neue", fontSize:18, letterSpacing:1 }}>
            {loading ? "SENDING..." : "TRANSFER"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MyTicketsPage({ ctx }) {
  const { tickets, transferTicket } = ctx;
  const [selected, setSelected] = useState(null);
  const [transfering, setTransfering] = useState(null); // ticket being transferred

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
      {transfering && <TransferModal ticket={transfering} onTransfer={transferTicket} onClose={() => setTransfering(null)} />}
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
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <div style={{ background:"rgba(245,166,35,0.15)", border:"1px solid var(--gold-dim)", color:"var(--gold)", padding:"4px 12px", borderRadius:100, fontSize:12, fontWeight:600 }}>{ticket.tierName}</div>
                  {!ticket.used && (
                    <button
                      onClick={e => { e.stopPropagation(); setTransfering(ticket); }}
                      style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--muted)", padding:"4px 12px", borderRadius:100, fontSize:12, cursor:"pointer", fontWeight:600 }}
                    >↗ Transfer</button>
                  )}
                </div>
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
                  <ShareButton url={`${window.location.origin}/ticket/${ticket.id}`} label="Copy ticket link" small />
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
  const { events, tickets, currentUser, deleteEvent } = ctx;
  const [confirmDelete, setConfirmDelete] = useState(null);
  const myEvents = events.filter(e => e.organizer === currentUser.uid);
  const revenue = tickets.reduce((s,t) => s+t.price, 0);
  const totalSold = myEvents.reduce((s,e) => s+e.tiers.reduce((ss,t) => ss+t.sold,0), 0);
  const totalCap = myEvents.reduce((s,e) => s+e.tiers.reduce((ss,t) => ss+t.total,0), 0);
  const totalCheckedIn = tickets.filter(t => t.used).length;

  const handleDelete = async (event) => {
    await deleteEvent(event.id);
    setConfirmDelete(null);
  };

  return (
    <div style={{ maxWidth:1200, margin:"0 auto", padding:"40px 24px" }}>
      {/* Delete confirm modal */}
      {confirmDelete && (
        <div onClick={() => setConfirmDelete(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:32, maxWidth:400, width:"100%", animation:"fadeUp 0.3s ease" }}>
            <div style={{ fontSize:40, marginBottom:16 }}>🗑️</div>
            <h2 style={{ fontFamily:"Bebas Neue", fontSize:28, marginBottom:8 }}>DELETE EVENT?</h2>
            <p style={{ color:"var(--muted)", fontSize:14, marginBottom:24 }}>This will permanently delete <strong style={{ color:"var(--text)" }}>{confirmDelete.title}</strong>. This action cannot be undone.</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:12, borderRadius:10, cursor:"pointer", fontWeight:600 }}>Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ background:"var(--red)", border:"none", color:"#fff", padding:12, borderRadius:10, cursor:"pointer", fontFamily:"Bebas Neue", fontSize:18, letterSpacing:1 }}>DELETE</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:40 }}>
        <h1 style={{ fontSize:48 }}>DASHBOARD</h1>
        <Link to="/dashboard/create" style={{ background:"var(--gold)", color:"#000", padding:"12px 24px", borderRadius:10, fontWeight:700, fontSize:14 }}>+ Create Event</Link>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:16, marginBottom:40 }}>
        {[
          { label:"Total Revenue", value:fmt(revenue), icon:"💰" },
          { label:"Tickets Sold", value:totalSold.toLocaleString(), icon:"🎟" },
          { label:"Checked In", value:totalCheckedIn.toLocaleString(), icon:"✅" },
          { label:"Avg. Fill Rate", value: totalCap?`${Math.round((totalSold/totalCap)*100)}%`:"0%", icon:"📊" },
        ].map(s => (
          <div key={s.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:24 }}>
            <div style={{ fontSize:28, marginBottom:8 }}>{s.icon}</div>
            <div style={{ fontFamily:"Bebas Neue", fontSize:32, color:"var(--gold)" }}>{s.value}</div>
            <div style={{ fontSize:12, color:"var(--muted)", marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Events table */}
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
          const pct = cap ? Math.round((sold/cap)*100) : 0;
          const eventTickets = tickets.filter(t => t.eventId === event.id);
          const checkedIn = eventTickets.filter(t => t.used).length;
          const checkInPct = eventTickets.length ? Math.round((checkedIn/eventTickets.length)*100) : 0;
          return (
            <div key={event.id} style={{ padding:"20px 24px", borderBottom: i<myEvents.length-1?"1px solid var(--border)":"none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:20, flexWrap:"wrap" }}>
                <img src={event.image} style={{ width:60, height:60, objectFit:"cover", borderRadius:8, flexShrink:0 }} alt="" />
                <div style={{ flex:1, minWidth:160 }}>
                  <div style={{ fontWeight:600, marginBottom:2 }}>{event.title}</div>
                  <div style={{ fontSize:13, color:"var(--muted)" }}>{fmtDate(event.date)}</div>
                </div>
                {/* Ticket sales bar */}
                <div style={{ minWidth:110 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--muted)", marginBottom:4 }}>
                    <span>Sales</span><span>{pct}%</span>
                  </div>
                  <div style={{ height:4, background:"var(--border)", borderRadius:2, marginBottom:2 }}>
                    <div style={{ height:"100%", width:`${pct}%`, background: pct>80?"var(--red)":"var(--gold)", borderRadius:2, transition:"width 0.4s" }} />
                  </div>
                  <div style={{ fontSize:12, fontFamily:"DM Mono", color:"var(--muted)" }}>{sold}/{cap}</div>
                </div>
                {/* Check-in bar */}
                <div style={{ minWidth:110 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--muted)", marginBottom:4 }}>
                    <span>Check-ins</span><span>{checkInPct}%</span>
                  </div>
                  <div style={{ height:4, background:"var(--border)", borderRadius:2, marginBottom:2 }}>
                    <div style={{ height:"100%", width:`${checkInPct}%`, background:"var(--green)", borderRadius:2, transition:"width 0.4s" }} />
                  </div>
                  <div style={{ fontSize:12, fontFamily:"DM Mono", color:"var(--muted)" }}>{checkedIn}/{eventTickets.length}</div>
                </div>
                <div style={{ textAlign:"right", minWidth:90 }}>
                  <div style={{ fontFamily:"Bebas Neue", fontSize:22, color:"var(--gold)" }}>{fmt(rev)}</div>
                  <div style={{ fontSize:12, color:"var(--muted)" }}>revenue</div>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  <Link to={`/event/${event.id}`} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"7px 12px", borderRadius:8, fontSize:13 }}>View</Link>
                  <Link to={`/dashboard/edit/${event.id}`} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"7px 12px", borderRadius:8, fontSize:13 }}>✏️ Edit</Link>
                  <Link to="/validate" style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"7px 12px", borderRadius:8, fontSize:13 }}>Scan ▶</Link>
                  <button onClick={() => downloadCSV(event, tickets)} style={{ background:"var(--gold)", border:"none", color:"#000", padding:"7px 12px", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                    ⬇ {eventTickets.length > 0 && <span style={{ background:"rgba(0,0,0,0.2)", borderRadius:100, padding:"1px 6px", fontSize:11 }}>{eventTickets.length}</span>}
                  </button>
                  <button onClick={() => setConfirmDelete(event)} style={{ background:"rgba(232,64,64,0.1)", border:"1px solid rgba(232,64,64,0.3)", color:"var(--red)", padding:"7px 12px", borderRadius:8, fontSize:13, cursor:"pointer" }}>🗑️</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Create Event Page ──────────────────────────────────────────────────────
// ── Shared EventForm ──────────────────────────────────────────────────────
function Req() {
  return <span style={{ color:"var(--red)", marginLeft:2 }}>*</span>;
}

function EventForm({ initialForm, onSubmit, saving, submitLabel, pageTitle, pageSubtitle }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [touched, setTouched] = useState({});

  const F = (k) => (e) => { setForm(p=>({...p,[k]:e.target.value})); setTouched(p=>({...p,[k]:true})); };
  const updateTier = (i,k,v) => setForm(p=>({...p,tiers:p.tiers.map((t,j)=>j===i?{...t,[k]:v}:t)}));
  const addTier = () => setForm(p=>({...p,tiers:[...p.tiers,{name:"",price:"",total:"",sold:0}]}));
  const removeTier = (i) => setForm(p=>({...p,tiers:p.tiers.filter((_,j)=>j!==i)}));

  const isValid = form.title && form.date && form.venue && form.tiers.every(t=>t.name&&t.price!==""&&t.total);

  const fieldErr = (k) => touched[k] && !form[k]
    ? <div style={{ color:"var(--red)", fontSize:11, marginTop:4 }}>This field is required</div>
    : null;

  const iStyle = (k, hasErr) => ({
    width:"100%", background:"var(--bg2)", borderRadius:8, padding:"10px 12px",
    color:"var(--text)", fontSize:14, outline:"none",
    border:`1px solid ${hasErr ? "var(--red)" : "var(--border)"}`,
  });

  return (
    <div style={{ maxWidth:700, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <button onClick={() => navigate("/dashboard")} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", marginBottom:24, fontSize:14 }}>← Dashboard</button>
      <h1 style={{ fontSize:48, marginBottom: pageSubtitle?8:24 }}>{pageTitle}</h1>
      {pageSubtitle && <p style={{ color:"var(--muted)", fontSize:13, marginBottom:24 }}>{pageSubtitle}</p>}
      <p style={{ fontSize:12, color:"var(--muted)", marginBottom:28 }}>Fields marked <span style={{ color:"var(--red)" }}>*</span> are required</p>

      <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

        {/* Title & Subtitle */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div>
            <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>EVENT TITLE <Req /></label>
            <input value={form.title} onChange={F("title")} onBlur={()=>setTouched(p=>({...p,title:true}))} placeholder="e.g. Neon Festival 2025" style={iStyle("title", touched.title&&!form.title)} />
            {fieldErr("title")}
          </div>
          <div>
            <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>SUBTITLE / ARTIST</label>
            <input value={form.subtitle} onChange={F("subtitle")} placeholder="e.g. ft. Burna Boy" style={iStyle("subtitle", false)} />
          </div>
        </div>

        {/* Date, Time, Category */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
          <div>
            <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>DATE <Req /></label>
            <input type="date" value={form.date} onChange={F("date")} onBlur={()=>setTouched(p=>({...p,date:true}))} style={iStyle("date", touched.date&&!form.date)} />
            {fieldErr("date")}
          </div>
          <div>
            <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>TIME</label>
            <input type="time" value={form.time} onChange={F("time")} style={iStyle("time", false)} />
          </div>
          <div>
            <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>CATEGORY <Req /></label>
            <select value={form.category} onChange={F("category")} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none" }}>
              {["Concert","Festival","Sports","Comedy","Conference"].map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Venue */}
        <div>
          <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>VENUE <Req /></label>
          <input value={form.venue} onChange={F("venue")} onBlur={()=>setTouched(p=>({...p,venue:true}))} placeholder="e.g. Eko Convention Centre, Lagos" style={iStyle("venue", touched.venue&&!form.venue)} />
          {fieldErr("venue")}
        </div>

        {/* Description */}
        <div>
          <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>DESCRIPTION</label>
          <textarea value={form.description} onChange={F("description")} rows={4} placeholder="Describe your event — lineup, dress code, what to expect..." style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, resize:"vertical", fontFamily:"DM Sans", outline:"none" }} />
        </div>

        {/* Ticket Tiers */}
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1 }}>TICKET TIERS <Req /></label>
            <button onClick={addTier} style={{ background:"none", border:"1px solid var(--gold-dim)", color:"var(--gold)", padding:"5px 14px", borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:600 }}>+ Add Tier</button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {form.tiers.map((tier,i) => (
              <div key={i} style={{ background:"var(--bg3)", padding:20, borderRadius:12, border:"1px solid var(--border)" }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:12 }}>
                  <div>
                    <label style={{ fontSize:11, color:"var(--muted)", marginBottom:6, display:"block", letterSpacing:1 }}>TIER NAME <Req /></label>
                    <input value={tier.name} onChange={e=>updateTier(i,"name",e.target.value)} onBlur={()=>setTouched(p=>({...p,[`t${i}n`]:true}))} placeholder="e.g. VIP" style={{ width:"100%", background:"var(--bg2)", border:`1px solid ${!tier.name&&touched[`t${i}n`]?"var(--red)":"var(--border)"}`, borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:14, outline:"none" }} />
                    {!tier.name&&touched[`t${i}n`]&&<div style={{ color:"var(--red)", fontSize:11, marginTop:3 }}>Required</div>}
                  </div>
                  <div>
                    <label style={{ fontSize:11, color:"var(--muted)", marginBottom:6, display:"block", letterSpacing:1 }}>PRICE (₦) <Req /></label>
                    <input type="number" min="0" value={tier.price} onChange={e=>updateTier(i,"price",e.target.value)} disabled={tier._free} placeholder="e.g. 15000" style={{ width:"100%", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:14, outline:"none", opacity:tier._free?0.4:1 }} />
                    <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:12, color:"var(--gold)", marginTop:6 }}>
                      <input type="checkbox" checked={tier._free||false} onChange={e=>{updateTier(i,"_free",e.target.checked); updateTier(i,"price",e.target.checked?"0":"");}} style={{ accentColor:"var(--gold)", width:13, height:13 }} />
                      Free ticket
                    </label>
                  </div>
                  <div>
                    <label style={{ fontSize:11, color:"var(--muted)", marginBottom:6, display:"block", letterSpacing:1 }}>CAPACITY <Req /></label>
                    <input type="number" min="1" value={tier.total} onChange={e=>updateTier(i,"total",e.target.value)} onBlur={()=>setTouched(p=>({...p,[`t${i}c`]:true}))} placeholder="e.g. 200" style={{ width:"100%", background:"var(--bg2)", border:`1px solid ${!tier.total&&touched[`t${i}c`]?"var(--red)":"var(--border)"}`, borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:14, outline:"none" }} />
                    {!tier.total&&touched[`t${i}c`]&&<div style={{ color:"var(--red)", fontSize:11, marginTop:3 }}>Required</div>}
                  </div>
                  <div style={{ display:"flex", alignItems:"flex-start", paddingTop:22 }}>
                    <button onClick={()=>removeTier(i)} disabled={form.tiers.length===1} title="Remove tier" style={{ width:36, height:36, background:"var(--bg2)", border:"1px solid var(--border)", color:"var(--red)", borderRadius:8, cursor:form.tiers.length===1?"not-allowed":"pointer", fontSize:18, opacity:form.tiers.length===1?0.3:1 }}>×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button onClick={()=>onSubmit(form)} disabled={!isValid||saving} style={{ width:"100%", padding:16, background:isValid?"var(--gold)":"var(--bg3)", color:isValid?"#000":"var(--muted)", border:"none", borderRadius:12, fontFamily:"Bebas Neue", fontSize:22, letterSpacing:2, cursor:isValid?"pointer":"not-allowed", opacity:saving?0.7:1, marginTop:8 }}>
          {saving ? "PLEASE WAIT..." : submitLabel}
        </button>
      </div>
    </div>
  );
}

// ── Create Event Page ──────────────────────────────────────────────────────
function CreateEventPage({ ctx }) {
  const { createEvent } = ctx;
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const blank = { title:"", subtitle:"", date:"", time:"", venue:"", category:"Concert", description:"", tiers:[{ name:"General", price:"", total:"" }] };
  const handle = async (form) => {
    setSaving(true);
    const ev = await createEvent(form);
    if (ev) navigate(`/event/${ev.id}`);
    setSaving(false);
  };
  return <EventForm initialForm={blank} onSubmit={handle} saving={saving} submitLabel="PUBLISH EVENT" pageTitle="CREATE EVENT" />;
}

// ── Edit Event Page ────────────────────────────────────────────────────────
function EditEventPage({ ctx }) {
  const { events, updateEvent } = ctx;
  const { eventId } = useParams();
  const navigate = useNavigate();
  const event = events.find(e => e.id === eventId);
  const [saving, setSaving] = useState(false);

  if (!event) return <div style={{ textAlign:"center", padding:80, color:"var(--muted)" }}>Event not found.</div>;

  const prefilled = {
    title: event.title, subtitle: event.subtitle||"", date: event.date,
    time: event.time||"", venue: event.venue, category: event.category||"Concert",
    description: event.description||"",
    tiers: event.tiers.map(t => ({ id:t.id, name:t.name, price:String(t.price), total:String(t.total), sold:t.sold||0, _free: Number(t.price)===0 })),
  };

  const handle = async (form) => {
    setSaving(true);
    const ok = await updateEvent(eventId, form);
    if (ok) navigate("/dashboard");
    setSaving(false);
  };

  return <EventForm initialForm={prefilled} onSubmit={handle} saving={saving} submitLabel="SAVE CHANGES" pageTitle="EDIT EVENT" pageSubtitle="Changes go live immediately after saving." />;
}

// ── Validate Page — snap photo → decode QR → confirm attendance ────────────
function ValidatePage({ ctx }) {
  const { validateTicket } = ctx;
  const [stage, setStage] = useState("idle"); // idle | decoding | preview | confirming | done | error | manual
  const [scannedTicket, setScannedTicket] = useState(null); // ticket data from Firestore
  const [scannedId, setScannedId] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmResult, setConfirmResult] = useState(null);
  const fileInputRef = useRef(null);

  // Load jsQR from CDN (tiny, fast, no DOM mounting issues)
  const loadJsQR = () => new Promise((resolve) => {
    if (window.jsQR) { resolve(window.jsQR); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";
    s.onload = () => resolve(window.jsQR);
    document.head.appendChild(s);
  });

  // Decode QR from a photo File
  const decodeQRFromFile = async (file) => {
    const jsQR = await loadJsQR();
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        // Downscale large images for speed
        const MAX = 1200;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        // Try both normal and inverted
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
        if (code?.data) resolve(code.data);
        else reject(new Error("No QR code found in photo. Try again with better lighting."));
      };
      img.onerror = () => reject(new Error("Could not read image."));
      img.src = url;
    });
  };

  // When user snaps / picks a photo
  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so same photo can be retried
    setStage("decoding"); setErrorMsg("");
    try {
      const raw = await decodeQRFromFile(file);
      const match = raw.match(/\/ticket\/([a-zA-Z0-9]+)/);
      const ticketId = match ? match[1] : raw.trim();

      // Fetch ticket details from Firestore for preview
      const snap = await getDoc(doc(db, "tickets", ticketId));
      if (!snap.exists()) { setErrorMsg("Ticket not found in system."); setStage("error"); return; }
      const ticket = { id: snap.id, ...snap.data() };
      setScannedId(ticketId);
      setScannedTicket(ticket);
      setStage("preview");
    } catch (err) {
      setErrorMsg(err.message);
      setStage("error");
    }
  };

  // Organizer confirms — actually marks ticket as used
  const handleMarkAttended = async () => {
    setStage("confirming");
    const res = await validateTicket(scannedId);
    setConfirmResult(res);
    setStage("done");
  };

  // Manual ID lookup
  const handleManual = async () => {
    if (!manualInput.trim()) return;
    setStage("decoding");
    const snap = await getDoc(doc(db, "tickets", manualInput.trim()));
    if (!snap.exists()) { setErrorMsg("Ticket not found."); setStage("error"); return; }
    setScannedId(manualInput.trim());
    setScannedTicket({ id: snap.id, ...snap.data() });
    setStage("preview");
  };

  const reset = () => {
    setStage("idle"); setScannedTicket(null); setScannedId("");
    setErrorMsg(""); setConfirmResult(null); setManualInput("");
  };

  return (
    <div style={{ maxWidth:500, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      {/* Hidden file input — capture="environment" opens rear camera on mobile */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display:"none" }}
        onChange={handlePhoto}
      />

      <h1 style={{ fontSize:48, marginBottom:8 }}>SCAN & VALIDATE</h1>
      <p style={{ color:"var(--muted)", marginBottom:32 }}>Snap the attendee's QR code or enter their ticket ID.</p>

      {/* ── IDLE — main action screen ── */}
      {stage === "idle" && (
        <>
          {/* Primary: snap photo */}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ width:"100%", background:"var(--gold)", color:"#000", border:"none", borderRadius:16, padding:"28px 24px", cursor:"pointer", marginBottom:16, display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}
          >
            <span style={{ fontSize:52 }}>📷</span>
            <span style={{ fontFamily:"Bebas Neue", fontSize:28, letterSpacing:2 }}>SNAP QR CODE</span>
            <span style={{ fontSize:13, fontWeight:500, opacity:0.75 }}>Opens your camera — take a photo of the ticket</span>
          </button>

          {/* Secondary: manual entry */}
          <button
            onClick={() => setStage("manual")}
            style={{ width:"100%", background:"var(--bg2)", color:"var(--muted)", border:"1px solid var(--border)", borderRadius:12, padding:"14px 24px", cursor:"pointer", fontWeight:600, fontSize:14 }}
          >
            ⌨️ Enter Ticket ID manually
          </button>
        </>
      )}

      {/* ── MANUAL entry ── */}
      {stage === "manual" && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28 }}>
          <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:2, marginBottom:10, display:"block" }}>TICKET ID</label>
          <input
            value={manualInput} onChange={e => setManualInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleManual()}
            placeholder="Paste ticket ID here..."
            autoFocus
            style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"14px 16px", color:"var(--text)", fontSize:14, fontFamily:"DM Mono", marginBottom:16, outline:"none" }}
          />
          <button onClick={handleManual} disabled={!manualInput.trim()} style={{ width:"100%", background: manualInput?"var(--gold)":"var(--bg3)", color: manualInput?"#000":"var(--muted)", border:"none", padding:14, borderRadius:10, cursor: manualInput?"pointer":"not-allowed", fontFamily:"Bebas Neue", fontSize:20, letterSpacing:2, marginBottom:10 }}>
            LOOK UP TICKET
          </button>
          <button onClick={reset} style={{ width:"100%", background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:13 }}>← Back</button>
        </div>
      )}

      {/* ── DECODING spinner ── */}
      {stage === "decoding" && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:48, textAlign:"center" }}>
          <div style={{ width:44, height:44, border:"3px solid var(--border)", borderTop:"3px solid var(--gold)", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 16px" }} />
          <p style={{ color:"var(--muted)", fontSize:14 }}>Reading QR code...</p>
        </div>
      )}

      {/* ── PREVIEW — show ticket info, ask to confirm ── */}
      {stage === "preview" && scannedTicket && (
        <div style={{ animation:"fadeUp 0.3s ease" }}>
          {/* Already used warning */}
          {scannedTicket.used && (
            <div style={{ background:"rgba(232,64,64,0.12)", border:"2px solid var(--red)", borderRadius:12, padding:"14px 20px", marginBottom:16, display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:24 }}>⚠️</span>
              <div>
                <div style={{ fontFamily:"Bebas Neue", fontSize:20, color:"var(--red)" }}>ALREADY USED</div>
                <div style={{ fontSize:12, color:"var(--muted)" }}>This ticket was already scanned at entry</div>
              </div>
            </div>
          )}

          {/* Ticket card */}
          <div style={{ background:"var(--bg2)", border:`1px solid ${scannedTicket.used ? "var(--border)" : "var(--gold-dim)"}`, borderRadius:16, overflow:"hidden", marginBottom:16 }}>
            <div style={{ background: scannedTicket.used ? "var(--bg3)" : "rgba(245,166,35,0.08)", padding:"16px 24px", borderBottom:"1px solid var(--border)" }}>
              <div style={{ fontSize:11, letterSpacing:3, color:"var(--gold)", marginBottom:4 }}>TICKET DETAILS</div>
              <div style={{ fontFamily:"Bebas Neue", fontSize:30 }}>{scannedTicket.eventTitle}</div>
            </div>
            <div style={{ padding:"20px 24px", display:"grid", gap:12 }}>
              {[
                ["👤 Attendee", scannedTicket.userName],
                ["🎫 Tier", scannedTicket.tierName],
                ["📅 Date", fmtDate(scannedTicket.eventDate)],
                ["📍 Venue", scannedTicket.venue],
                ["💰 Paid", fmt(scannedTicket.price)],
                ["Status", scannedTicket.used ? "⛔ Already Used" : "✅ Valid"],
              ].map(([k, v]) => (
                <div key={k} style={{ display:"flex", justifyContent:"space-between", fontSize:14 }}>
                  <span style={{ color:"var(--muted)" }}>{k}</span>
                  <span style={{ fontWeight:600, textAlign:"right", maxWidth:"55%" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          {!scannedTicket.used ? (
            <button
              onClick={handleMarkAttended}
              style={{ width:"100%", background:"var(--green)", color:"#000", border:"none", borderRadius:12, padding:"18px 24px", cursor:"pointer", fontFamily:"Bebas Neue", fontSize:26, letterSpacing:2, marginBottom:10 }}
            >
              ✓ MARK AS ATTENDED
            </button>
          ) : (
            <div style={{ background:"rgba(232,64,64,0.08)", border:"1px solid var(--red)", borderRadius:12, padding:"16px 24px", textAlign:"center", marginBottom:10 }}>
              <div style={{ fontFamily:"Bebas Neue", fontSize:22, color:"var(--red)" }}>⛔ DO NOT ALLOW ENTRY</div>
              <div style={{ fontSize:13, color:"var(--muted)", marginTop:4 }}>Ticket already redeemed</div>
            </div>
          )}
          <button onClick={reset} style={{ width:"100%", background:"none", border:"1px solid var(--border)", color:"var(--muted)", borderRadius:10, padding:"12px 24px", cursor:"pointer", fontWeight:600, fontSize:14 }}>
            📷 Scan Another Ticket
          </button>
        </div>
      )}

      {/* ── CONFIRMING spinner ── */}
      {stage === "confirming" && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:48, textAlign:"center" }}>
          <div style={{ width:44, height:44, border:"3px solid var(--border)", borderTop:"3px solid var(--green)", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 16px" }} />
          <p style={{ color:"var(--muted)", fontSize:14 }}>Marking attendance...</p>
        </div>
      )}

      {/* ── DONE — final result ── */}
      {stage === "done" && confirmResult && (
        <div style={{ animation:"fadeUp 0.3s ease" }}>
          <div style={{ background: confirmResult.ok ? "rgba(61,220,132,0.1)" : "rgba(232,64,64,0.1)", border:`2px solid ${confirmResult.ok ? "var(--green)" : "var(--red)"}`, borderRadius:16, padding:32, textAlign:"center", marginBottom:16 }}>
            <div style={{ fontSize:64, marginBottom:12 }}>{confirmResult.ok ? "✅" : "❌"}</div>
            <div style={{ fontFamily:"Bebas Neue", fontSize:36, color: confirmResult.ok ? "var(--green)" : "var(--red)", marginBottom:8 }}>
              {confirmResult.ok ? "ENTRY GRANTED" : "ENTRY DENIED"}
            </div>
            {confirmResult.ticket && (
              <div style={{ fontSize:15, color:"var(--text)", marginBottom:4 }}>{confirmResult.ticket.userName}</div>
            )}
            <div style={{ fontSize:13, color:"var(--muted)" }}>{confirmResult.msg}</div>
          </div>
          <button onClick={reset} style={{ width:"100%", background:"var(--gold)", color:"#000", border:"none", borderRadius:12, padding:"16px 24px", cursor:"pointer", fontFamily:"Bebas Neue", fontSize:22, letterSpacing:2 }}>
            📷 SCAN NEXT TICKET
          </button>
        </div>
      )}

      {/* ── ERROR ── */}
      {stage === "error" && (
        <div style={{ background:"rgba(232,64,64,0.08)", border:"1px solid var(--red)", borderRadius:16, padding:32, textAlign:"center", animation:"fadeUp 0.3s ease" }}>
          <div style={{ fontSize:48, marginBottom:12 }}>❌</div>
          <div style={{ fontFamily:"Bebas Neue", fontSize:26, color:"var(--red)", marginBottom:8 }}>SCAN FAILED</div>
          <p style={{ color:"var(--muted)", fontSize:13, marginBottom:24 }}>{errorMsg}</p>
          <button onClick={() => fileInputRef.current?.click()} style={{ background:"var(--gold)", color:"#000", border:"none", padding:"12px 28px", borderRadius:10, cursor:"pointer", fontFamily:"Bebas Neue", fontSize:18, letterSpacing:2, marginBottom:10, width:"100%" }}>
            📷 TRY AGAIN
          </button>
          <button onClick={reset} style={{ width:"100%", background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:"10px 24px", borderRadius:8, cursor:"pointer", fontSize:13 }}>
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}

// ── Legal page shared layout ───────────────────────────────────────────────
function LegalPage({ title, subtitle, children }) {
  const navigate = useNavigate();
  return (
    <div style={{ maxWidth:800, margin:"0 auto", padding:"48px 24px 80px", animation:"fadeUp 0.4s ease" }}>
      <button onClick={() => navigate(-1)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:14, marginBottom:32 }}>← Back</button>
      <div style={{ marginBottom:48 }}>
        <div style={{ fontSize:12, letterSpacing:4, color:"var(--gold)", textTransform:"uppercase", marginBottom:12, fontWeight:500 }}>Legal</div>
        <h1 style={{ fontSize:"clamp(40px,8vw,72px)", lineHeight:0.95, marginBottom:16 }}>{title}</h1>
        <p style={{ color:"var(--muted)", fontSize:15 }}>{subtitle}</p>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:40 }}>
        {children}
      </div>
    </div>
  );
}

function LegalSection({ title, children }) {
  return (
    <div style={{ borderLeft:"3px solid var(--gold)", paddingLeft:24 }}>
      <h2 style={{ fontFamily:"Bebas Neue", fontSize:22, letterSpacing:1, marginBottom:12, color:"var(--text)" }}>{title}</h2>
      <div style={{ color:"var(--muted)", fontSize:15, lineHeight:1.85 }}>{children}</div>
    </div>
  );
}

// ── Terms of Service ───────────────────────────────────────────────────────
function TermsPage() {
  return (
    <LegalPage
      title="TERMS OF SERVICE"
      subtitle={"Last updated: " + new Date().toLocaleDateString("en-NG", { year:"numeric", month:"long", day:"numeric" })}
    >
      <LegalSection title="1. Acceptance of Terms">
        <p>By accessing or using StagePro ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services. These terms apply to all users including attendees, event organisers, and visitors.</p>
      </LegalSection>

      <LegalSection title="2. About StagePro">
        <p>StagePro is an event ticketing platform operating in Nigeria that enables event organisers to list events and sell tickets, and enables attendees to discover and purchase tickets to events. StagePro acts as a facilitator between organisers and attendees and is not itself the organiser of any listed event.</p>
      </LegalSection>

      <LegalSection title="3. Account Registration">
        <p style={{ marginBottom:12 }}>To purchase tickets or create events, you must register for an account. By creating an account you agree to:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:8 }}>
          <li>Provide accurate, current, and complete information during registration.</li>
          <li>Maintain the security of your password and accept responsibility for all activity under your account.</li>
          <li>Notify us immediately of any unauthorised use of your account.</li>
          <li>Not create multiple accounts or share your account with others.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Ticket Purchases">
        <p style={{ marginBottom:12 }}>All ticket sales are subject to the following conditions:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:8 }}>
          <li><strong style={{ color:"var(--text)" }}>All sales are final.</strong> Tickets are non-refundable unless the event is cancelled or significantly changed by the organiser.</li>
          <li>Tickets may not be resold or transferred without prior written consent from StagePro.</li>
          <li>Each ticket is valid for a single entry. Duplicate or counterfeit tickets will be rejected at the venue.</li>
          <li>StagePro reserves the right to cancel tickets obtained fraudulently or in violation of these terms.</li>
          <li>Prices displayed are inclusive of any applicable service fees unless otherwise stated.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Event Organiser Responsibilities">
        <p style={{ marginBottom:12 }}>If you create events on StagePro, you agree to:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:8 }}>
          <li>Provide accurate event details including date, time, venue, and ticket tiers.</li>
          <li>Honour all tickets issued through the Platform.</li>
          <li>Notify attendees and StagePro promptly of any material changes or cancellations.</li>
          <li>Comply with all applicable Nigerian laws and regulations including venue licensing, public safety, and entertainment laws.</li>
          <li>Be solely responsible for the safe conduct of your event.</li>
          <li>Refund attendees in full for cancelled events within 14 days of cancellation.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Prohibited Conduct">
        <p style={{ marginBottom:12 }}>You agree not to:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:8 }}>
          <li>Use the Platform for any unlawful purpose or in violation of these Terms.</li>
          <li>Attempt to gain unauthorised access to any part of the Platform or its systems.</li>
          <li>Use automated tools to scrape, crawl, or extract data from the Platform.</li>
          <li>Post false, misleading, or fraudulent event listings.</li>
          <li>Harass, threaten, or harm other users of the Platform.</li>
          <li>Engage in ticket scalping, bulk purchasing for resale, or price manipulation.</li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Intellectual Property">
        <p>All content on the StagePro Platform including logos, design, text, graphics, and software is the property of StagePro or its licensors and is protected by Nigerian and international intellectual property laws. You may not reproduce, distribute, or create derivative works without express written permission.</p>
      </LegalSection>

      <LegalSection title="8. Limitation of Liability">
        <p>StagePro shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Platform or attendance at any event. Our total liability to you for any claim shall not exceed the amount you paid for the ticket(s) in question. StagePro is not responsible for the actions, content, or conduct of event organisers or other users.</p>
      </LegalSection>

      <LegalSection title="9. Dispute Resolution">
        <p>Any disputes arising from these Terms or your use of the Platform shall first be attempted to be resolved through good-faith negotiation. If unresolved within 30 days, disputes shall be submitted to binding arbitration in Lagos, Nigeria, in accordance with the Arbitration and Conciliation Act. Notwithstanding the foregoing, either party may seek urgent injunctive relief from a competent court.</p>
      </LegalSection>

      <LegalSection title="10. Governing Law">
        <p>These Terms shall be governed by and construed in accordance with the laws of the Federal Republic of Nigeria. Any legal action arising from these Terms shall be brought exclusively in the courts of Lagos State, Nigeria.</p>
      </LegalSection>

      <LegalSection title="11. Changes to Terms">
        <p>StagePro reserves the right to modify these Terms at any time. We will notify registered users of material changes via email or in-app notification. Continued use of the Platform after changes are posted constitutes your acceptance of the updated Terms.</p>
      </LegalSection>

      <LegalSection title="12. Contact Us">
        <p>If you have questions about these Terms of Service, please contact us at <span style={{ color:"var(--gold)" }}>legal@stagepro.ng</span> or write to us at StagePro HQ, Victoria Island, Lagos, Nigeria.</p>
      </LegalSection>
    </LegalPage>
  );
}

// ── Privacy Policy ─────────────────────────────────────────────────────────
function PrivacyPage() {
  return (
    <LegalPage
      title="PRIVACY POLICY"
      subtitle={"Last updated: " + new Date().toLocaleDateString("en-NG", { year:"numeric", month:"long", day:"numeric" })}
    >
      <LegalSection title="1. Introduction">
        <p>StagePro ("we", "us", or "our") is committed to protecting your personal information. This Privacy Policy explains how we collect, use, store, and share your data when you use our ticketing platform. By using StagePro, you consent to the practices described in this policy.</p>
      </LegalSection>

      <LegalSection title="2. Information We Collect">
        <p style={{ marginBottom:12 }}>We collect the following categories of personal information:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:10 }}>
          <li><strong style={{ color:"var(--text)" }}>Account Information:</strong> Your full name, email address, and account type (attendee or organiser) when you register.</li>
          <li><strong style={{ color:"var(--text)" }}>Transaction Data:</strong> Details of tickets purchased including event name, ticket tier, price paid, and purchase date.</li>
          <li><strong style={{ color:"var(--text)" }}>Usage Data:</strong> Pages visited, features used, device type, browser, and IP address collected automatically when you use the Platform.</li>
          <li><strong style={{ color:"var(--text)" }}>Event Data:</strong> If you are an organiser, details of events you create including event name, description, venue, and pricing.</li>
          <li><strong style={{ color:"var(--text)" }}>Communications:</strong> Any messages or support requests you send to us.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. How We Use Your Information">
        <p style={{ marginBottom:12 }}>We use your information to:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:8 }}>
          <li>Create and manage your account.</li>
          <li>Process ticket purchases and deliver tickets to you.</li>
          <li>Send booking confirmations and event reminders via email.</li>
          <li>Provide customer support and resolve disputes.</li>
          <li>Allow event organisers to verify tickets at the venue.</li>
          <li>Improve and personalise the Platform experience.</li>
          <li>Comply with legal obligations under Nigerian law.</li>
          <li>Send you relevant updates and promotional messages (you may opt out at any time).</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Data Sharing">
        <p style={{ marginBottom:12 }}>We do not sell your personal data. We share your information only in the following circumstances:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:8 }}>
          <li><strong style={{ color:"var(--text)" }}>Event Organisers:</strong> Your name and ticket details are shared with the organiser of events you attend, solely for the purpose of entry verification.</li>
          <li><strong style={{ color:"var(--text)" }}>Service Providers:</strong> We use third-party services including Google Firebase (authentication and database) and Google Sheets (attendance logging). These providers process data on our behalf under strict confidentiality obligations.</li>
          <li><strong style={{ color:"var(--text)" }}>Legal Requirements:</strong> We may disclose your information when required by Nigerian law, court order, or government authority.</li>
          <li><strong style={{ color:"var(--text)" }}>Business Transfer:</strong> In the event of a merger or acquisition, your data may be transferred to the new entity, who will be bound by this policy.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Data Storage and Security">
        <p>Your data is stored securely using Google Firebase infrastructure hosted in compliance with international data protection standards. We implement industry-standard security measures including encrypted connections (HTTPS), secure authentication, and access controls. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.</p>
      </LegalSection>

      <LegalSection title="6. Data Retention">
        <p>We retain your personal data for as long as your account is active or as needed to provide our services. Transaction records are retained for a minimum of 6 years to comply with Nigerian financial regulations. You may request deletion of your account and associated data at any time, subject to our legal retention obligations.</p>
      </LegalSection>

      <LegalSection title="7. Your Rights">
        <p style={{ marginBottom:12 }}>Under Nigerian data protection law (NDPR) and applicable international standards, you have the right to:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:8 }}>
          <li><strong style={{ color:"var(--text)" }}>Access:</strong> Request a copy of the personal data we hold about you.</li>
          <li><strong style={{ color:"var(--text)" }}>Correction:</strong> Request that we correct inaccurate or incomplete data.</li>
          <li><strong style={{ color:"var(--text)" }}>Deletion:</strong> Request that we delete your personal data, subject to legal obligations.</li>
          <li><strong style={{ color:"var(--text)" }}>Objection:</strong> Object to the processing of your data for marketing purposes.</li>
          <li><strong style={{ color:"var(--text)" }}>Portability:</strong> Request your data in a structured, machine-readable format.</li>
        </ul>
        <p style={{ marginTop:12 }}>To exercise any of these rights, contact us at <span style={{ color:"var(--gold)" }}>privacy@stagepro.ng</span>. We will respond within 30 days.</p>
      </LegalSection>

      <LegalSection title="8. Cookies">
        <p>StagePro uses browser local storage and session storage to maintain your login session and theme preferences. We do not currently use third-party advertising or tracking cookies. You can clear stored data at any time through your browser settings, though this will log you out of the Platform.</p>
      </LegalSection>

      <LegalSection title="9. Children's Privacy">
        <p>StagePro is not intended for use by individuals under the age of 18. We do not knowingly collect personal data from minors. If you believe a minor has provided us with their data, please contact us immediately and we will delete it promptly.</p>
      </LegalSection>

      <LegalSection title="10. Third-Party Links">
        <p>The Platform may contain links to third-party websites or services. We are not responsible for the privacy practices of those sites. We encourage you to review the privacy policies of any third-party services you visit.</p>
      </LegalSection>

      <LegalSection title="11. Changes to This Policy">
        <p>We may update this Privacy Policy from time to time. We will notify you of significant changes via email or a prominent notice on the Platform. Your continued use of StagePro after changes take effect constitutes your acceptance of the updated policy.</p>
      </LegalSection>

      <LegalSection title="12. Contact & Complaints">
        <p>For privacy-related enquiries or complaints, contact our Data Protection Officer at <span style={{ color:"var(--gold)" }}>privacy@stagepro.ng</span>. If you are unsatisfied with our response, you may lodge a complaint with the Nigeria Data Protection Bureau (NDPB) at <span style={{ color:"var(--gold)" }}>ndpb.gov.ng</span>.</p>
      </LegalSection>
    </LegalPage>
  );
}
