import { useState, useEffect, useRef } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useParams,
  Navigate,
  useSearchParams,
} from "react-router-dom";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  increment,
} from "firebase/firestore";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

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
const storage = getStorage(app);

// ── Google Sheets logger (non-blocking) ────────────────────────────────────
const normalizeHttpUrl = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const getEventLiveSheetConfig = (event = null) => {
  const liveSheet = event?.liveSheet || {};
  return {
    webhookUrl: normalizeHttpUrl(liveSheet.webhookUrl || event?.liveSheetWebhookUrl || ""),
    viewUrl: normalizeHttpUrl(liveSheet.viewUrl || event?.liveSheetViewUrl || ""),
  };
};

const logOrganizerLiveSheet = async (organizerId, payload, eventId = "") => {
  if (!organizerId || !payload) return;
  try {
    await fetch("/api/auto-payouts-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizerId, eventId: String(eventId || payload?.eventId || "").trim(), payload }),
    });
  } catch (err) {
    console.warn("Organizer live sheet log failed (non-critical):", err);
  }
};

// ── CSV Download ───────────────────────────────────────────────────────────
function downloadCSVWithEmail(event, myTickets) {
  const eventTickets = myTickets.filter(t => t.eventId === event.id);
  if (eventTickets.length === 0) { alert("No tickets sold for this event yet."); return; }
  const headers = ["Ticket ID", "Event", "Tier", "Buyer Name", "Buyer Email", "Price (NGN)", "Date Purchased", "Used"];
  const rows = eventTickets.map(t => [
    t.id, t.eventTitle, t.tierName, t.userName, t.userEmail || "", t.price,
    new Date(t.purchasedAt).toLocaleString("en-NG"),
    t.used ? "Yes" : "No",
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.replace(/\s+/g, "_")}_tickets.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── QR Code — client-side, no external API dependency ─────────────────────
function downloadCSV(event, tickets) {
  const eventTickets = tickets.filter(t => t.eventId === event.id);
  if (eventTickets.length === 0) { alert("No tickets sold for this event yet."); return; }
  const headers = ["Ticket ID", "Event", "Tier", "Buyer Name", "Buyer Email", "Price (NGN)", "Date Purchased", "Used"];
  const rows = eventTickets.map(t => [
    t.id,
    t.eventTitle,
    t.tierName,
    t.userName,
    t.userEmail || "",
    t.price,
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

function downloadTicketFile(ticket) {
  const ticketUrl = `${window.location.origin}/ticket/${ticket.id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(ticketUrl)}&margin=8`;
  const fileName = `${(ticket.eventTitle || "stagepro-ticket").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${ticket.id}.svg`;
  const purchasedAt = ticket.purchasedAt ? new Date(ticket.purchasedAt).toLocaleString("en-NG") : "";
  const amount = ticket.price === 0 ? "FREE" : fmt(ticket.price);

  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#171717"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <rect x="60" y="60" width="960" height="1800" rx="36" fill="#111111" stroke="#2a2a2a" stroke-width="4"/>
  <text x="100" y="160" fill="#f5a623" font-size="48" font-family="Arial, sans-serif" font-weight="700" letter-spacing="8">STAGEPRO</text>
  <text x="100" y="245" fill="#777777" font-size="28" font-family="Arial, sans-serif" letter-spacing="5">MOBILE TICKET</text>

  <text x="100" y="360" fill="#777777" font-size="24" font-family="Arial, sans-serif" letter-spacing="4">EVENT</text>
  <text x="100" y="425" fill="#f5f5f5" font-size="64" font-family="Arial, sans-serif" font-weight="700">${esc(ticket.eventTitle)}</text>

  <text x="100" y="540" fill="#777777" font-size="24" font-family="Arial, sans-serif" letter-spacing="4">DETAILS</text>
  <text x="100" y="610" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif">Tier</text>
  <text x="430" y="610" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif" text-anchor="end">${esc(ticket.tierName)}</text>
  <text x="100" y="680" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif">Date</text>
  <text x="980" y="680" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif" text-anchor="end">${esc(fmtDate(ticket.eventDate))}</text>
  <text x="100" y="750" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif">Time</text>
  <text x="980" y="750" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif" text-anchor="end">${esc(ticket.eventTime || "See event page")}</text>
  <text x="100" y="820" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif">Venue</text>
  <text x="980" y="820" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif" text-anchor="end">${esc(ticket.venue || "")}</text>
  <text x="100" y="890" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif">Holder</text>
  <text x="980" y="890" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif" text-anchor="end">${esc(ticket.userName || "")}</text>
  <text x="100" y="960" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif">Price</text>
  <text x="980" y="960" fill="#f5f5f5" font-size="34" font-family="Arial, sans-serif" text-anchor="end">${esc(amount)}</text>

  <rect x="100" y="1030" width="880" height="4" fill="#2a2a2a"/>
  <image href="${qrUrl}" x="320" y="1090" width="440" height="440"/>
  <text x="540" y="1575" fill="#777777" font-size="24" font-family="Arial, sans-serif" text-anchor="middle">Scan this QR code at the entrance</text>

  <text x="100" y="1670" fill="#777777" font-size="24" font-family="Arial, sans-serif" letter-spacing="4">TICKET ID</text>
  <text x="100" y="1730" fill="#f5a623" font-size="30" font-family="Courier New, monospace">${esc(ticket.id)}</text>
  <text x="100" y="1790" fill="#777777" font-size="22" font-family="Arial, sans-serif">Purchased: ${esc(purchasedAt)}</text>
  <text x="100" y="1845" fill="#777777" font-size="22" font-family="Arial, sans-serif">${esc(ticketUrl)}</text>
</svg>`.trim();

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const file = new File([blob], fileName, { type: "image/svg+xml" });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: `${ticket.eventTitle} Ticket` }).catch(() => {});
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function QRCode({ ticketId, size = 160 }) {
  const canvasRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const url = `${window.location.origin}/ticket/${ticketId}`;

  useEffect(() => {
    const renderQR = () => {
      const canvas = canvasRef.current;
      if (!canvas || !window.QRCode) return;
      canvas.innerHTML = "";
      try {
        new window.QRCode(canvas, {
          text: url,
          width: size,
          height: size,
          colorDark: "#f5a623",
          colorLight: "#0a0a0a",
          correctLevel: window.QRCode.CorrectLevel.M,
        });
        setLoaded(true);
      } catch (e) {
        console.error("QR render failed", e);
      }
    };

    if (window._qrLoaded) {
      renderQR();
    } else {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.onload = () => { window._qrLoaded = true; renderQR(); };
      document.head.appendChild(s);
    }
  }, [ticketId, url, size]);

  return (
    <div style={{ position:"relative", width:size, height:size, borderRadius:8, overflow:"hidden", background:"#0a0a0a" }}>
      {!loaded && (
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <i className="fa-solid fa-circle-notch fa-spin" style={{ color:"var(--gold)", fontSize:24 }} />
        </div>
      )}
      <div ref={canvasRef} style={{ width:size, height:size }} />
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => `₦${Number(n).toLocaleString()}`;
const slugify = (value = "") =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const buildEventRouteId = (eventOrId, fallbackTitle = "") => {
  if (!eventOrId) return "";
  if (typeof eventOrId === "string") return eventOrId;
  const id = eventOrId.id || "";
  if (!id) return "";
  const titleSlug = slugify(eventOrId.slug || eventOrId.title || fallbackTitle || "event");
  return titleSlug ? `${titleSlug}-${id}` : id;
};

const eventPath = (eventOrId, fallbackTitle = "") => `/event/${buildEventRouteId(eventOrId, fallbackTitle)}`;

const resolveEventIdFromParam = (param = "") => {
  const raw = String(param || "");
  if (!raw) return "";
  const parts = raw.split("-");
  const maybeId = parts[parts.length - 1];
  return /^[A-Za-z0-9]{16,}$/.test(maybeId) ? maybeId : raw;
};
// ── Sold count for a tier ─────────────────────────────────────────────────
// Sold count for a tier — reads from event.soldCounts map (atomic increments)
// with fallback to tier.sold for legacy events
const getSold = (event, tierId) => {
  if (event?.soldCounts && event.soldCounts[tierId] !== undefined) {
    return Number(event.soldCounts[tierId]);
  }
  const tier = event?.tiers?.find(t => t.id === tierId);
  return Number(tier?.sold) || 0;
};

const normalizePhone = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const compact = raw.replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("234")) return `+${compact}`;
  if (compact.startsWith("0")) return `+234${compact.slice(1)}`;
  return compact;
};

const getLiveSold = (event, tierId, liveSoldCounts = {}) => {
  const eventCounts = liveSoldCounts?.[event?.id];
  if (eventCounts && eventCounts[tierId] !== undefined) {
    return Number(eventCounts[tierId]);
  }
  return getSold(event, tierId);
};

const buildTicketSoldCounts = (tickets = []) => {
  const soldCounts = {};
  tickets.forEach((ticket) => {
    const eventId = String(ticket?.eventId || "").trim();
    const tierId = String(ticket?.tierId || "").trim();
    if (!eventId || !tierId) return;
    if (!soldCounts[eventId]) soldCounts[eventId] = {};
    soldCounts[eventId][tierId] = Number(soldCounts[eventId][tierId] || 0) + 1;
  });
  return soldCounts;
};

// ── Banner themes ──────────────────────────────────────────────────────────
const THEMES = {
  purple:   "linear-gradient(135deg,#6a11cb,#2575fc)",
  fire:     "linear-gradient(135deg,#f83600,#f9d423)",
  ocean:    "linear-gradient(135deg,#0575e6,#021b79)",
  forest:   "linear-gradient(135deg,#134e5e,#71b280)",
  gold:     "linear-gradient(135deg,#f7971e,#ffd200)",
  rose:     "linear-gradient(135deg,#f953c6,#b91d73)",
  midnight: "linear-gradient(135deg,#232526,#414345)",
  neon:     "linear-gradient(135deg,#00f260,#0575e6)",
  sunset:   "linear-gradient(135deg,#f857a4,#ff5858)",
  teal:     "linear-gradient(135deg,#11998e,#38ef7d)",
  royal:    "linear-gradient(135deg,#141e30,#243b55)",
};

// Returns CSS background for an event — image takes priority, then theme, then default
const getEventBg = (event) => {
  if (event?.image) return `url(${event.image})`;
  if (event?.theme && THEMES[event.theme]) return THEMES[event.theme];
  return "linear-gradient(135deg,#1a1a1a,#2a2a2a)";
};

const DEFAULT_EVENT_IMAGE = "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1200&q=80";

const normalizeEventImageUrl = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (host === "imgur.com" || host === "www.imgur.com") {
      const id = u.pathname.replace(/^\/+/, "").split("/")[0];
      if (id) return `https://i.imgur.com/${id}.jpg`;
    }
    if (host === "i.imgur.com") {
      const path = u.pathname || "";
      if (!/\.(png|jpe?g|webp|gif)$/i.test(path)) {
        return `https://i.imgur.com${path}.jpg`;
      }
    }
    return value;
  } catch {
    return value;
  }
};

const getEventImageSrc = (event = {}) => {
  const normalized = normalizeEventImageUrl(event?.image);
  const base = normalized || DEFAULT_EVENT_IMAGE;
  // Only append cache-busting stamp for own-hosted images (Firebase Storage).
  // External hosts like Imgur reject query strings on direct image URLs.
  try {
    const host = new URL(base).hostname.toLowerCase();
    const isExternal = !host.includes("firebasestorage") && !host.includes("googleusercontent");
    if (isExternal) return base;
  } catch { return base; }
  const stamp = event?.updatedAt || event?.createdAt || "";
  if (!stamp) return base;
  return base.includes("?") ? `${base}&v=${encodeURIComponent(stamp)}` : `${base}?v=${encodeURIComponent(stamp)}`;
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-NG", {
    weekday: "short", year: "numeric", month: "long", day: "numeric",
  });

const parseEmailList = (value = "") =>
  String(value)
    .split(/[,\n;]/)
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);

const isEventManager = (event, userOrUid, userEmail = "") => {
  if (!event || !userOrUid) return false;
  const userUid = typeof userOrUid === "string" ? userOrUid : userOrUid.uid;
  const email = String(typeof userOrUid === "object" ? userOrUid.email : userEmail || "").trim().toLowerCase();
  if (event.organizer === userUid) return true;
  if (Array.isArray(event.coOrganizers) && event.coOrganizers.includes(userUid)) return true;
  if (email && Array.isArray(event.coOrganizerEmails) && event.coOrganizerEmails.includes(email)) return true;
  if (email && Array.isArray(event.coOrganizerInviteEmails) && event.coOrganizerInviteEmails.includes(email)) return true;
  return false;
};

const SHORT_TICKET_ID_LENGTH = 7;
const SHORT_TICKET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateShortTicketId(length = SHORT_TICKET_ID_LENGTH) {
  let value = "";
  for (let i = 0; i < length; i++) {
    value += SHORT_TICKET_ALPHABET[Math.floor(Math.random() * SHORT_TICKET_ALPHABET.length)];
  }
  return value;
}

const getPaymentReference = (ticket = {}) =>
  String(ticket.paymentReference || ticket.reference || "").trim();

const calculateSquadTransferFee = (amount = 0) =>
  Math.round(Number(amount || 0) * 0.012);

const calculatePayoutSummary = (tickets) => {
  const STAGEPRO_FEE = 100;
  const paidTickets = tickets.filter(t => t.paymentStatus === "paid" && getPaymentReference(t));
  const orderRefs = [...new Set(paidTickets.map(getPaymentReference).filter(Boolean))];
  const gross = tickets.reduce((s, t) => s + (t.price || 0), 0);
  const stagePro = orderRefs.length * STAGEPRO_FEE;
  const squad = calculateSquadTransferFee(gross);
  const net = Math.max(0, Math.round(gross - stagePro - squad));
  return { gross, stagePro, squad, net, orderCount: orderRefs.length, paidTickets };
};


// ── Email ticket via EmailJS ───────────────────────────────────────────────
// ── Send ticket confirmation email via Resend (Vercel serverless function) ──
const sendTicketEmail = async ({ toEmail, toName, ticket, eventImage, themeColor, organizerName }) => {
  try {
    const ticketUrl = `${window.location.origin}/ticket/${ticket.id}`;
    const amountPaid = ticket.price === 0 ? "FREE" : `NGN ${Number(ticket.price).toLocaleString()}`;
    const res = await fetch("/api/send-ticket-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        toName,
        eventTitle: ticket.eventTitle,
        eventDate: new Date(ticket.eventDate).toLocaleDateString("en-NG", { weekday:"long", year:"numeric", month:"long", day:"numeric" }),
        eventTime: ticket.eventTime || "See event page",
        eventVenue: ticket.venue,
        tierName: ticket.tierName,
        amountPaid,
        ticketUrl,
        ticketId: ticket.id,
        eventImage: eventImage || null,
        themeColor: themeColor || "#f5a623",
        organizerName: organizerName || "StagePro",
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.success !== true) {
      console.warn("Ticket email failed (non-critical):", payload?.error || "Email delivery is temporarily unavailable.");
    }
  } catch (err) {
    console.warn("Ticket email failed (non-critical):", err?.message || "Email delivery is temporarily unavailable.");
  }
};

// ── Seed events ────────────────────────────────────────────────────────────

// ── Global styles ──────────────────────────────────────────────────────────
const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');
  @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css');
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

  body { font-family: 'Manrope', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; transition: background 0.25s, color 0.25s; }
  h1, h2, h3 { font-family: 'Oswald', sans-serif; letter-spacing: 0.04em; }
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
    .footer-section-title { margin-bottom: 14px !important; }
    .footer-bottom { flex-direction: column !important; align-items: flex-start !important; }
    .event-layout { grid-template-columns: 1fr !important; gap: 20px !important; }
    .event-layout > div:last-child { position: static !important; }
  }
  @media (max-width: 480px) {
    .footer-grid { grid-template-columns: 1fr !important; }
    .footer-bottom-links { width: 100% !important; justify-content: space-between !important; gap: 10px !important; flex-wrap: wrap !important; }
  }
  @media (max-width: 600px) {
    nav { padding: 10px 16px !important; height: auto !important; min-height: 60px; }
    .nav-shell { align-items: flex-start !important; gap: 12px !important; }
    .nav-actions { gap: 6px !important; flex-wrap: wrap !important; justify-content: flex-end !important; max-width: 72%; }
    .nav-actions a, .nav-actions button { font-size: 12px !important; padding: 6px 10px !important; }
    .footer-grid { padding: 44px 20px 32px !important; gap: 24px !important; }
    .footer-link { display: inline-block !important; padding: 6px 0 !important; min-height: 32px; }
    .footer-social { gap: 8px !important; }
    .footer-bottom { padding: 18px 20px !important; }
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
        {state === "copied" ? "Copied!" : `${label}`}
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
            <h3 style={{ fontFamily:"Oswald", fontSize:26, marginBottom:8 }}>SHARE LINK</h3>
            <p style={{ color:"var(--muted)", fontSize:13, marginBottom:16 }}>Tap the link to select it, then copy — or share directly to WhatsApp.</p>
            {/* URL input — tap to select all */}
            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              <input
                readOnly value={url}
                onFocus={e => e.target.select()}
                onClick={e => e.target.select()}
                style={{ flex:1, background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:12, fontFamily:"IBM Plex Mono", outline:"none", minWidth:0 }}
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
              <i className="fa-brands fa-whatsapp" style={{marginRight:8,fontSize:18}} /> Share on WhatsApp
            </a>
            <button onClick={e => { e.stopPropagation(); setState("idle"); }} style={{ width:"100%", background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:10, borderRadius:8, cursor:"pointer", fontSize:13 }}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}


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
      <input {...props} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none", fontFamily:"Manrope" }} />
    </div>
  );
}

// ── Nav ────────────────────────────────────────────────────────────────────
function Nav({ currentUser, logout, notification, events }) {
  return (
    <>
      <style>{STYLE}</style>
      {notification && <Notification {...notification} />}
      <nav className="nav-shell" style={{ position:"sticky", top:0, zIndex:100, background:"var(--nav-bg)", backdropFilter:"blur(12px)", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 32px", height:60 }}>
        <Link to="/" style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontFamily:"Oswald", fontSize:26, color:"var(--gold)", letterSpacing:1 }}>STAGE</span>
          <span style={{ fontFamily:"Oswald", fontSize:26, color:"var(--text)", letterSpacing:1 }}>PRO</span>
        </Link>
        <div className="nav-actions" style={{ display:"flex", alignItems:"center", gap:8 }}>
          {currentUser ? (
            <>
              {currentUser.role === "organizer" && (
                <>
                  <Link to="/dashboard" style={{ color:"var(--muted)", fontSize:14, fontWeight:500, padding:"6px 12px" }}>Dashboard</Link>
                  <Link to="/validate" style={{ color:"var(--muted)", fontSize:14, fontWeight:500, padding:"6px 12px" }}>Scan</Link>
                </>
              )}
              {currentUser.role === "customer" && (
                <>
                  <Link to="/tickets" style={{ color:"var(--muted)", fontSize:14, fontWeight:500, padding:"6px 12px" }}>My Tickets</Link>
                  <NotificationBell currentUser={currentUser} events={events} />
                </>
              )}
              {currentUser.role === "admin" && (
                <Link to="/admin" style={{ color:"var(--muted)", fontSize:14, fontWeight:500, padding:"6px 12px" }}>Admin</Link>
              )}
              <div style={{ width:32, height:32, borderRadius:"50%", background:"var(--gold)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:"#000", fontSize:13, cursor:"pointer" }} onClick={() => window.location.href="/profile"}>
                {currentUser.name?.[0] ?? "U"}
              </div>
              <button onClick={logout} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:13 }}>Sign out</button>
            </>
          ) : (
            <>
              <Link to="/find-tickets" style={{ color:"var(--muted)", fontSize:14, fontWeight:500, padding:"6px 12px" }}>Find My Tickets</Link>
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
  const [publicSoldCounts, setPublicSoldCounts] = useState({});
  const [organizerEvents, setOrganizerEvents] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [organizerNotifications, setOrganizerNotifications] = useState([]);
  const [organizerAttendeeFeed, setOrganizerAttendeeFeed] = useState([]);
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
    setEventsLoading(true);
    const unsub = onSnapshot(
      collection(db, "events"),
      (snapshot) => {
        setEvents(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        setEventsLoading(false);
      },
      (err) => {
        console.error("Events fetch failed:", err);
        setEventsLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // soldCounts are read directly from event.soldCounts on each event doc.
  // Since events are synced live via onSnapshot, no separate fetch is needed.
  useEffect(() => {
    const merged = {};
    events.forEach((event) => {
      if (event.soldCounts && typeof event.soldCounts === "object") {
        merged[event.id] = event.soldCounts;
      }
    });
    setPublicSoldCounts(merged);
  }, [events]);

  useEffect(() => {
    if (currentUser?.role !== "organizer") {
      setOrganizerEvents([]);
      return;
    }

    const bucket = new Map();
    const mergeRows = () => {
      const mergedMap = new Map();
      bucket.forEach(rows => rows.forEach(row => mergedMap.set(row.id, row)));
      setOrganizerEvents(Array.from(mergedMap.values()));
    };

    const ownedQ = query(collection(db, "events"), where("organizer", "==", currentUser.uid));
    const collabQ = query(collection(db, "events"), where("coOrganizers", "array-contains", currentUser.uid));
    const collabEmailQ = query(collection(db, "events"), where("coOrganizerEmails", "array-contains", (currentUser.email || "").toLowerCase()));
    const inviteEmailQ = query(collection(db, "events"), where("coOrganizerInviteEmails", "array-contains", (currentUser.email || "").toLowerCase()));

    const unsubOwned = onSnapshot(
      ownedQ,
      (snapshot) => {
        bucket.set("owned", snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        mergeRows();
      },
      (err) => {
        console.error("Organizer owned-events listener failed:", err);
        bucket.set("owned", []);
        mergeRows();
      }
    );

    const unsubCollab = onSnapshot(
      collabQ,
      (snapshot) => {
        bucket.set("collab", snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        mergeRows();
      },
      (err) => {
        console.error("Organizer co-events listener failed:", err);
        bucket.set("collab", []);
        mergeRows();
      }
    );

    const unsubCollabEmail = onSnapshot(
      collabEmailQ,
      (snapshot) => {
        bucket.set("collabEmail", snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        mergeRows();
      },
      (err) => {
        console.error("Organizer co-email events listener failed:", err);
        bucket.set("collabEmail", []);
        mergeRows();
      }
    );

    const unsubInviteEmail = onSnapshot(
      inviteEmailQ,
      (snapshot) => {
        bucket.set("inviteEmail", snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        mergeRows();
      },
      (err) => {
        console.error("Organizer invite-email events listener failed:", err);
        bucket.set("inviteEmail", []);
        mergeRows();
      }
    );

    return () => { unsubOwned(); unsubCollab(); unsubCollabEmail(); unsubInviteEmail(); };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setTickets([]);
      return;
    }
    if (currentUser.role === "organizer") {
      const myEventIds = organizerEvents.map(e => e.id);
      if (myEventIds.length === 0) {
        setTickets([]);
        return;
      }

      const chunks = [];
      for (let i = 0; i < myEventIds.length; i += 30) chunks.push(myEventIds.slice(i, i + 30));

      const bucket = new Map();
      const unsubs = chunks.map((chunk, idx) => {
        const q = query(collection(db, "tickets"), where("eventId", "in", chunk));
        return onSnapshot(
          q,
          (snap) => {
            bucket.set(idx, snap.docs.map(d => ({ id: d.id, ...d.data() })));
            const merged = [];
            bucket.forEach(rows => merged.push(...rows));
            setTickets(merged);
          },
          (err) => {
            console.error("Organizer tickets listener failed:", err);
            bucket.set(idx, []);
            const merged = [];
            bucket.forEach(rows => merged.push(...rows));
            setTickets(merged);
          }
        );
      });

      return () => unsubs.forEach(unsub => unsub());
    }

    const q = query(collection(db, "tickets"), where("userId", "==", currentUser.uid));
    const unsub = onSnapshot(
      q,
      (snap) => setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error("Customer tickets listener failed:", err);
        setTickets([]);
      }
    );
    return () => unsub();
  }, [currentUser, organizerEvents]);

  useEffect(() => {
    if (currentUser?.role !== "organizer") {
      setOrganizerNotifications([]);
      return;
    }

    const q = query(
      collection(db, "organizerNotifications"),
      where("organizerId", "==", currentUser.uid),
      limit(50)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => {
          const aMs = new Date(a.createdAt || 0).getTime();
          const bMs = new Date(b.createdAt || 0).getTime();
          return bMs - aMs;
        });
        setOrganizerNotifications(rows.slice(0, 20));
      },
      (err) => {
        console.error("Organizer notifications listener failed:", err);
        setOrganizerNotifications([]);
      }
    );

    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (currentUser?.role !== "organizer") {
      setOrganizerAttendeeFeed([]);
      return;
    }

    const q = query(
      collection(db, "organizerAttendeeFeed"),
      where("organizerId", "==", currentUser.uid),
      limit(80)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        setOrganizerAttendeeFeed(rows.slice(0, 40));
      },
      (err) => {
        console.error("Organizer attendee feed listener failed:", err);
        setOrganizerAttendeeFeed([]);
      }
    );

    return () => unsub();
  }, [currentUser]);

  const login = async (email, password) => {
    try {
      const res = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, "users", res.user.uid));
      const userData = { uid: res.user.uid, ...snap.data() };
      setCurrentUser(userData);
      await claimCoOrganizerInvites(userData.uid, userData.email);
      notify(`Welcome back, ${userData.name.split(" ")[0]}!`);
      return { ok: true, role: userData.role };
    } catch { return { ok: false }; }
  };

  const claimCoOrganizerInvites = async (uid, email) => {
    try {
      if (!uid || !email) return;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch("/api/claim-co-organizer-invites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ uid, email: String(email).trim().toLowerCase() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) {
        console.warn("Could not claim co-organizer invites:", payload?.msg || "Request failed", payload?.debug || "");
      }
    } catch (err) {
      console.warn("Could not claim co-organizer invites:", err);
    }
  };

  const loginWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      const userRef = doc(db, "users", res.user.uid);
      const snap = await getDoc(userRef);
      const googlePhone = normalizePhone(res.user.phoneNumber || "");
      let userData;
      if (snap.exists()) {
        const existingData = snap.data() || {};
        const updates = {};
        if (!String(existingData.phone || "").trim() && googlePhone) updates.phone = googlePhone;
        if (Object.keys(updates).length > 0) {
          await updateDoc(userRef, updates);
        }
        userData = { uid: res.user.uid, ...existingData, ...updates };
      } else {
        // First time — create user doc
        const newUser = {
          name: res.user.displayName || "User",
          email: res.user.email,
          role: "customer",
          phone: googlePhone,
        };
        await setDoc(userRef, newUser);
        userData = { uid: res.user.uid, ...newUser };
      }
      setCurrentUser(userData);
      await claimCoOrganizerInvites(userData.uid, userData.email);
      if (!String(userData.phone || "").trim()) {
        notify("Signed in. Add your phone number to complete your profile.");
      } else {
        notify(`Welcome, ${userData.name.split(" ")[0]}!`);
      }
      return { ok: true, role: userData.role, needsPhone: !String(userData.phone || "").trim() };
    } catch (err) {
      console.error(err);
      return { ok: false };
    }
  };

  const register = async (name, email, password, role, phone = "") => {
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const res = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      const userData = { name: name.trim(), email: normalizedEmail, role: "customer", phone: normalizePhone(phone) };
      await setDoc(doc(db, "users", res.user.uid), userData);
      setCurrentUser({ uid: res.user.uid, ...userData });
      await claimCoOrganizerInvites(res.user.uid, normalizedEmail);
      notify(`Account created! Welcome, ${name.split(" ")[0]}!`);
      return { ok: true, role: "customer" };
    } catch (err) { console.error(err); return { ok: false }; }
  };

  const logout = async () => { await signOut(auth); setCurrentUser(null); };

  const purchaseTickets = async (eventId, cartSelections, paymentReference = null, buyer = null) => {
    // Always fetch event fresh from Firestore — avoids stale closure issues
    let event;
    try {
      const eventSnap = await getDoc(doc(db, "events", eventId));
      if (!eventSnap.exists()) {
        notify("Event not found. Please try again.", "error");
        return false;
      }
      event = { id: eventSnap.id, ...eventSnap.data() };
    } catch (err) {
      console.error("Failed to fetch event:", err);
      notify("Could not load event. Please try again.", "error");
      return false;
    }

    const newTickets = [];
    const SERVICE_FEE = 100;
    const orderSubtotal = event.tiers.reduce((s,t) => s + (cartSelections[t.id]||0) * Number(t.price), 0);
    const isFreeOrder = orderSubtotal === 0;
    const buyerName = buyer?.name || currentUser?.name || "Guest";
    const buyerEmail = (buyer?.email || currentUser?.email || "").trim().toLowerCase();
    const buyerPhone = normalizePhone(buyer?.phone || currentUser?.phone || "");
    const buyerUid = buyer?.uid || currentUser?.uid || `guest_${Date.now()}`;
    const isGuest = !buyer?.uid && !currentUser?.uid;
    // Step 1 — create ticket documents
    try {
      for (const tier of event.tiers) {
        const qty = cartSelections[tier.id] || 0;
        if (!qty) continue;
        for (let i = 0; i < qty; i++) {
          const ticketData = {
            eventId, eventTitle: event.title, eventDate: event.date,
            eventTime: event.time || "", venue: event.venue,
            tierId: tier.id, tierName: tier.name, price: Number(tier.price),
            userId: buyerUid, userName: buyerName,
            userEmail: buyerEmail,
            userPhone: buyerPhone,
            isGuest: isGuest || false,
            used: false, purchasedAt: new Date().toISOString(),
            ...(paymentReference
              ? { paymentReference, paymentProvider: "squad", paymentStatus: "paid" }
              : { paymentStatus: "free" }),
          };
          let ticketRef = null;
          for (let attempt = 0; attempt < 8; attempt++) {
            const nextId = generateShortTicketId();
            const candidateRef = doc(collection(db, "tickets"), nextId);
            const existing = await getDoc(candidateRef);
            if (!existing.exists()) {
              ticketRef = candidateRef;
              break;
            }
          }
          if (!ticketRef) throw new Error("Could not generate a unique ticket ID");
          await setDoc(ticketRef, ticketData);
          const newTicket = { id: ticketRef.id, ...ticketData };
          newTickets.push(newTicket);

          if (!paymentReference) {
            try {
              await addDoc(collection(db, "organizerAttendeeFeed"), {
                organizerId: event.organizer || "",
                eventId: event.id,
                eventTitle: event.title || "",
                paymentReference: "free",
                paymentProvider: "stagepro",
                amount: 0,
                currency: "NGN",
                attendeeName: buyerName,
                attendeeEmail: buyerEmail || "",
                attendeePhone: buyerPhone,
                status: "free",
                source: "app_free_ticket",
                createdAt: new Date().toISOString(),
              });
              logOrganizerLiveSheet(event.organizer || "", {
                type: "free_ticket",
                title: `Free ticket claimed for ${event.title}`,
                eventId: event.id,
                eventTitle: event.title,
                ticketId: ticketRef.id,
                tierName: tier.name,
                attendeeName: buyerName,
                attendeeEmail: buyerEmail || "",
                attendeePhone: buyerPhone || "",
                amount: 0,
                currency: "NGN",
                paymentReference: "free",
                paymentProvider: "stagepro",
                status: "free",
              }, event.id);
            } catch (feedErr) {
              console.warn("Could not write free-ticket attendee feed entry:", feedErr);
            }
          }

          // Fetch organiser name for personalised email
          let organizerName = "StagePro";
          try {
            const orgSnap = await getDoc(doc(db, "users", event.organizer));
            if (orgSnap.exists()) organizerName = orgSnap.data().name || "StagePro";
          } catch { /* non-critical */ }

          // Resolve theme colour for email banner
          const themeColors = {
            purple: "#6a11cb", fire: "#f83600", ocean: "#0575e6",
            forest: "#134e5e", gold: "#f7971e", rose: "#f953c6",
            midnight: "#232526", neon: "#00f260", sunset: "#f7971e",
            teal: "#11998e", royal: "#141e30",
          };
          const themeColor = themeColors[event.theme] || "#f5a623";

          sendTicketEmail({
            toEmail: buyerEmail,
            toName: buyerName,
            ticket: newTicket,
            eventImage: event.image || null,
            themeColor,
            organizerName,
          });
        }
      }
    } catch (err) {
      console.error("Ticket creation failed:", err);
      notify("Purchase failed. Please try again.", "error");
      return false;
    }
    // Step 2 — atomically increment soldCounts.{tierId} on the event doc
    try {
      const soldUpdate = {};
      for (const tier of event.tiers) {
        const qty = cartSelections[tier.id] || 0;
        if (!qty) continue;
        soldUpdate[`soldCounts.${tier.id}`] = increment(qty);
      }
      await updateDoc(doc(db, "events", eventId), soldUpdate);
    } catch (err) {
      console.warn("Could not update soldCounts:", err.code, err.message);
    }
    // Step 3 — re-fetch event to sync local state with Firestore
    try {
      const freshSnap = await getDoc(doc(db, "events", eventId));
      if (freshSnap.exists()) {
        setEvents(prev => prev.map(e => e.id !== eventId ? e : { id: freshSnap.id, ...freshSnap.data() }));
      }
    } catch {
      // fallback: optimistic local update
      setEvents(prev => prev.map(e => e.id !== eventId ? e : {
        ...e, tiers: e.tiers.map(t => ({ ...t, sold: (t.sold || 0) + (cartSelections[t.id] || 0) })),
      }));
    }
    notify(`${newTickets.length} ticket${newTickets.length > 1 ? "s" : ""} confirmed!`);
    // Store guest tickets in session so they can view them
    if (isGuest && newTickets.length > 0) {
      sessionStorage.setItem("guestTickets", JSON.stringify(newTickets.map(t => t.id)));
    }
    return newTickets.length > 0 ? newTickets : true;
  };

  // ── Core validate logic — reused by both ValidatePage and TicketPage ────
  const validateTicket = async (id) => {
    try {
      const ref = doc(db, "tickets", id.trim());
      const snap = await getDoc(ref);
      if (!snap.exists()) return { ok: false, msg: "Ticket not found" };
      const ticket = { id: snap.id, ...snap.data() };
      let ticketEvent = null;
      if (!currentUser || !["organizer", "admin"].includes(currentUser.role)) {
        return { ok: false, msg: "Only approved organizers can validate tickets" };
      }
      if (currentUser.role === "organizer") {
        const eventSnap = await getDoc(doc(db, "events", ticket.eventId));
        if (!eventSnap.exists()) {
          return { ok: false, msg: "Event not found for this ticket" };
        }
        ticketEvent = { id: eventSnap.id, ...eventSnap.data() };
        if (!isEventManager(ticketEvent, currentUser)) {
          return { ok: false, msg: "You can't validate tickets for another organizer's event" };
        }
      } else {
        const eventSnap = await getDoc(doc(db, "events", ticket.eventId));
        if (eventSnap.exists()) ticketEvent = { id: eventSnap.id, ...eventSnap.data() };
      }
      if (ticket.used) return { ok: false, msg: "Ticket already used", ticket };
      await updateDoc(ref, { used: true });
      setTickets(prev => prev.map(t => t.id === id.trim() ? { ...t, used: true } : t));
      logOrganizerLiveSheet(ticketEvent?.organizer || "", {
        type: "ticket_validation",
        title: `Ticket validated for ${ticket.eventTitle}`,
        eventId: ticket.eventId,
        eventTitle: ticket.eventTitle,
        ticketId: id.trim(),
        tierName: ticket.tierName || "",
        attendeeName: ticket.userName || "",
        attendeeEmail: ticket.userEmail || "",
        validatedBy: currentUser?.name || "",
        status: "used",
      }, ticket.eventId);
      return { ok: true, msg: "Valid! Entry granted", ticket: { ...ticket, used: true } };
    } catch {
      return { ok: false, msg: "Error checking ticket" };
    }
  };

  const resolveCoOrganizerUids = async (emails = []) => {
    const normalized = emails
      .map(v => String(v || "").trim().toLowerCase())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);

    if (!normalized.length) return { uids: [], foundEmails: [], missing: [], resolvedUsers: [] };

    const lookups = await Promise.all(normalized.map(async (email) => {
      try {
        const q = query(collection(db, "users"), where("email", "==", email));
        const snap = await getDocs(q);
        const docSnap = snap.docs[0];
        if (!docSnap) return { email, uid: null };
        return { email, uid: docSnap.id };
      } catch {
        return { email, uid: null };
      }
    }));

    const resolvedUsers = lookups
      .filter(item => item.uid && item.uid !== currentUser?.uid)
      .map(item => ({ email: item.email, uid: item.uid }));

    const uids = resolvedUsers
      .map(item => item.uid)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    const foundEmails = resolvedUsers.map(item => item.email).filter((v, i, arr) => arr.indexOf(v) === i);
    const missing = lookups.filter(item => !item.uid).map(item => item.email);
    return { uids, foundEmails, missing, resolvedUsers };
  };

  const notifyCoOrganizers = async ({ eventId, eventTitle, recipients = [] }) => {
    if (!eventId || !eventTitle || recipients.length === 0) {
      return { ok: true, skipped: true, sent: 0, failed: 0, inAppSent: 0, inAppFailed: 0 };
    }
    const uniqueRecipients = recipients
      .map(r => ({ email: String(r.email || "").trim().toLowerCase(), uid: r.uid || null }))
      .filter(r => r.email)
      .filter((r, i, arr) => arr.findIndex(x => x.email === r.email) === i);

    try {
      const res = await fetch("/api/send-co-organizer-invite-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          eventTitle,
          recipients: uniqueRecipients.map(r => ({ email: r.email, uid: r.uid || null })),
          senderName: currentUser?.name || "StagePro Organizer",
          origin: window.location.origin,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) {
        throw new Error(payload.msg || "Could not deliver co-organizer notifications");
      }
      return payload;
    } catch (err) {
      console.warn("Could not send co-organizer invite emails:", err);
      return { ok: false, msg: err?.message || "Could not deliver co-organizer notifications", sent: 0, failed: uniqueRecipients.length, inAppSent: 0, inAppFailed: uniqueRecipients.filter(r => r.uid).length };
    }
  };

  const issueComplimentaryTickets = async ({ eventId, tierId, qty, attendeeName, attendeeEmail }) => {
    try {
      if (currentUser?.role !== "organizer") {
        return { ok: false, msg: "Only organizers can issue complimentary tickets." };
      }

      const quantity = Number(qty);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return { ok: false, msg: "Quantity must be a whole number greater than 0." };
      }

      const eventSnap = await getDoc(doc(db, "events", eventId));
      if (!eventSnap.exists()) return { ok: false, msg: "Event not found." };
      const event = { id: eventSnap.id, ...eventSnap.data() };
      if (!isEventManager(event, currentUser)) {
        return { ok: false, msg: "You can only issue tickets for events you manage." };
      }

      const tier = event.tiers.find(t => t.id === tierId);
      if (!tier) return { ok: false, msg: "Selected tier was not found." };

      const existingTicketsSnap = await getDocs(query(collection(db, "tickets"), where("eventId", "==", event.id)));
      const alreadySold = existingTicketsSnap.docs.reduce((count, docSnap) => {
        const ticket = docSnap.data() || {};
        return String(ticket.tierId || "") === tierId ? count + 1 : count;
      }, 0);
      const available = Math.max(0, Number(tier.total || 0) - alreadySold);
      if (quantity > available) {
        return { ok: false, msg: `Only ${available} ticket(s) left in this tier.` };
      }

      const cleanName = String(attendeeName || "").trim() || "Complimentary Guest";
      const cleanEmail = String(attendeeEmail || "").trim().toLowerCase();
      const syntheticUserId = cleanEmail ? `comp_${cleanEmail}` : `comp_${Date.now()}`;
      const nowIso = new Date().toISOString();
      const created = [];

      for (let i = 0; i < quantity; i++) {
        let ticketRef = null;
        for (let attempt = 0; attempt < 8; attempt++) {
          const nextId = generateShortTicketId();
          const candidateRef = doc(collection(db, "tickets"), nextId);
          const existing = await getDoc(candidateRef);
          if (!existing.exists()) {
            ticketRef = candidateRef;
            break;
          }
        }
        if (!ticketRef) throw new Error("Could not generate a unique complimentary ticket ID");

        const ticketData = {
          eventId: event.id,
          eventTitle: event.title,
          eventDate: event.date,
          eventTime: event.time || "",
          venue: event.venue,
          tierId: tier.id,
          tierName: tier.name,
          price: 0,
          userId: syntheticUserId,
          userName: cleanName,
          userEmail: cleanEmail,
          isGuest: !cleanEmail,
          used: false,
          purchasedAt: nowIso,
          paymentStatus: "complimentary",
          complimentary: true,
          issuedByOrganizerId: currentUser.uid,
        };

        await setDoc(ticketRef, ticketData);
        created.push({ id: ticketRef.id, ...ticketData });

        try {
          await addDoc(collection(db, "organizerAttendeeFeed"), {
            organizerId: currentUser.uid,
            eventId: event.id,
            eventTitle: event.title || "",
            paymentReference: "complimentary",
            paymentProvider: "stagepro",
            amount: 0,
            currency: "NGN",
            attendeeName: cleanName,
            attendeeEmail: cleanEmail || "",
            status: "complimentary",
            source: "app_complimentary_ticket",
            createdAt: new Date().toISOString(),
          });
          logOrganizerLiveSheet(currentUser.uid, {
            type: "complimentary_ticket",
            title: `Complimentary ticket issued for ${event.title}`,
            eventId: event.id,
            eventTitle: event.title,
            ticketId: ticketRef.id,
            tierName: tier.name,
            attendeeName: cleanName,
            attendeeEmail: cleanEmail || "",
            amount: 0,
            currency: "NGN",
            paymentReference: "complimentary",
            paymentProvider: "stagepro",
            status: "complimentary",
          }, event.id);
        } catch (feedErr) {
          console.warn("Could not write complimentary attendee feed entry:", feedErr);
        }
      }

      setTickets(prev => [...created, ...prev]);

      return { ok: true, count: created.length };
    } catch (err) {
      console.error("Complimentary ticket issuance failed:", err);
      return { ok: false, msg: "Could not issue complimentary tickets right now." };
    }
  };

  const createEvent = async (eventData) => {
    try {
      const nowIso = new Date().toISOString();
      const requestedCoEmails = parseEmailList(eventData.coOrganizerEmailsText || "");
      const resolved = await resolveCoOrganizerUids(requestedCoEmails);
      const eventLiveSheet = {
        webhookUrl: normalizeHttpUrl(eventData.liveSheet?.webhookUrl || eventData.liveSheetWebhookUrl || ""),
        viewUrl: normalizeHttpUrl(eventData.liveSheet?.viewUrl || eventData.liveSheetViewUrl || ""),
      };
      const data = {
        ...eventData,
        image: normalizeEventImageUrl(eventData.image) || DEFAULT_EVENT_IMAGE,
        organizer: currentUser.uid,
        coOrganizers: resolved.uids,
        coOrganizerEmails: requestedCoEmails,
        coOrganizerInviteEmails: resolved.missing,
        visibility: eventData.visibility || "public",
        liveSheet: eventLiveSheet,
        createdAt: nowIso,
        updatedAt: nowIso,
        tiers: eventData.tiers.map((t, i) => ({
          id: `t${i+1}`, name: t.name, price: Number(t.price), total: Number(t.total), sold: 0,
        })),
      };
      delete data.coOrganizerEmailsText;
      delete data.liveSheetWebhookUrl;
      delete data.liveSheetViewUrl;
      const ref = await addDoc(collection(db, "events"), data);
      const newEvent = { id: ref.id, ...data };
      setEvents(prev => [...prev, newEvent]);
      const inviteResult = await notifyCoOrganizers({
        eventId: ref.id,
        eventTitle: data.title,
        recipients: requestedCoEmails.map(email => ({
          email,
          uid: (resolved.resolvedUsers.find(item => item.email === email) || {}).uid || null,
        })),
      });
      if (inviteResult?.ok && !inviteResult?.skipped) {
        notify(`Co-organizer alerts sent: email ${inviteResult.sent}, in-app ${inviteResult.inAppSent}.`);
      } else if (!inviteResult?.ok) {
        notify(`Co-organizer invite delivery issue: ${inviteResult?.msg || "Could not send notifications."}`, "error");
      }
      if (resolved.missing.length > 0) {
        notify(`Co-organizer invites saved for pending emails: ${resolved.missing.join(", ")}`);
      }
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
      const currentEvent = events.find(e => e.id === eventId) || organizerEvents.find(e => e.id === eventId) || null;
      const requestedCoEmails = parseEmailList(eventData.coOrganizerEmailsText || "");
      const resolved = await resolveCoOrganizerUids(requestedCoEmails);
      const eventLiveSheet = {
        webhookUrl: normalizeHttpUrl(eventData.liveSheet?.webhookUrl || eventData.liveSheetWebhookUrl || ""),
        viewUrl: normalizeHttpUrl(eventData.liveSheet?.viewUrl || eventData.liveSheetViewUrl || ""),
      };
      const data = {
        ...eventData,
        image: normalizeEventImageUrl(eventData.image),
        coOrganizers: resolved.uids,
        coOrganizerEmails: requestedCoEmails,
        coOrganizerInviteEmails: resolved.missing,
        visibility: eventData.visibility || "public",
        liveSheet: eventLiveSheet,
        updatedAt: new Date().toISOString(),
        tiers: eventData.tiers.map((t, i) => ({
          id: t.id || `t${i+1}`, name: t.name, price: Number(t.price), total: Number(t.total), sold: t.sold||0,
        })),
      };
      delete data.coOrganizerEmailsText;
      delete data.liveSheetWebhookUrl;
      delete data.liveSheetViewUrl;
      await updateDoc(doc(db, "events", eventId), data);
      setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...data } : e));
      if (requestedCoEmails.length > 0) {
        const inviteResult = await notifyCoOrganizers({
          eventId,
          eventTitle: data.title || currentEvent?.title || "Event",
          recipients: requestedCoEmails.map(email => ({
            email,
            uid: (resolved.resolvedUsers.find(item => item.email === email) || {}).uid || null,
          })),
        });
        if (inviteResult?.ok && !inviteResult?.skipped) {
          notify(`Co-organizer alerts sent: email ${inviteResult.sent}, in-app ${inviteResult.inAppSent}.`);
        } else if (!inviteResult?.ok) {
          notify(`Co-organizer invite delivery issue: ${inviteResult?.msg || "Could not send notifications."}`, "error");
        }
      }
      if (resolved.missing.length > 0) {
        notify(`Co-organizer invites saved for pending emails: ${resolved.missing.join(", ")}`);
      }
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
      const currentTicket = tickets.find(t => t.id === ticketId) || null;
      const normalizedEmail = toEmail.trim().toLowerCase();

      // Prevent self-transfer early (no Firestore call needed)
      if (normalizedEmail === currentUser.email.toLowerCase()) {
        return { ok: false, msg: "You can't transfer a ticket to yourself." };
      }

      // Query users by email — requires Firestore rule: allow read: if request.auth != null
      const q = query(collection(db, "users"), where("email", "==", normalizedEmail));
      const snap = await getDocs(q);

      // Also try original casing in case email was stored non-lowercase
      let recipientDoc = snap.docs[0];
      if (!recipientDoc) {
        const q2 = query(collection(db, "users"), where("email", "==", toEmail.trim()));
        const snap2 = await getDocs(q2);
        recipientDoc = snap2.docs[0];
      }

      if (!recipientDoc) {
        return { ok: false, msg: "No StagePro account found with that email address." };
      }

      const recipient = { id: recipientDoc.id, ...recipientDoc.data() };
      if (recipient.id === currentUser.uid) {
        return { ok: false, msg: "You can't transfer a ticket to yourself." };
      }

      await updateDoc(doc(db, "tickets", ticketId), {
        userId: recipient.id,
        userName: recipient.name,
      });

      if (currentTicket?.eventId) {
        const eventSnap = await getDoc(doc(db, "events", currentTicket.eventId));
        if (eventSnap.exists()) {
          const event = { id: eventSnap.id, ...eventSnap.data() };
        }
      }

      setTickets(prev => prev.filter(t => t.id !== ticketId));
      notify(`Ticket transferred to ${recipient.name}!`);
      return { ok: true };
    } catch (err) {
      console.error("Transfer error:", err);
      if (err.code === "permission-denied") {
        return { ok: false, msg: "Permission denied. Make sure your Firestore rules allow reading users." };
      }
      return { ok: false, msg: "Transfer failed. Please try again." };
    }
  };

  if (authLoading) return <><style>{STYLE}</style><Spinner /></>;

  const refreshEvents = async () => {
    try {
      const snapshot = await getDocs(collection(db, "events"));
      setEvents(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      if (currentUser?.role === "organizer") {
        const ownedQ = query(collection(db, "events"), where("organizer", "==", currentUser.uid));
        const collabQ = query(collection(db, "events"), where("coOrganizers", "array-contains", currentUser.uid));
        const collabEmailQ = query(collection(db, "events"), where("coOrganizerEmails", "array-contains", (currentUser.email || "").toLowerCase()));
        const inviteEmailQ = query(collection(db, "events"), where("coOrganizerInviteEmails", "array-contains", (currentUser.email || "").toLowerCase()));
        const [ownedSnap, collabSnap, collabEmailSnap, inviteEmailSnap] = await Promise.all([getDocs(ownedQ), getDocs(collabQ), getDocs(collabEmailQ), getDocs(inviteEmailQ)]);
        const mergedMap = new Map();
        ownedSnap.docs.forEach(d => mergedMap.set(d.id, { id: d.id, ...d.data() }));
        collabSnap.docs.forEach(d => mergedMap.set(d.id, { id: d.id, ...d.data() }));
        collabEmailSnap.docs.forEach(d => mergedMap.set(d.id, { id: d.id, ...d.data() }));
        inviteEmailSnap.docs.forEach(d => mergedMap.set(d.id, { id: d.id, ...d.data() }));
        setOrganizerEvents(Array.from(mergedMap.values()));
      }
    } catch (err) { console.error(err); }
  };

  const updateProfile = async ({ name, phone, payoutDetails, liveSheet }) => {
    try {
      const updates = {};
      if (typeof name === "string") updates.name = name.trim();
      if (typeof phone === "string") updates.phone = normalizePhone(phone);
      if (payoutDetails) updates.payoutDetails = payoutDetails;
      if (liveSheet) updates.liveSheet = liveSheet;
      await updateDoc(doc(db, "users", currentUser.uid), updates);
      setCurrentUser(prev => ({ ...prev, ...updates }));
      notify("Profile updated!");
      return { ok: true };
    } catch (err) {
      console.error(err);
      notify("Failed to update profile.", "error");
      return { ok: false };
    }
  };

  const submitReview = async (eventId, { rating, comment }) => {
    try {
      const reviewData = {
        eventId, userId: currentUser.uid, userName: currentUser.name,
        rating, comment: comment.trim(),
        createdAt: new Date().toISOString(),
      };
      const ref = await addDoc(collection(db, "reviews"), reviewData);
      notify("Review submitted! Thanks");
      return { ok: true, id: ref.id };
    } catch (err) {
      console.error(err);
      notify("Failed to submit review.", "error");
      return { ok: false };
    }
  };

  const joinWaitlist = async (eventId, tierId) => {
    try {
      // Check if already on waitlist
      const q = query(collection(db, "waitlist"),
        where("eventId","==",eventId),
        where("tierId","==",tierId),
        where("userId","==",currentUser.uid)
      );
      const existing = await getDocs(q);
      if (!existing.empty) return { ok: false, msg: "You're already on the waitlist for this tier." };
      const event = events.find(e => e.id === eventId);
      const tier = event?.tiers?.find(t => t.id === tierId);
      await addDoc(collection(db, "waitlist"), {
        eventId, tierId, tierName: tier?.name||"",
        eventTitle: event?.title||"",
        userId: currentUser.uid, userName: currentUser.name, userEmail: currentUser.email,
        joinedAt: new Date().toISOString(), notified: false,
      });
      notify("You're on the waitlist! We'll notify you if a spot opens.");
      return { ok: true };
    } catch (err) {
      console.error(err);
      return { ok: false, msg: "Failed to join waitlist." };
    }
  };

  const syncEventLiveSheet = async (eventId) => {
    try {
      const event = organizerEvents.find(e => e.id === eventId) || events.find(e => e.id === eventId) || null;
      if (!event) return { ok: false, msg: "Event not found." };

      const eventConfig = getEventLiveSheetConfig(event);
      const organizerFallbackWebhook = normalizeHttpUrl(currentUser?.liveSheet?.webhookUrl || currentUser?.liveSheetWebhookUrl || "");
      if (!eventConfig.webhookUrl && !organizerFallbackWebhook) {
        return { ok: false, msg: "Add an event sheet webhook or organizer fallback first." };
      }

      const eventTickets = tickets
        .filter(ticket => ticket.eventId === eventId)
        .sort((a, b) => new Date(a.purchasedAt || 0).getTime() - new Date(b.purchasedAt || 0).getTime());

      if (!eventTickets.length) {
        return { ok: false, msg: "No tickets found for this event yet." };
      }

      let sent = 0;
      const chunkSize = 20;
      for (let i = 0; i < eventTickets.length; i += chunkSize) {
        const chunk = eventTickets.slice(i, i + chunkSize);
        const results = await Promise.allSettled(
          chunk.map((ticket) =>
            logOrganizerLiveSheet(event.organizer || currentUser.uid, {
              type: "ticket_sync",
              title: `Ticket synced for ${event.title}`,
              eventId: event.id,
              eventTitle: event.title,
              ticketId: ticket.id,
              tierName: ticket.tierName || "",
              attendeeName: ticket.userName || "",
              attendeeEmail: ticket.userEmail || "",
              attendeePhone: ticket.userPhone || "",
              amount: Number(ticket.price || 0),
              currency: ticket.currency || "NGN",
              status: ticket.used ? "used" : (ticket.paymentStatus || (Number(ticket.price || 0) > 0 ? "paid" : "free")),
              paymentReference: ticket.paymentReference || "",
              paymentProvider: ticket.paymentProvider || "stagepro",
              purchasedAt: ticket.purchasedAt || "",
              validatedBy: ticket.used ? "historical_sync" : "",
              source: "tickets_collection_sync",
            }, event.id)
          )
        );
        sent += results.filter(result => result.status === "fulfilled").length;
      }

      return { ok: true, count: sent };
    } catch (err) {
      console.error("Live sheet sync failed:", err);
      return { ok: false, msg: "Could not sync this event to the live sheet." };
    }
  };

  const ctx = { currentUser, events, publicSoldCounts, organizerEvents, tickets, organizerNotifications, organizerAttendeeFeed, eventsLoading, notify, login, loginWithGoogle, register, logout, purchaseTickets, validateTicket, issueComplimentaryTickets, createEvent, updateEvent, deleteEvent, transferTicket, refreshEvents, updateProfile, submitReview, joinWaitlist, syncEventLiveSheet };

  return (
    <BrowserRouter>
      <Nav currentUser={currentUser} logout={logout} notification={notification} events={events} />
      <main style={{ minHeight:"calc(100vh - 60px)" }}>
        <Routes>
          <Route path="/" element={<HomePage ctx={ctx} />} />
          <Route path="/login" element={<AuthPage mode="login" ctx={ctx} />} />
          <Route path="/register" element={<AuthPage mode="register" ctx={ctx} />} />
          <Route path="/event/:eventId" element={<EventPage ctx={ctx} />} />
          <Route path="/event/:eventId/checkout" element={<CheckoutPage ctx={ctx} />} />
          <Route path="/payment/verify" element={<PaymentVerificationPage ctx={ctx} />} />
          <Route path="/tickets" element={currentUser ? <MyTicketsPage ctx={ctx} /> : <Navigate to="/login" />} />
          <Route path="/ticket/:ticketId" element={<TicketPage ctx={ctx} />} />
          <Route path="/find-tickets" element={<GuestTicketLookupPage />} />
          <Route path="/dashboard" element={currentUser?.role === "organizer" || currentUser?.role === "admin" ? <DashboardPage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/dashboard/create" element={currentUser?.role === "organizer" ? <CreateEventPage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/dashboard/edit/:eventId" element={currentUser?.role === "organizer" ? <EditEventPage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/dashboard/analytics/:eventId" element={currentUser?.role === "organizer" ? <AnalyticsPage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/validate" element={currentUser?.role === "organizer" ? <ValidatePage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/admin" element={currentUser?.role === "admin" ? <AdminHomePage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/admin/payouts" element={currentUser?.role === "admin" ? <AdminPayoutsPage ctx={ctx} /> : <Navigate to="/" />} />
          <Route path="/profile" element={currentUser ? <ProfilePage ctx={ctx} /> : <Navigate to="/login" />} />
          <Route path="/event/:eventId/reviews" element={<ReviewsPage ctx={ctx} />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/cookies" element={<CookiesPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/contact" element={<ContactPage />} />
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
            <span style={{ fontFamily:"Oswald", fontSize:28, color:"var(--gold)", letterSpacing:1 }}>STAGE</span>
            <span style={{ fontFamily:"Oswald", fontSize:28, color:"var(--text)", letterSpacing:1 }}>PRO</span>
          </div>
          <p style={{ color:"var(--muted)", fontSize:14, lineHeight:1.8, maxWidth:280, marginBottom:24 }}>
            Nigeria's premier event ticketing platform. Discover, book, and manage tickets for concerts, festivals, and sporting events.
          </p>
          {/* Social icons */}
          <div className="footer-social" style={{ display:"flex", gap:10 }}>
            {[
              { label:"Twitter / X", icon:<i className="fa-brands fa-x-twitter" />, href:"#" },
              { label:"Instagram", icon:<i className="fa-brands fa-instagram" />, href:"#" },
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
          <div className="footer-section-title" style={{ fontFamily:"Oswald", fontSize:16, letterSpacing:1, color:"var(--text)", marginBottom:20 }}>DISCOVER</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {[["Browse Events","/"],["Concerts","/"],["Festivals","/"],["Sports","/"]].map(([label, href]) => (
              <Link key={label} to={href} className="footer-link" style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
                onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
              >{label}</Link>
            ))}
          </div>
        </div>

        {/* Organizers column */}
        <div>
          <div className="footer-section-title" style={{ fontFamily:"Oswald", fontSize:16, letterSpacing:1, color:"var(--text)", marginBottom:20 }}>ORGANIZERS</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {[["Create Event","/dashboard/create"],["Dashboard","/dashboard"],["Scan Tickets","/validate"],["Sign Up","/register"]].map(([label, href]) => (
              <Link key={label} to={href} className="footer-link" style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
                onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
              >{label}</Link>
            ))}
          </div>
        </div>

        {/* Support column */}
        <div>
          <div className="footer-section-title" style={{ fontFamily:"Oswald", fontSize:16, letterSpacing:1, color:"var(--text)", marginBottom:20 }}>SUPPORT</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Link to="/help" className="footer-link" style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >Help Centre</Link>
            <Link to="/find-tickets" className="footer-link" style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >Find My Tickets</Link>
            <Link to="/contact" className="footer-link" style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >Contact Us</Link>
            <Link to="/terms" className="footer-link" style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >Terms of Service</Link>
            <Link to="/privacy" className="footer-link" style={{ color:"var(--muted)", fontSize:14, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >Privacy Policy</Link>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop:"1px solid var(--border)" }} />

      {/* Bottom bar */}
      <div className="footer-bottom" style={{ maxWidth:1200, margin:"0 auto", padding:"20px 32px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <p style={{ color:"var(--muted)", fontSize:13 }}>
          © {year} StagePro. All rights reserved. Made in Nigeria
        </p>
        <div className="footer-bottom-links" style={{ display:"flex", gap:20 }}>
          {[["Terms","/terms"],["Privacy","/privacy"],["Cookies","/cookies"]].map(([label, href]) => (
            <Link key={label} to={href} className="footer-link" style={{ color:"var(--muted)", fontSize:13, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="var(--gold)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >{label}</Link>
          ))}
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
      <div style={{ fontSize:64 }}><i className="fa-solid fa-circle-xmark" style={{color:"var(--red)"}} /></div>
      <h2 style={{ fontFamily:"Oswald", fontSize:40, color:"var(--red)" }}>TICKET NOT FOUND</h2>
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
        <div style={{ fontSize:48, marginBottom:8 }}>{alreadyUsed ? <i className="fa-solid fa-circle-xmark" style={{color:"var(--red)"}} /> : <i className="fa-solid fa-circle-check" style={{color:"var(--green)"}} />}</div>
        <div style={{ fontFamily:"Oswald", fontSize:36, color: alreadyUsed ? "var(--red)" : "var(--green)" }}>
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
          <div style={{ fontFamily:"Oswald", fontSize:32, lineHeight:1, marginBottom:4 }}>{ticket.eventTitle}</div>
        </div>
        <div style={{ padding:"20px 24px", display:"grid", gap:16 }}>
          {[
            ["Tier", ticket.tierName],
            ["Date", fmtDate(ticket.eventDate)],
            ["Time", ticket.eventTime],
            ["Venue", ticket.venue],
            ["Holder", ticket.userName],
            ["Price", fmt(ticket.price)],
          ].map(([label, value]) => (
            <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:14 }}>
              <span style={{ color:"var(--muted)" }}>{label}</span>
              <span style={{ fontWeight:600, textAlign:"right", maxWidth:"60%" }}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{ padding:"16px 24px", borderTop:"1px solid var(--border)", background:"var(--bg3)" }}>
          <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:4 }}>TICKET ID</div>
          <div style={{ fontFamily:"IBM Plex Mono", fontSize:12, color:"var(--gold)", wordBreak:"break-all" }}>{ticket.id}</div>
        </div>
      </div>

      {!isOrganizer && (
        <div style={{ display:"flex", gap:10, marginBottom:12 }}>
          <button
            onClick={() => downloadTicketFile(ticket)}
            style={{ flex:1, padding:"14px 18px", background:"var(--gold)", color:"#000", border:"none", borderRadius:12, fontFamily:"Oswald", fontSize:22, letterSpacing:2, cursor:"pointer" }}
          >
            <i className="fa-solid fa-download" style={{ marginRight:8 }} />
            DOWNLOAD TICKET
          </button>
          <div style={{ flexShrink:0 }}>
            <ShareButton url={`${window.location.origin}/ticket/${ticket.id}`} label="Share" />
          </div>
        </div>
      )}

      {/* Organizer: validate button */}
      {isOrganizer && !alreadyUsed && !result && (
        <button
          onClick={handleValidate}
          disabled={validating}
          style={{ width:"100%", padding:18, background:"var(--green)", color:"#000", border:"none", borderRadius:12, fontFamily:"Oswald", fontSize:24, letterSpacing:2, cursor: validating?"not-allowed":"pointer", opacity: validating?0.7:1, marginBottom:12 }}
        >
          {validating ? "VALIDATING..." : "MARK AS USED — GRANT ENTRY"}
        </button>
      )}

      {/* Result after organizer validates */}
      {result && (
        <div style={{ background: result.ok?"rgba(61,220,132,0.1)":"rgba(232,64,64,0.1)", border:`1px solid ${result.ok?"var(--green)":"var(--red)"}`, borderRadius:12, padding:20, textAlign:"center", animation:"fadeUp 0.3s ease", marginBottom:12 }}>
          <div style={{ fontFamily:"Oswald", fontSize:28, color: result.ok?"var(--green)":"var(--red)" }}>
            {result.ok ? <><i className="fa-solid fa-circle-check" style={{marginRight:8}} />ENTRY GRANTED</> : <><i className="fa-solid fa-circle-xmark" style={{marginRight:8}} />{result.msg}</>}
          </div>
        </div>
      )}

      {/* Organizer: already used notice */}
      {isOrganizer && alreadyUsed && (
        <div style={{ background:"rgba(232,64,64,0.1)", border:"1px solid var(--red)", borderRadius:12, padding:20, textAlign:"center", marginBottom:12 }}>
          <div style={{ fontFamily:"Oswald", fontSize:24, color:"var(--red)" }}><i className="fa-solid fa-ban" style={{marginRight:8}} />DO NOT ALLOW ENTRY</div>
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
  const { events, publicSoldCounts, tickets, eventsLoading } = ctx;
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [location, setLocation] = useState("");
  const [sortBy, setSortBy]     = useState("date"); // date | price | name

  const cats = ["All", "Concert", "Festival", "Sports", "Comedy", "Conference"];

  const hasAdvanced = dateFrom || dateTo || priceMin || priceMax || location;

  const clearAll = () => {
    setSearch(""); setFilter("All");
    setDateFrom(""); setDateTo("");
    setPriceMin(""); setPriceMax("");
    setLocation(""); setSortBy("date");
  };

  const filtered = events
    .filter(e => (e.visibility || "public") === "public")
    .filter(e => filter === "All" || e.category === filter)
    .filter(e => {
      const q = search.toLowerCase();
      return !q || e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q) || (e.subtitle||"").toLowerCase().includes(q);
    })
    .filter(e => {
      if (location) {
        const l = location.toLowerCase();
        return e.venue.toLowerCase().includes(l) || (e.city||"").toLowerCase().includes(l);
      }
      return true;
    })
    .filter(e => {
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo   && e.date > dateTo)   return false;
      return true;
    })
    .filter(e => {
      const minPrice = Math.min(...e.tiers.map(t => Number(t.price)));
      if (priceMin && minPrice < Number(priceMin)) return false;
      if (priceMax && minPrice > Number(priceMax)) return false;
      return true;
    })
    .sort((a,b) => {
      if (sortBy === "date")  return new Date(a.date) - new Date(b.date);
      if (sortBy === "price") return Math.min(...a.tiers.map(t=>t.price)) - Math.min(...b.tiers.map(t=>t.price));
      if (sortBy === "name")  return a.title.localeCompare(b.title);
      return 0;
    });

  if (eventsLoading) return <Spinner />;

  return (
    <div style={{ maxWidth:1200, margin:"0 auto", padding:"48px 24px" }}>
      <div style={{ textAlign:"center", marginBottom:64, animation:"fadeUp 0.6s ease" }}>
        <div style={{ fontSize:13, letterSpacing:2, color:"var(--gold)", textTransform:"uppercase", marginBottom:16, fontWeight:600 }}>Nigeria's Premier Ticketing Platform</div>
        <h1 style={{ fontSize:"clamp(56px,10vw,120px)", lineHeight:0.9, marginBottom:24 }}>
          YOUR NEXT<br />
          <span style={{ color:"var(--gold)", WebkitTextStroke:"2px var(--gold)", WebkitTextFillColor:"transparent" }}>EXPERIENCE</span>
          <br />AWAITS
        </h1>
        <p style={{ color:"var(--muted)", maxWidth:480, margin:"0 auto", lineHeight:1.7 }}>
          Discover concerts, festivals, and sporting events. Secure tickets with instant QR delivery.
        </p>
      </div>

      {/* Search bar + filter toggle */}
      <div style={{ maxWidth:700, margin:"0 auto 20px" }}>
        <div style={{ display:"flex", gap:10 }}>
          <div style={{ position:"relative", flex:1 }}>
            <i className="fa-solid fa-magnifying-glass" style={{ position:"absolute", left:18, top:"50%", transform:"translateY(-50%)", fontSize:15, color:"var(--muted)", pointerEvents:"none" }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search events, artists, venues..."
              style={{ width:"100%", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:100, padding:"14px 20px 14px 48px", color:"var(--text)", fontSize:15, outline:"none", transition:"border 0.2s" }}
              onFocus={e => e.target.style.borderColor="var(--gold)"}
              onBlur={e => e.target.style.borderColor="var(--border)"}
            />
            {search && <button onClick={() => setSearch("")} style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:18 }}>×</button>}
          </div>
          <button onClick={() => setShowFilters(p=>!p)}
            style={{ background: hasAdvanced||showFilters?"var(--gold)":"var(--bg2)", color: hasAdvanced||showFilters?"#000":"var(--muted)", border:"1px solid var(--border)", borderRadius:100, padding:"0 20px", cursor:"pointer", fontWeight:600, fontSize:13, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6, transition:"all 0.2s" }}
          >
            <i className="fa-solid fa-sliders" style={{marginRight:6}} />Filters {hasAdvanced && <span style={{ background:"rgba(0,0,0,0.2)", borderRadius:100, padding:"1px 7px", fontSize:11 }}>{[dateFrom,dateTo,priceMin,priceMax,location].filter(Boolean).length}</span>}
          </button>
        </div>

        {/* Advanced filter panel */}
        {showFilters && (
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:24, marginTop:12, animation:"fadeUp 0.25s ease" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:16, marginBottom:16 }}>
              {/* Location */}
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}><i className="fa-solid fa-location-dot" style={{marginRight:5}} />LOCATION / VENUE</label>
                <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Lagos, Abuja..."
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
              </div>
              {/* Date from */}
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}><i className="fa-regular fa-calendar" style={{marginRight:5}} />DATE FROM</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
              </div>
              {/* Date to */}
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}><i className="fa-regular fa-calendar" style={{marginRight:5}} />DATE TO</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
              </div>
              {/* Price min */}
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}><i className="fa-solid fa-naira-sign" style={{marginRight:5}} />MIN PRICE (₦)</label>
                <input type="number" min="0" value={priceMin} onChange={e => setPriceMin(e.target.value)} placeholder="0"
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
              </div>
              {/* Price max */}
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}><i className="fa-solid fa-naira-sign" style={{marginRight:5}} />MAX PRICE (₦)</label>
                <input type="number" min="0" value={priceMax} onChange={e => setPriceMax(e.target.value)} placeholder="Any"
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
              </div>
              {/* Sort */}
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}><i className="fa-solid fa-arrow-up-arrow-down" style={{marginRight:5}} />SORT BY</label>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }}>
                  <option value="date">Date (Soonest)</option>
                  <option value="price">Price (Lowest)</option>
                  <option value="name">Name (A–Z)</option>
                </select>
              </div>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={clearAll} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:"8px 18px", borderRadius:8, cursor:"pointer", fontSize:13 }}>Clear All</button>
              <button onClick={() => setShowFilters(false)} style={{ background:"var(--gold)", color:"#000", border:"none", padding:"8px 18px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:13 }}>Apply</button>
            </div>
          </div>
        )}
      </div>

      {/* Category filters */}
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
        {cats.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{ background: filter===c?"var(--gold)":"var(--bg3)", color: filter===c?"#000":"var(--muted)", border:`1px solid ${filter===c?"var(--gold)":"var(--border)"}`, padding:"8px 20px", borderRadius:100, cursor:"pointer", fontWeight:600, fontSize:13, transition:"all 0.2s" }}>{c}</button>
        ))}
      </div>

      {/* Results count */}
      <div style={{ fontSize:13, color:"var(--muted)", marginBottom:24 }}>
        {filtered.length} event{filtered.length!==1?"s":""} found
        {(search||hasAdvanced||filter!=="All") && <button onClick={clearAll} style={{ marginLeft:12, background:"none", border:"none", color:"var(--gold)", cursor:"pointer", fontSize:13, textDecoration:"underline" }}>Clear all filters</button>}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign:"center", padding:"80px 24px", color:"var(--muted)" }}>
          <div style={{ fontSize:48, marginBottom:16 }}><i className="fa-solid fa-magnifying-glass" style={{color:"var(--muted)"}} /></div>
          <div style={{ fontFamily:"Oswald", fontSize:28, color:"var(--text)", marginBottom:8 }}>NO RESULTS FOUND</div>
          <p>Try adjusting your search or filters</p>
          <button onClick={clearAll} style={{ marginTop:16, background:"var(--gold)", color:"#000", border:"none", padding:"10px 24px", borderRadius:8, cursor:"pointer", fontWeight:700 }}>Clear Filters</button>
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
  // soldCounts live on the event doc and are kept fresh by the onSnapshot listener
  const totalSold = event.tiers.reduce((s, t) => s + getSold(event, t.id), 0);
  const totalCap = event.tiers.reduce((s,t) => s+t.total, 0);
  const pct = Math.round((totalSold/totalCap)*100);
  const hasImage = !!event.image;
  const bg = getEventBg(event);

  return (
          <Link to={eventPath(event)} style={{ display:"block", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden", transition:"transform 0.3s, border-color 0.3s", animation:`fadeUp 0.5s ${index*0.1}s ease both` }}
      onMouseEnter={e => { e.currentTarget.style.transform="translateY(-4px)"; e.currentTarget.style.borderColor="var(--gold-dim)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform=""; e.currentTarget.style.borderColor="var(--border)"; }}
    >
      <div style={{ height:200, overflow:"hidden", position:"relative", background: hasImage?"var(--bg3)":bg, backgroundSize:"cover", backgroundPosition:"center" }}>
        {hasImage
          ? <img
              src={getEventImageSrc(event)}
              alt={event.title}
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = DEFAULT_EVENT_IMAGE;
              }}
              style={{ width:"100%", height:"100%", objectFit:"cover" }}
            />
          : <div style={{ position:"absolute", inset:0, background:bg }} />
        }
        <div style={{ position:"absolute", top:12, left:12, background:"var(--gold)", color:"#000", fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:100 }}>{event.category?.toUpperCase()}</div>
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(8,8,8,0.85) 0%, transparent 60%)" }} />
      </div>
      <div style={{ padding:"20px 24px 24px" }}>
        <h3 style={{ fontFamily:"Oswald", fontSize:28, lineHeight:1, marginBottom:4 }}>{event.title}</h3>
        <p style={{ color:"var(--muted)", fontSize:13, marginBottom:16 }}>{event.subtitle}</p>
        <div style={{ fontSize:13, marginBottom:4 }}><i className="fa-regular fa-calendar" style={{marginRight:6,color:"var(--gold)"}} />{fmtDate(event.date)} · {event.time}</div>
        <div style={{ fontSize:13, color:"var(--muted)", marginBottom:16 }}><i className="fa-solid fa-location-dot" style={{marginRight:6,color:"var(--gold)"}} />{event.venue}</div>
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
            <span style={{ fontFamily:"Oswald", fontSize:24, color:"var(--gold)" }}>{fmt(minPrice)}</span>
          </div>
          <span style={{ background:"var(--gold)", color:"#000", padding:"8px 18px", borderRadius:8, fontWeight:700, fontSize:13 }}>Get Tickets →</span>
        </div>
      </div>
    </Link>
  );
}

// ── Auth Page ──────────────────────────────────────────────────────────────
function AuthPage({ mode, ctx }) {
  const { login, loginWithGoogle, register, currentUser } = ctx;
  const navigate = useNavigate();
  const [form, setForm] = useState({ name:"", email:"", phone:"", password:"", role:"customer" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  if (currentUser) {
    const nextPath = String(currentUser.phone || "").trim()
      ? (currentUser.role === "organizer" ? "/dashboard" : "/")
      : "/profile?complete=phone";
    return <Navigate to={nextPath} />;
  }
  const F = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    setError(""); setLoading(true);
    if (mode === "login") {
      const res = await login(form.email, form.password);
      if (!res.ok) { setError("Invalid email or password."); setLoading(false); return; }
      navigate(res.role === "organizer" ? "/dashboard" : "/");
    } else {
      if (!form.name || !form.email || !form.phone || !form.password) { setError("All fields required."); setLoading(false); return; }
      const res = await register(form.name, form.email, form.password, "customer", form.phone);
      if (!res.ok) { setError("Email already in use or invalid."); setLoading(false); return; }
      navigate("/");
    }
    setLoading(false);
  };

  const handleReset = async () => {
    if (!resetEmail) { setResetMsg("Please enter your email address."); return; }
    setResetLoading(true); setResetMsg("");
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setResetMsg("Reset email sent! Check your inbox.");
    } catch {
      setResetMsg("Could not send reset email. Check the address and try again.");
    }
    setResetLoading(false);
  };

  // redirect logged-in users away (but only if not viewing reset screen)
  if (currentUser && !showReset) {
    const nextPath = String(currentUser.phone || "").trim()
      ? (currentUser.role === "organizer" ? "/dashboard" : "/")
      : "/profile?complete=phone";
    return <Navigate to={nextPath} />;
  }

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
            <div style={{ fontSize:13, textAlign:"center", color: resetMsg.startsWith("Reset") ? "var(--green)" : "var(--red)", padding:"10px 14px", background: resetMsg.startsWith("Reset") ? "rgba(61,220,132,0.08)" : "rgba(232,64,64,0.08)", borderRadius:8 }}>
              {resetMsg}
            </div>
          )}
          <button onClick={handleReset} disabled={resetLoading} style={{ background:"var(--gold)", color:"#000", border:"none", padding:14, borderRadius:10, cursor: resetLoading?"not-allowed":"pointer", opacity: resetLoading?0.7:1, fontWeight:700, fontSize:16, fontFamily:"Oswald", letterSpacing:1 }}>
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
          {mode==="register" && <Input label="Phone Number" type="tel" value={form.phone} onChange={F("phone")} placeholder="+234 801 234 5678" />}
          <Input label="Email" type="email" value={form.email} onChange={F("email")} placeholder="you@email.com" />
          <Input label="Password" type="password" value={form.password} onChange={F("password")} placeholder="••••••••" />
          {mode==="register" && (
            <div style={{ background:"rgba(245,166,35,0.08)", border:"1px solid var(--gold-dim)", borderRadius:10, padding:"12px 14px", color:"var(--muted)", fontSize:13, lineHeight:1.6 }}>
              New public signups create attendee accounts. Organizer access is granted separately by StagePro.
            </div>
          )}
          {error && <div style={{ color:"var(--red)", fontSize:13, textAlign:"center" }}>{error}</div>}
          <button onClick={submit} disabled={loading} style={{ background:"var(--gold)", color:"#000", border:"none", padding:14, borderRadius:10, cursor: loading?"not-allowed":"pointer", opacity: loading?0.7:1, fontWeight:700, fontSize:16, fontFamily:"Oswald", letterSpacing:1, marginTop:8 }}>
            {loading?"PLEASE WAIT...":mode==="login"?"SIGN IN":"CREATE ACCOUNT"}
          </button>

          {/* Divider */}
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ flex:1, height:1, background:"var(--border)" }} />
            <span style={{ fontSize:12, color:"var(--muted)" }}>OR</span>
            <div style={{ flex:1, height:1, background:"var(--border)" }} />
          </div>

          {/* Google Sign-In */}
          <button
            onClick={async () => {
              setLoading(true);
              const res = await loginWithGoogle();
              if (res.ok) {
                navigate(res.needsPhone ? "/profile?complete=phone" : (res.role === "organizer" ? "/dashboard" : "/"));
              }
              else { setError("Google sign-in failed. Please try again."); setLoading(false); }
            }}
            disabled={loading}
            style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:14, borderRadius:10, cursor:"pointer", fontWeight:600, fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
              <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
              <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
              <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
            </svg>
            Continue with Google
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
  const { eventId: eventRouteParam } = useParams();
  const eventId = resolveEventIdFromParam(eventRouteParam);
  const { events, publicSoldCounts, currentUser, tickets, joinWaitlist } = ctx;
  const navigate = useNavigate();
  const [cart, setCart] = useState({});
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [waitlistStatus, setWaitlistStatus] = useState({});
  const [guestModal, setGuestModal] = useState(false);

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

  // Read soldCounts directly from the event doc (kept fresh by onSnapshot)
  // Never override with the user's own tickets — that only counts their purchases, not everyone's
  const totalItems = Object.values(cart).reduce((s,q) => s+q, 0);
  const totalPrice = event.tiers.reduce((s,t) => s+(cart[t.id]||0)*t.price, 0);

  const adjust = (tierId, delta) => {
    setCart(prev => {
      const tier = event.tiers.find(t => t.id===tierId);
      const draft = { ...prev };
      draft[tierId] = Math.max(0, (draft[tierId] || 0) + delta);
      const inventoryCap = tier.total - getSold(event, tier.id);
      draft[tierId] = Math.min(draft[tierId], inventoryCap);
      return draft;
    });
  };

  const handleCheckout = () => {
    sessionStorage.setItem("cart", JSON.stringify(cart));
    if (!currentUser) {
      setGuestModal(true); // collect guest details instead of forcing login
    } else {
      navigate(`${eventPath(event)}/checkout`);
    }
  };

  const handleGuestProceed = (guestInfo) => {
    sessionStorage.setItem("guestInfo", JSON.stringify(guestInfo));
    setGuestModal(false);
    navigate(`${eventPath(event)}/checkout`);
  };

  return (
    <div style={{ maxWidth:1100, margin:"0 auto", padding:"24px 16px", animation:"fadeUp 0.4s ease" }}>
      {/* Top bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20, padding:"0 8px" }}>
        <button onClick={() => navigate(-1)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:14, padding:0 }}>← Back</button>
<ShareButton url={`${window.location.origin}${eventPath(event)}`} />
      </div>

      {/* Hero image */}
      <div style={{ borderRadius:16, overflow:"hidden", marginBottom:20, position:"relative" }}>
        {event.image
          ? <img
              src={getEventImageSrc(event)}
              alt={event.title}
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = DEFAULT_EVENT_IMAGE;
              }}
              style={{ width:"100%", height:"min(360px, 55vw)", objectFit:"cover", display:"block" }}
            />
          : <div style={{ width:"100%", height:"min(360px, 55vw)", background: getEventBg(event) }} />
        }
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(8,8,8,0.92) 0%, transparent 55%)" }} />
        <div style={{ position:"absolute", bottom:20, left:20, right:20 }}>
          <div style={{ fontSize:11, letterSpacing:3, color:"var(--gold)", marginBottom:6 }}>{event.category?.toUpperCase()}</div>
          {(event.visibility || "public") === "private" && (
            <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"rgba(8,8,8,0.55)", border:"1px solid rgba(245,166,35,0.25)", color:"var(--gold)", padding:"4px 10px", borderRadius:100, fontSize:11, fontWeight:700, marginBottom:8 }}>
              <i className="fa-solid fa-lock" />
              Private event
            </div>
          )}
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
            {[[<i className="fa-regular fa-calendar" />,"Date",fmtDate(event.date)],[<i className="fa-regular fa-clock" />,"Time",event.time||"TBA"],[<i className="fa-solid fa-location-dot" />,"Venue",event.venue],[<i className="fa-solid fa-tag" />,"Category",event.category]].map(([icon,l,v]) => (
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

          {/* Reviews preview */}
          <EventReviewsPreview eventId={event.id} event={event} currentUser={ctx.currentUser} tickets={ctx.tickets} submitReview={ctx.submitReview} />
        </div>

        {/* Right — ticket selector */}
        <div style={{ position:"sticky", top:80 }}>
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:24 }}>
            <h3 style={{ fontSize:20, marginBottom:20 }}>SELECT TICKETS</h3>
            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:20 }}>
              {event.tiers.map(tier => {
                const available = tier.total - getSold(event, tier.id);
                const qty = cart[tier.id]||0;
                const wStatus = waitlistStatus[tier.id];
                return (
                  <div key={tier.id} style={{ background:"var(--bg3)", border:`1px solid ${qty>0?"var(--gold)":available===0?"rgba(232,64,64,0.3)":"var(--border)"}`, borderRadius:12, padding:"14px 16px", transition:"border-color 0.2s" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                      <div>
                        <div style={{ fontWeight:600, fontSize:14, marginBottom:2 }}>{tier.name}</div>
                        <div style={{ fontFamily:"Oswald", fontSize:22, color: available===0?"var(--muted)":"var(--gold)" }}>{Number(tier.price)===0 ? "FREE" : fmt(tier.price)}</div>
                      </div>
                      {available > 0 ? (
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <button onClick={() => adjust(tier.id,-1)} disabled={qty===0} style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", background:"var(--bg2)", color:"var(--text)", cursor: qty===0?"not-allowed":"pointer", fontSize:20, opacity: qty===0?0.4:1 }}>−</button>
                          <span style={{ fontFamily:"IBM Plex Mono", fontSize:18, minWidth:22, textAlign:"center" }}>{qty}</span>
                          <button onClick={() => adjust(tier.id,1)} style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", background: qty>0?"var(--gold)":"var(--bg2)", color: qty>0?"#000":"var(--text)", cursor:"pointer", fontSize:20 }}>+</button>
                        </div>
                      ) : (
                        <button
                          disabled={!currentUser || wStatus==="joined"}
                          onClick={async () => {
                            if (!currentUser) { navigate("/login"); return; }
                            setWaitlistStatus(p=>({...p,[tier.id]:"joining"}));
                            const res = await joinWaitlist(event.id, tier.id);
                            setWaitlistStatus(p=>({...p,[tier.id]: res.ok?"joined":"error"}));
                          }}
                          style={{ background: wStatus==="joined"?"var(--bg3)":"rgba(232,64,64,0.15)", border:`1px solid ${wStatus==="joined"?"var(--border)":"rgba(232,64,64,0.4)"}`, color: wStatus==="joined"?"var(--muted)":"var(--red)", padding:"8px 14px", borderRadius:8, cursor: wStatus==="joined"?"default":"pointer", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}
                        >
                          {wStatus==="joining" ? "..." : wStatus==="joined" ? <><i className="fa-solid fa-check" style={{marginRight:6}} />On Waitlist</> : <><i className="fa-solid fa-bell" style={{marginRight:6}} />Join Waitlist</>}
                        </button>
                      )}
                    </div>
                    {available > 0 && (() => {
                      const sold = getSold(event, tier.id);
                      const pct = tier.total ? Math.round((sold / tier.total) * 100) : 0;
                      return (
                        <div style={{ marginTop:8 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--muted)", marginBottom:4 }}>
                            <span>{sold} sold</span>
                            <span style={{ color: available < 20 ? "var(--red)" : "var(--muted)" }}>{available} remaining</span>
                          </div>
                          <div style={{ height:3, background:"var(--border)", borderRadius:2 }}>
                            <div style={{ height:"100%", width:`${pct}%`, background: pct>80?"var(--red)":"var(--gold)", borderRadius:2, transition:"width 0.4s" }} />
                          </div>
                        </div>
                      );
                    })()}
                    {available === 0 && (
                      <div style={{ fontSize:12, color:"var(--red)", marginTop:6 }}>
                        SOLD OUT — join waitlist to be notified if tickets become available
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {totalItems>0 && (
              <div style={{ borderTop:"1px solid var(--border)", paddingTop:16, marginBottom:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ color:"var(--muted)", fontSize:14 }}>{totalItems} ticket{totalItems>1?"s":""}</span>
                  {totalPrice === 0
                    ? <span style={{ fontFamily:"Oswald", fontSize:24, color:"var(--green)" }}>FREE</span>
                    : <span style={{ fontFamily:"Oswald", fontSize:24, color:"var(--gold)" }}>{fmt(totalPrice)}</span>
                  }
                </div>
              </div>
            )}
            <button disabled={totalItems===0} onClick={handleCheckout} style={{ width:"100%", padding:16, background: totalItems>0?"var(--gold)":"var(--bg3)", color: totalItems>0?"#000":"var(--muted)", border:"none", borderRadius:10, cursor: totalItems>0?"pointer":"not-allowed", fontFamily:"Oswald", fontSize:20, letterSpacing:1 }}>
              {totalItems===0 ? "SELECT TICKETS" : totalPrice===0 ? "CONFIRM REGISTRATION →" : "PROCEED TO CHECKOUT →"}
            </button>
            {!currentUser && totalItems > 0 && (
              <div style={{ textAlign:"center", marginTop:10, fontSize:12, color:"var(--muted)" }}>
                No account needed · or <Link to="/login" style={{ color:"var(--gold)" }}>sign in</Link> for faster checkout
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Guest details modal */}
      {guestModal && (
        <GuestModal onProceed={handleGuestProceed} onClose={() => setGuestModal(false)} />
      )}
    </div>
  );
}

// ── Guest Checkout Modal ───────────────────────────────────────────────────
function GuestModal({ onProceed, onClose }) {
  const [form, setForm] = useState({ name:"", email:"", phone:"" });
  const F = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const valid = form.name.trim() && form.email.includes("@") && form.phone.trim();
  const iStyle = { width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none", fontFamily:"Manrope" };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:20, padding:32, width:"100%", maxWidth:420, animation:"fadeUp 0.3s ease" }}>
        <div style={{ marginBottom:24 }}>
          <h2 style={{ fontFamily:"Oswald", fontSize:32, marginBottom:6 }}>YOUR DETAILS</h2>
          <p style={{ color:"var(--muted)", fontSize:13 }}>We need these to send your tickets. No account required.</p>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:14, marginBottom:24 }}>
          <div>
            <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>FULL NAME *</label>
            <input value={form.name} onChange={F("name")} placeholder="e.g. Amara Okafor" style={iStyle} />
          </div>
          <div>
            <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>EMAIL ADDRESS *</label>
            <input type="email" value={form.email} onChange={F("email")} placeholder="your@email.com" style={iStyle} />
            <div style={{ fontSize:11, color:"var(--muted)", marginTop:5 }}>
              <i className="fa-solid fa-lock" style={{ marginRight:4 }} />Your ticket QR code will be sent here
            </div>
          </div>
          <div>
            <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>PHONE NUMBER *</label>
            <input type="tel" value={form.phone} onChange={F("phone")} placeholder="+234 801 234 5678" style={iStyle} />
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <button onClick={() => valid && onProceed(form)} disabled={!valid}
            style={{ width:"100%", padding:14, background:valid?"var(--gold)":"var(--bg3)", color:valid?"#000":"var(--muted)", border:"none", borderRadius:10, fontFamily:"Oswald", fontSize:20, letterSpacing:1, cursor:valid?"pointer":"not-allowed" }}>
            CONTINUE TO CHECKOUT →
          </button>
          <div style={{ textAlign:"center", fontSize:12, color:"var(--muted)" }}>
            Already have an account?{" "}
            <Link to="/login" style={{ color:"var(--gold)" }} onClick={onClose}>Sign in instead</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Checkout Page ──────────────────────────────────────────────────────────
function PaymentVerificationPage({ ctx }) {
  const { notify } = ctx;
  const navigate = useNavigate();
  const handledRef = useRef(false);
  const [status, setStatus] = useState("verifying");
  const [message, setMessage] = useState("Confirming your payment and preparing your ticket...");

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const reference = params.get("reference") || params.get("transaction_ref");
      const pendingRaw = sessionStorage.getItem("pendingSquadCheckout");

      if (!reference || !pendingRaw) {
        setStatus("failed");
        setMessage("We couldn't find the payment details needed to complete your ticket.");
        return;
      }

      let pending;
      try {
        pending = JSON.parse(pendingRaw);
      } catch {
        setStatus("failed");
        setMessage("Your pending checkout details are invalid. Please contact support with your payment reference.");
        return;
      }

      try {
        const finalizeRes = await fetch("/api/finalize-squad-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reference,
            eventId: pending.eventId,
            cart: pending.cart,
            buyer: pending.buyer,
            expectedAmount: pending.total * 100,
            expectedCurrency: "NGN",
          }),
        });

        const finalizeData = await finalizeRes.json().catch(() => ({}));
        if (!finalizeRes.ok || !finalizeData?.ok) {
          setStatus("failed");
          setMessage(finalizeData?.msg || "Payment finalization failed.");
          notify(finalizeData?.msg || "Payment finalization failed.", "error");
          return;
        }

        const finalizedTickets = Array.isArray(finalizeData?.tickets) ? finalizeData.tickets : [];
        if (finalizedTickets.length > 0) {
          sessionStorage.removeItem("cart");
          sessionStorage.removeItem("guestInfo");
          sessionStorage.removeItem("pendingSquadCheckout");
          navigate(`/ticket/${finalizedTickets[0].id}`, { replace: true });
          return;
        }
        setStatus("failed");
        setMessage("Payment was verified, but no tickets were returned.");
      } catch (err) {
        console.error("Payment verification page error:", err);
        setStatus("failed");
        setMessage("Something went wrong while completing your ticket.");
      }
    };

    run();
  }, [navigate, notify]);

  return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"64px 24px 80px", animation:"fadeUp 0.4s ease" }}>
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:20, padding:"40px 32px", textAlign:"center" }}>
        {status === "failed"
          ? <i className="fa-solid fa-circle-exclamation" style={{ fontSize:48, color:"var(--red)", marginBottom:16 }} />
          : <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize:48, color:"var(--gold)", marginBottom:16 }} />
        }
        <h1 style={{ fontSize:40, marginBottom:12 }}>
          {status === "failed" ? "PAYMENT NEEDS ATTENTION" : "FINALIZING PAYMENT"}
        </h1>
        <p style={{ color:"var(--muted)", fontSize:15, lineHeight:1.7, marginBottom:24 }}>{message}</p>
        {status === "failed" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <button
              onClick={() => window.location.reload()}
              style={{ background:"var(--gold)", color:"#000", border:"none", padding:"14px 20px", borderRadius:10, cursor:"pointer", fontWeight:700 }}
            >
              TRY AGAIN
            </button>
            <Link to="/find-tickets" style={{ color:"var(--muted)", fontSize:14 }}>Find My Tickets</Link>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckoutPage({ ctx }) {
  const { eventId: eventRouteParam } = useParams();
  const eventId = resolveEventIdFromParam(eventRouteParam);
  const { events, currentUser, purchaseTickets, notify } = ctx;
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [payError, setPayError] = useState("");

  const [cart] = useState(() => JSON.parse(sessionStorage.getItem("cart") || "{}"));
  const [guestInfo] = useState(() => JSON.parse(sessionStorage.getItem("guestInfo") || "null"));
  const buyer = currentUser || guestInfo;

  const event = events.find(e => e.id === eventId);
  const eventDetailsPath = event ? eventPath(event) : eventPath(eventRouteParam || eventId);

  if (!buyer) return <Navigate to={eventDetailsPath} />;
  if (!event || Object.keys(cart).length === 0) return <Navigate to={eventDetailsPath} />;

  const selections = event.tiers.filter(t => (cart[t.id]||0) > 0);
  const subtotal = selections.reduce((s,t) => s + cart[t.id] * Number(t.price), 0);
  const SERVICE_FEE = 100; // ₦100 flat per order
  const isFree = subtotal === 0;
  const total = isFree ? 0 : subtotal + SERVICE_FEE;

  // ── Free tickets — confirm directly ───────────────────────────────────
  const handleFree = async () => {

    setProcessing(true);
    const result = await purchaseTickets(eventId, cart, null, buyer);
    if (result) {
      sessionStorage.removeItem("cart");
      sessionStorage.removeItem("guestInfo");
      if (!currentUser && Array.isArray(result)) {
        navigate(`/ticket/${result[0].id}`); // guest → first ticket
      } else {
        navigate("/tickets");
      }
    }
    setProcessing(false);
  };

  const handlePay = async () => {
    setPayError("");
    setProcessing(true);
    try {
      const initRes = await fetch("/api/initialize-squad-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: buyer.email,
          amount: total,
          currency: "NGN",
          callbackUrl: `${window.location.origin}/payment/verify`,
          customerName: buyer.name,
          customerPhone: buyer.phone || "",
          eventTitle: event.title,
          eventId: event.id,
          organizerId: event.organizer || "",
        }),
      });

      const initData = await initRes.json().catch(() => ({}));
      if (!initRes.ok || !initData?.ok || !initData?.checkoutUrl) {
        throw new Error(initData?.msg || "Could not open Squad checkout.");
      }

      sessionStorage.setItem("pendingSquadCheckout", JSON.stringify({
        eventId,
        cart,
        buyer,
        total,
        reference: initData.reference,
      }));

      window.location.assign(initData.checkoutUrl);
    } catch (err) {
      console.error("Squad checkout init failed:", err);
      setPayError(err?.message || "Could not open Squad checkout. Please try again.");
      notify(err?.message || "Could not open Squad checkout.", "error");
      setProcessing(false);
    }
  };

  const handleConfirm = isFree ? handleFree : handlePay;

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <button onClick={() => navigate(-1)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", marginBottom:24, fontSize:14 }}>← Back</button>
      <h1 style={{ fontSize:48, marginBottom:32 }}>{isFree ? "CLAIM TICKETS" : "CHECKOUT"}</h1>

      {/* Order summary */}
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, marginBottom:20 }}>
        <div style={{ fontSize:12, color:"var(--muted)", letterSpacing:2, marginBottom:16 }}>ORDER SUMMARY</div>
        <div style={{ fontFamily:"Oswald", fontSize:24, marginBottom:4 }}>{event.title}</div>
        <div style={{ color:"var(--muted)", fontSize:13, marginBottom:24 }}>{fmtDate(event.date)} · {event.venue}</div>
        {selections.map(t => {
          const lineTotal = cart[t.id] * Number(t.price);
          const tFree = Number(t.price) === 0;
          return (
            <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:"1px solid var(--border)" }}>
              <div>
                <span style={{ fontWeight:600 }}>{t.name}</span>
                <span style={{ color:"var(--muted)", fontSize:13 }}> × {cart[t.id]}</span>
              </div>
              <span style={{ fontFamily: tFree?"Manrope":"IBM Plex Mono", fontWeight: tFree?700:400, color: tFree?"var(--green)":"var(--text)", fontSize: tFree?13:14 }}>
                {tFree ? "FREE" : fmt(lineTotal)}
              </span>
            </div>
          );
        })}

        {/* Service fee line — only for paid orders */}
        {!isFree && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:"1px solid var(--border)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ color:"var(--muted)", fontSize:13 }}>Service fee</span>
              <span style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:100, padding:"1px 8px", fontSize:10, color:"var(--muted)", letterSpacing:1 }}>STAGEPRO</span>
            </div>
            <span style={{ fontFamily:"IBM Plex Mono", fontSize:14, color:"var(--muted)" }}>₦100</span>
          </div>
        )}

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:16 }}>
          <span style={{ fontWeight:600 }}>Total</span>
          {isFree
            ? <span style={{ fontFamily:"Oswald", fontSize:28, color:"var(--green)" }}>FREE</span>
            : <span style={{ fontFamily:"Oswald", fontSize:28, color:"var(--gold)" }}>{fmt(total)}</span>
          }
        </div>
      </div>

      {/* Attendee */}
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, marginBottom:20 }}>
        <div style={{ fontSize:12, color:"var(--muted)", letterSpacing:2, marginBottom:16 }}>ATTENDEE</div>
        <div style={{ fontWeight:600 }}>{buyer.name}</div>
        <div style={{ color:"var(--muted)", fontSize:13 }}>{buyer.email}{!currentUser && <span style={{ marginLeft:8, background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:100, padding:"1px 8px", fontSize:10, color:"var(--muted)", letterSpacing:1 }}>GUEST</span>}</div>
        {buyer.phone && <div style={{ color:"var(--muted)", fontSize:13, marginTop:4 }}>{buyer.phone}</div>}
      </div>

      {/* Free banner — no payment needed */}
      {isFree && (
        <div style={{ background:"rgba(61,220,132,0.08)", border:"1px solid var(--green)", borderRadius:12, padding:"14px 20px", marginBottom:20, display:"flex", alignItems:"center", gap:12 }}>
          <i className="fa-solid fa-champagne-glasses" style={{fontSize:22,color:"var(--gold)"}} />
          <div>
            <div style={{ fontWeight:700, color:"var(--green)", fontSize:14 }}>These tickets are free!</div>
            <div style={{ color:"var(--muted)", fontSize:13 }}>No payment required — just confirm below to get your tickets.</div>
          </div>
        </div>
      )}

      {/* Agreement checkbox */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24, cursor:"pointer" }} onClick={() => setAgreed(p=>!p)}>
        <div style={{ width:20, height:20, border:`2px solid ${agreed?"var(--gold)":"var(--border)"}`, borderRadius:4, background: agreed?"var(--gold)":"transparent", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s", flexShrink:0 }}>
          {agreed && <i className="fa-solid fa-check" style={{ color:"#000", fontSize:11 }} />}
        </div>
        <span style={{ fontSize:13, color:"var(--muted)" }}>
          {isFree ? "I confirm I want to register for this event." : "I agree to the terms and conditions. All sales are final."}
        </span>
      </div>

      {payError && (
        <div style={{ background:"rgba(232,64,64,0.1)", border:"1px solid var(--red)", borderRadius:12, padding:"14px 20px", marginBottom:20, display:"flex", alignItems:"center", gap:12 }}>
          <i className="fa-solid fa-circle-exclamation" style={{ color:"var(--red)", fontSize:20 }} />
          <div style={{ color:"var(--muted)", fontSize:13 }}>
            {payError}
          </div>
        </div>
      )}

      {/* Confirm button */}
      <button
        disabled={!agreed || processing}
        onClick={handleConfirm}
        style={{ width:"100%", padding:16, background: agreed ? (isFree?"var(--green)":"var(--gold)") : "var(--bg3)", color: agreed ? "#000" : "var(--muted)", border:"none", borderRadius:12, fontFamily:"Oswald", fontSize:22, letterSpacing:2, cursor: agreed?"pointer":"not-allowed", opacity: processing?0.7:1 }}
      >
        {processing
          ? (isFree ? "REGISTERING..." : "OPENING PAYMENT...")
          : isFree
            ? "CONFIRM REGISTRATION ->"
            : `PAY ${fmt(total)} WITH SQUAD ->`
        }
      </button>

      {/* Payment trust badge */}
      {!isFree && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginTop:14, color:"var(--muted)", fontSize:12 }}>
          <i className="fa-solid fa-lock" style={{ fontSize:11 }} />
          <span>Secured by Squad - Card and bank transfer accepted</span>
        </div>
      )}
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
        <h2 style={{ fontFamily:"Oswald", fontSize:28, marginBottom:4 }}>TRANSFER TICKET</h2>
        <p style={{ color:"var(--muted)", fontSize:13, marginBottom:24 }}>Enter the email address of the person you want to send <strong style={{ color:"var(--text)" }}>{ticket.eventTitle} — {ticket.tierName}</strong> to.</p>
        <Input label="Recipient Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="friend@email.com" />
        {msg && <div style={{ marginTop:12, color:"var(--red)", fontSize:13 }}>{msg}</div>}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:12, borderRadius:10, cursor:"pointer", fontWeight:600 }}>Cancel</button>
          <button onClick={handle} disabled={!email.trim()||loading} style={{ background: email.trim()?"var(--gold)":"var(--bg3)", color: email.trim()?"#000":"var(--muted)", border:"none", padding:12, borderRadius:10, cursor: email.trim()?"pointer":"not-allowed", fontFamily:"Oswald", fontSize:18, letterSpacing:1 }}>
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
      <div style={{ fontSize:64, color:"var(--gold)" }}><i className="fa-solid fa-ticket" /></div>
      <h2 style={{ fontFamily:"Oswald", fontSize:36, color:"var(--text)" }}>NO TICKETS YET</h2>
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
                  <h3 style={{ fontFamily:"Oswald", fontSize:28 }}>{ticket.eventTitle}</h3>
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
                    ><i className="fa-solid fa-arrow-up-right-from-square" style={{marginRight:5}} />Transfer</button>
                  )}
                  <button
                    onClick={async e => {
                      e.stopPropagation();
                      const btn = e.currentTarget;
                      btn.disabled = true;
                      btn.textContent = "Sending...";
                      try {
                        const r = await fetch("/api/resend-ticket-email", {
                          method:"POST", headers:{"Content-Type":"application/json"},
                          body: JSON.stringify({ ticketId: ticket.id }),
                        });
                        const d = await r.json();
                        btn.textContent = d.success ? "✓ Sent!" : "Failed";
                      } catch { btn.textContent = "Failed"; }
                      setTimeout(() => { btn.disabled = false; btn.textContent = "Resend Email"; }, 3000);
                    }}
                    style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--muted)", padding:"4px 12px", borderRadius:100, fontSize:12, cursor:"pointer", fontWeight:600 }}
                  ><i className="fa-solid fa-envelope" style={{marginRight:5}} />Resend Email</button>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"Oswald", fontSize:28, color:"var(--gold)" }}>{fmt(ticket.price)}</div>
                <div style={{ fontFamily:"IBM Plex Mono", fontSize:11, color:"var(--muted)", marginTop:4, wordBreak:"break-all", maxWidth:180 }}>{ticket.id}</div>
              </div>
            </div>
            {selected?.id===ticket.id && (
              <div style={{ marginTop:24, paddingTop:24, borderTop:"1px solid var(--border)", display:"flex", flexDirection:"column", alignItems:"center", gap:16, animation:"fadeUp 0.3s ease" }}>
                <div style={{ padding:16, background:"var(--bg3)", borderRadius:12, display:"inline-block" }}>
                  <QRCode ticketId={ticket.id} size={200} />
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:"IBM Plex Mono", fontSize:12, color:"var(--gold)", wordBreak:"break-all", marginBottom:4 }}>{ticket.id}</div>
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
  const { organizerEvents, tickets, currentUser, organizerNotifications, organizerAttendeeFeed, issueComplimentaryTickets, deleteEvent, refreshEvents, notify, syncEventLiveSheet } = ctx;
  const [searchParams] = useSearchParams();
  const adminOrganizerId = currentUser?.role === "admin" ? (searchParams.get("organizerId") || "").trim() : "";
  const isAdminView = currentUser?.role === "admin" && Boolean(adminOrganizerId);
  const canManage = currentUser?.role === "organizer" && !isAdminView;
  const [viewedOrganizer, setViewedOrganizer] = useState(null);
  const [adminEvents, setAdminEvents] = useState([]);
  const [adminTickets, setAdminTickets] = useState([]);
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [adminAttendeeFeed, setAdminAttendeeFeed] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [compModalEvent, setCompModalEvent] = useState(null);
  const [compTierId, setCompTierId] = useState("");
  const [compQty, setCompQty] = useState("1");
  const [compName, setCompName] = useState("");
  const [compEmail, setCompEmail] = useState("");
  const [compStatus, setCompStatus] = useState({ type: "idle", msg: "" });
  const [syncingEventId, setSyncingEventId] = useState("");
  const [resendingEventId, setResendingEventId] = useState("");
  const [view, setView] = useState("list"); // list | calendar | payouts
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year:d.getFullYear(), month:d.getMonth() }; });
  const [payoutRecords, setPayoutRecords] = useState([]);
  const [webhookCopyState, setWebhookCopyState] = useState("idle");
  const activeOrganizer = isAdminView ? viewedOrganizer : currentUser;
  const activeEvents = isAdminView ? adminEvents : organizerEvents;
  const activeTickets = isAdminView ? adminTickets : tickets;
  const activeNotifications = isAdminView ? adminNotifications : organizerNotifications;
  const activeAttendeeFeed = isAdminView ? adminAttendeeFeed : organizerAttendeeFeed;
  const payoutOwnerId = isAdminView ? adminOrganizerId : currentUser.uid;

  useEffect(() => {
    if (!isAdminView) {
      setViewedOrganizer(null);
      return;
    }
    const loadOrganizer = async () => {
      try {
        const snap = await getDoc(doc(db, "users", adminOrganizerId));
        if (snap.exists()) setViewedOrganizer({ uid: snap.id, ...snap.data() });
        else setViewedOrganizer({ uid: adminOrganizerId, name: "Organizer", email: "" });
      } catch (err) {
        console.error("Could not load selected organizer:", err);
        setViewedOrganizer({ uid: adminOrganizerId, name: "Organizer", email: "" });
      }
    };
    loadOrganizer();
  }, [isAdminView, adminOrganizerId]);

  useEffect(() => {
    if (!isAdminView) {
      setAdminEvents([]);
      return;
    }
    const q = query(collection(db, "events"), where("organizer", "==", adminOrganizerId));
    const unsub = onSnapshot(
      q,
      (snapshot) => setAdminEvents(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error("Admin organizer events listener failed:", err);
        setAdminEvents([]);
      }
    );
    return () => unsub();
  }, [isAdminView, adminOrganizerId]);

  useEffect(() => {
    if (!isAdminView) {
      setAdminTickets([]);
      return;
    }
    const eventIds = adminEvents.map(e => e.id);
    if (eventIds.length === 0) {
      setAdminTickets([]);
      return;
    }
    const chunks = [];
    for (let i = 0; i < eventIds.length; i += 30) chunks.push(eventIds.slice(i, i + 30));
    const bucket = new Map();
    const unsubs = chunks.map((chunk, idx) => {
      const q = query(collection(db, "tickets"), where("eventId", "in", chunk));
      return onSnapshot(
        q,
        (snap) => {
          bucket.set(idx, snap.docs.map(d => ({ id: d.id, ...d.data() })));
          const merged = [];
          bucket.forEach(rows => merged.push(...rows));
          setAdminTickets(merged);
        },
        (err) => {
          console.error("Admin organizer tickets listener failed:", err);
          bucket.set(idx, []);
          const merged = [];
          bucket.forEach(rows => merged.push(...rows));
          setAdminTickets(merged);
        }
      );
    });
    return () => unsubs.forEach(unsub => unsub());
  }, [isAdminView, adminEvents]);

  useEffect(() => {
    if (!isAdminView) {
      setAdminNotifications([]);
      return;
    }
    const q = query(
      collection(db, "organizerNotifications"),
      where("organizerId", "==", adminOrganizerId),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        setAdminNotifications(rows.slice(0, 20));
      },
      (err) => {
        console.error("Admin organizer notifications listener failed:", err);
        setAdminNotifications([]);
      }
    );
    return () => unsub();
  }, [isAdminView, adminOrganizerId]);

  useEffect(() => {
    if (!isAdminView) {
      setAdminAttendeeFeed([]);
      return;
    }
    const q = query(
      collection(db, "organizerAttendeeFeed"),
      where("organizerId", "==", adminOrganizerId),
      orderBy("createdAt", "desc"),
      limit(80)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        setAdminAttendeeFeed(rows.slice(0, 40));
      },
      (err) => {
        console.error("Admin organizer attendee feed listener failed:", err);
        setAdminAttendeeFeed([]);
      }
    );
    return () => unsub();
  }, [isAdminView, adminOrganizerId]);

  const myEvents = activeEvents;
  const myEventIds = new Set(myEvents.map(e => e.id));
  const myTickets = activeTickets.filter(t => myEventIds.has(t.eventId));
  const attendeePayments = [...myTickets]
    .sort((a, b) => new Date(b.purchasedAt || 0).getTime() - new Date(a.purchasedAt || 0).getTime())
    .slice(0, 20);
  const payoutSummary = calculatePayoutSummary(myTickets);

  // Use actual ticket documents as the dashboard source of truth so sales stay
  // consistent even if soldCounts updates are delayed or blocked.
  const totalSold = myTickets.length;
  const totalCap  = myEvents.reduce((s,e) => s + e.tiers.reduce((ss,t) => ss + (t.total||0), 0), 0);
  const revenue   = payoutSummary.gross;
  const totalCheckedIn = myTickets.filter(t => t.used).length;
  const totalOrders = payoutSummary.orderCount;

  // Payout calculations
  const STAGEPRO_FEE = 100;
  const paidTickets = myTickets.filter(t => t.paymentStatus === "paid" && getPaymentReference(t));

  // Per-event payout data
  const payoutByEvent = myEvents.map(e => {
    const eTickets = myTickets.filter(t => t.eventId === e.id);
    const eGross = eTickets.reduce((s,t) => s + (t.price||0), 0);
    const ePaidOrders = [...new Set(eTickets.map(getPaymentReference).filter(Boolean))].length;
    const eStagePro = ePaidOrders * STAGEPRO_FEE;
    const eSquad = calculateSquadTransferFee(eGross);
    const eNet = eGross - eStagePro - eSquad;
    return { event:e, gross:eGross, stagepro:eStagePro, squad:eSquad, net:Math.round(eNet), orders:ePaidOrders };
  }).filter(p => p.gross > 0);

  const totalStagePro = totalOrders * STAGEPRO_FEE;
  const totalSquad = calculateSquadTransferFee(revenue);
  const netPayout = revenue - totalStagePro - totalSquad;
  const totalPaidOut = payoutRecords.filter(p => p.status === "paid").reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const outstandingPayout = Math.max(0, Math.round(netPayout) - totalPaidOut);
  const payoutDetails = activeOrganizer?.payoutDetails || {};
  const organizerLiveSheetConfig = activeOrganizer?.liveSheet || {};
  const organizerLiveSheetViewUrl = String(organizerLiveSheetConfig.viewUrl || "").trim();
  const organizerLiveSheetWebhookUrl = String(organizerLiveSheetConfig.webhookUrl || "").trim();
  const eventsWithLiveSheets = myEvents
    .map(event => ({ event, config: getEventLiveSheetConfig(event) }))
    .filter(({ config }) => config.viewUrl || config.webhookUrl);
  const hasPayoutDetails = Boolean(
    payoutDetails.bankName?.trim() &&
    payoutDetails.accountName?.trim() &&
    payoutDetails.accountNumber?.trim()
  );

  useEffect(() => {
    const loadPayouts = async () => {
      try {
        const q = query(collection(db, "payouts"), where("organizerId", "==", payoutOwnerId));
        const snap = await getDocs(q);
        setPayoutRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.createdAt || b.paidAt || 0) - new Date(a.createdAt || a.paidAt || 0)));
      } catch (err) {
        console.error("Payout records fetch failed:", err);
        setPayoutRecords([]);
      }
    };
    loadPayouts();
  }, [payoutOwnerId]);

  const handleDelete = async (event) => {
    if (!canManage) return;
    await deleteEvent(event.id);
    setConfirmDelete(null);
  };
  const openCompModal = (event) => {
    setCompModalEvent(event);
    setCompTierId(event?.tiers?.[0]?.id || "");
    setCompQty("1");
    setCompName("");
    setCompEmail("");
    setCompStatus({ type: "idle", msg: "" });
  };
  const closeCompModal = () => {
    setCompModalEvent(null);
    setCompStatus({ type: "idle", msg: "" });
  };
  const handleSyncEventSheet = async (event) => {
    if (!canManage || !event?.id) return;
    setSyncingEventId(event.id);
    const result = await syncEventLiveSheet(event.id);
    if (result?.ok) notify(`Live sheet synced with ${result.count} ticket record${result.count === 1 ? "" : "s"} for ${event.title}.`);
    else notify(result?.msg || "Could not sync this event to the live sheet.", "error");
    setSyncingEventId("");
  };
  const handleBulkResendEmails = async (event, eventTickets) => {
    if (!canManage || !event?.id) return;
    const resendableTickets = eventTickets.filter(ticket => String(ticket.userEmail || "").trim());
    if (!resendableTickets.length) {
      notify(`No ticket emails found for ${event.title}.`, "error");
      return;
    }

    setResendingEventId(event.id);
    let successCount = 0;
    let failCount = 0;
    const chunkSize = 8;

    for (let i = 0; i < resendableTickets.length; i += chunkSize) {
      const chunk = resendableTickets.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        chunk.map(async (ticket) => {
          const response = await fetch("/api/resend-ticket-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticketId: ticket.id }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload?.error || "Email resend failed");
          }
          return response.json().catch(() => ({}));
        })
      );

      results.forEach((result) => {
        if (result.status === "fulfilled") successCount += 1;
        else failCount += 1;
      });
    }

    if (successCount > 0) {
      notify(`Resent ${successCount} unique QR email${successCount === 1 ? "" : "s"} for ${event.title}.${failCount ? ` ${failCount} failed.` : ""}`);
    } else {
      notify(`Could not resend ticket emails for ${event.title}.`, "error");
    }
    setResendingEventId("");
  };
  const submitCompFromDashboard = async () => {
    if (!canManage) return;
    if (!compModalEvent?.id || !compTierId) return;
    setCompStatus({ type: "sending", msg: "Issuing complimentary tickets..." });
    const res = await issueComplimentaryTickets({
      eventId: compModalEvent.id,
      tierId: compTierId,
      qty: Number(compQty || 0),
      attendeeName: compName,
      attendeeEmail: compEmail,
    });
    if (res.ok) {
      setCompStatus({ type: "sent", msg: `${res.count} complimentary ticket(s) issued.` });
      setTimeout(() => closeCompModal(), 1200);
    } else {
      setCompStatus({ type: "error", msg: res.msg || "Could not issue complimentary tickets." });
    }
  };
  const webhookUrl = `${window.location.origin}/webhooks/squad`;
  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setWebhookCopyState("copied");
      setTimeout(() => setWebhookCopyState("idle"), 1800);
    } catch {
      setWebhookCopyState("error");
      setTimeout(() => setWebhookCopyState("idle"), 1800);
    }
  };
  const formatNotifTime = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  const notifMeta = (item) => {
    if (item.type === "ticket_sold") return { icon: "fa-solid fa-ticket", color: "var(--green)" };
    if (item.type === "charge_failed") return { icon: "fa-solid fa-circle-exclamation", color: "var(--red)" };
    if (item.type === "refund") return { icon: "fa-solid fa-rotate-left", color: "var(--muted)" };
    return { icon: "fa-solid fa-bell", color: "var(--gold)" };
  };

  // Calendar helpers
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const { year, month } = calMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const prevMonth = () => setCalMonth(p => p.month===0 ? {year:p.year-1,month:11} : {year:p.year,month:p.month-1});
  const nextMonth = () => setCalMonth(p => p.month===11 ? {year:p.year+1,month:0} : {year:p.year,month:p.month+1});

  // Map event dates to day numbers for this month
  const eventsByDay = {};
  myEvents.forEach(e => {
    const d = new Date(e.date);
    if (d.getFullYear()===year && d.getMonth()===month) {
      const day = d.getDate();
      if (!eventsByDay[day]) eventsByDay[day] = [];
      eventsByDay[day].push(e);
    }
  });

  if (currentUser?.role === "admin" && !adminOrganizerId) {
    return (
      <div style={{ maxWidth:900, margin:"0 auto", padding:"56px 24px", textAlign:"center" }}>
        <h1 style={{ fontSize:42, marginBottom:12 }}>Select an Organizer First</h1>
        <p style={{ color:"var(--muted)", marginBottom:20 }}>
          Open an organizer from Admin Control to view their dashboard data.
        </p>
        <Link to="/admin" style={{ background:"var(--gold)", color:"#000", padding:"12px 18px", borderRadius:10, fontWeight:700 }}>
          Go to Admin Control
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth:1200, margin:"0 auto", padding:"40px 24px" }}>
      {isAdminView && (
        <div style={{ background:"rgba(245,166,35,0.08)", border:"1px solid rgba(245,166,35,0.24)", borderRadius:12, padding:"12px 16px", marginBottom:18, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
          <div style={{ color:"var(--muted)", fontSize:13 }}>
            Viewing organizer dashboard for <strong style={{ color:"var(--text)" }}>{activeOrganizer?.name || activeOrganizer?.email || adminOrganizerId}</strong> ({activeOrganizer?.email || adminOrganizerId})
          </div>
          <Link to="/admin" style={{ color:"var(--gold)", fontSize:12, fontWeight:700 }}>Back to Admin</Link>
        </div>
      )}
      {canManage && compModalEvent && (
        <div onClick={closeCompModal} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:24, width:"100%", maxWidth:700, animation:"fadeUp 0.2s ease" }}>
            <h2 style={{ fontFamily:"Oswald", fontSize:30, marginBottom:6 }}>ISSUE COMPLIMENTARY TICKETS</h2>
            <p style={{ color:"var(--muted)", fontSize:13, marginBottom:16 }}>{compModalEvent.title}</p>
            <div style={{ display:"grid", gridTemplateColumns:"1.1fr 0.7fr 1fr 1fr", gap:10, marginBottom:14 }}>
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>TIER</label>
                <select value={compTierId} onChange={e => setCompTierId(e.target.value)} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }}>
                  {compModalEvent.tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>QTY</label>
                <input type="number" min="1" value={compQty} onChange={e => setCompQty(e.target.value)} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
              </div>
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>ATTENDEE NAME</label>
                <input value={compName} onChange={e => setCompName(e.target.value)} placeholder="Optional" style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
              </div>
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>ATTENDEE EMAIL</label>
                <input type="email" value={compEmail} onChange={e => setCompEmail(e.target.value)} placeholder="Optional" style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
              </div>
            </div>
            {compStatus.type !== "idle" && (
              <div style={{ fontSize:12, marginBottom:12, color: compStatus.type === "error" ? "var(--red)" : compStatus.type === "sent" ? "var(--green)" : "var(--muted)" }}>
                {compStatus.msg}
              </div>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <button onClick={closeCompModal} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:12, borderRadius:10, cursor:"pointer", fontWeight:600 }}>Cancel</button>
              <button onClick={submitCompFromDashboard} disabled={!compTierId || Number(compQty || 0) <= 0 || compStatus.type === "sending"} style={{ background: (!compTierId || Number(compQty || 0) <= 0) ? "var(--bg3)" : "var(--gold)", border:"none", color: (!compTierId || Number(compQty || 0) <= 0) ? "var(--muted)" : "#000", padding:12, borderRadius:10, cursor: (!compTierId || Number(compQty || 0) <= 0) ? "not-allowed" : "pointer", fontWeight:700 }}>
                {compStatus.type === "sending" ? "ISSUING..." : "ISSUE COMPLIMENTARY"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {canManage && confirmDelete && (
        <div onClick={() => setConfirmDelete(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:32, maxWidth:400, width:"100%", animation:"fadeUp 0.3s ease" }}>
            <div style={{ fontSize:40, marginBottom:16, color:"var(--red)" }}><i className="fa-solid fa-trash" /></div>
            <h2 style={{ fontFamily:"Oswald", fontSize:28, marginBottom:8 }}>DELETE EVENT?</h2>
            <p style={{ color:"var(--muted)", fontSize:14, marginBottom:24 }}>This will permanently delete <strong style={{ color:"var(--text)" }}>{confirmDelete.title}</strong>. This action cannot be undone.</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:12, borderRadius:10, cursor:"pointer", fontWeight:600 }}>Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ background:"var(--red)", border:"none", color:"#fff", padding:12, borderRadius:10, cursor:"pointer", fontFamily:"Oswald", fontSize:18, letterSpacing:1 }}>DELETE</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:40, flexWrap:"wrap", gap:12 }}>
        <h1 style={{ fontSize:48 }}>{isAdminView ? "ORGANIZER DASHBOARD" : "DASHBOARD"}</h1>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {/* View toggle */}
          <div style={{ display:"flex", background:"var(--bg3)", borderRadius:10, padding:4, border:"1px solid var(--border)" }}>
            {[["list",<><i className="fa-solid fa-list" style={{marginRight:6}} />List</>],["calendar",<><i className="fa-regular fa-calendar" style={{marginRight:6}} />Calendar</>],["payouts",<><i className="fa-solid fa-naira-sign" style={{marginRight:6}} />Payouts</>]].map(([id,label]) => (
              <button key={id} onClick={() => setView(id)} style={{ padding:"7px 14px", borderRadius:7, border:"none", cursor:"pointer", fontSize:13, fontWeight:600, background: view===id?"var(--bg2)":"transparent", color: view===id?"var(--text)":"var(--muted)", transition:"all 0.2s" }}>{label}</button>
            ))}
          </div>
          {canManage && (
            <button onClick={refreshEvents} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--muted)", padding:"10px 16px", borderRadius:10, cursor:"pointer", fontSize:13 }}><i className="fa-solid fa-rotate-right" style={{marginRight:6}} />Refresh</button>
          )}
          {canManage && (
            <Link to="/dashboard/create" style={{ background:"var(--gold)", color:"#000", padding:"12px 24px", borderRadius:10, fontWeight:700, fontSize:14 }}>+ Create Event</Link>
          )}
        </div>
      </div>

      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14, padding:"14px 16px", marginBottom:20, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div style={{ minWidth:240 }}>
          <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:4 }}>WEBHOOK URL</div>
          <div style={{ fontFamily:"IBM Plex Mono", fontSize:12, color:"var(--text)", wordBreak:"break-all" }}>{webhookUrl}</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button
            onClick={copyWebhookUrl}
            style={{ background:"var(--gold)", border:"none", color:"#000", padding:"9px 14px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12, letterSpacing:1 }}
          >
            {webhookCopyState === "copied" ? "COPIED" : webhookCopyState === "error" ? "COPY FAILED" : "COPY WEBHOOK URL"}
          </button>
          <a
            href="https://merchant.squadco.com/settings"
            target="_blank"
            rel="noreferrer"
            style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"9px 14px", borderRadius:8, fontSize:12, fontWeight:700, letterSpacing:1, textDecoration:"none" }}
          >
            OPEN SQUAD SETTINGS
          </a>
        </div>
      </div>

      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14, padding:"16px 18px", marginBottom:24 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, gap:10, flexWrap:"wrap" }}>
          <div style={{ fontWeight:700, fontSize:14, letterSpacing:1 }}>LIVE ACTIVITY</div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, color:"var(--muted)" }}>Updates from webhook events</span>
            {organizerLiveSheetViewUrl && (
              <a href={organizerLiveSheetViewUrl} target="_blank" rel="noreferrer" style={{ color:"var(--gold)", fontSize:11, fontWeight:700 }}>
                OPEN DEFAULT SHEET
              </a>
            )}
          </div>
        </div>
        {canManage && !eventsWithLiveSheets.length && !organizerLiveSheetWebhookUrl && (
          <div style={{ background:"rgba(245,166,35,0.08)", border:"1px solid var(--gold-dim)", borderRadius:10, padding:"10px 12px", color:"var(--gold)", fontSize:12, marginBottom:12 }}>
            Add a live sheet webhook inside an event or in your profile fallback to stream ticket activity into Google Sheets in real time.
          </div>
        )}
        {eventsWithLiveSheets.length > 0 && (
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
            {eventsWithLiveSheets.slice(0, 6).map(({ event, config }) => (
              config.viewUrl ? (
                <a
                  key={event.id}
                  href={config.viewUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"8px 12px", borderRadius:999, fontSize:12, fontWeight:700 }}
                >
                  {event.title}
                </a>
              ) : null
            ))}
          </div>
        )}
        {activeNotifications?.length ? (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {activeNotifications.slice(0, 5).map(item => {
              const meta = notifMeta(item);
              return (
                <div key={item.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
                    <i className={meta.icon} style={{ color: meta.color, fontSize:13, flexShrink:0 }} />
                    <div style={{ fontSize:13, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title || "New activity"}</div>
                  </div>
                  <div style={{ fontSize:11, color:"var(--muted)", whiteSpace:"nowrap" }}>{formatNotifTime(item.createdAt)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize:13, color:"var(--muted)" }}>No live webhook activity yet.</div>
        )}
      </div>

      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14, padding:"16px 18px", marginBottom:24 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, gap:10, flexWrap:"wrap" }}>
          <div style={{ fontWeight:700, fontSize:14, letterSpacing:1 }}>ATTENDEE PAYMENTS</div>
          <span style={{ fontSize:11, color:"var(--muted)" }}>Live from ticket records</span>
        </div>
        {attendeePayments.length ? (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"var(--bg3)" }}>
                  {["Attendee", "Email", "Event", "Amount", "Status", "Time"].map(h => (
                    <th key={h} style={{ padding:"9px 10px", textAlign:"left", color:"var(--muted)", fontWeight:600, fontSize:11, letterSpacing:1, whiteSpace:"nowrap" }}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attendeePayments.map((row, i) => (
                  <tr key={row.id} style={{ borderTop:"1px solid var(--border)", background: i % 2 ? "rgba(255,255,255,0.01)" : "transparent" }}>
                    <td style={{ padding:"10px", fontWeight:600, whiteSpace:"nowrap" }}>{row.userName || "Attendee"}</td>
                    <td style={{ padding:"10px", color:"var(--muted)", maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row.userEmail || "-"}</td>
                    <td style={{ padding:"10px", maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row.eventTitle || "-"}</td>
                    <td style={{ padding:"10px", fontFamily:"IBM Plex Mono", color:"var(--gold)", whiteSpace:"nowrap" }}>{fmt(Number(row.price || 0))}</td>
                    <td style={{ padding:"10px", whiteSpace:"nowrap" }}>
                      <span style={{ background: row.paymentStatus === "paid" ? "rgba(61,220,132,0.14)" : row.paymentStatus === "free" || row.paymentStatus === "complimentary" ? "rgba(245,166,35,0.12)" : "rgba(232,64,64,0.12)", color: row.paymentStatus === "paid" ? "var(--green)" : row.paymentStatus === "free" || row.paymentStatus === "complimentary" ? "var(--gold)" : "var(--red)", borderRadius:100, padding:"2px 8px", fontSize:10, fontWeight:700 }}>
                        {String(row.paymentStatus || "unknown").toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding:"10px", color:"var(--muted)", whiteSpace:"nowrap" }}>{formatNotifTime(row.purchasedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize:13, color:"var(--muted)" }}>No attendee payment records yet.</div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:16, marginBottom:40 }}>
        {[
          { label:"Total Revenue", value:fmt(revenue), icon:"fa-solid fa-naira-sign" },
          { label:"Tickets Sold", value:totalSold.toLocaleString(), icon:"fa-solid fa-ticket" },
          { label:"Checked In", value:totalCheckedIn.toLocaleString(), icon:"fa-solid fa-circle-check" },
          { label:"Avg. Fill Rate", value: totalCap?`${Math.round((totalSold/totalCap)*100)}%`:"0%", icon:"fa-solid fa-chart-pie" },
        ].map(s => (
          <div key={s.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:24 }}>
            <div style={{ fontSize:28, marginBottom:8, color:"var(--gold)" }}><i className={s.icon} /></div>
            <div style={{ fontFamily:"Oswald", fontSize:32, color:"var(--gold)" }}>{s.value}</div>
            <div style={{ fontSize:12, color:"var(--muted)", marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Calendar View */}
      {view === "calendar" && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden", marginBottom:32 }}>
          {/* Calendar header */}
          <div style={{ padding:"20px 24px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <button onClick={prevMonth} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", width:36, height:36, borderRadius:8, cursor:"pointer", fontSize:16 }}>‹</button>
            <h3 style={{ fontFamily:"Oswald", fontSize:24, letterSpacing:1 }}>{MONTHS[month]} {year}</h3>
            <button onClick={nextMonth} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", width:36, height:36, borderRadius:8, cursor:"pointer", fontSize:16 }}>›</button>
          </div>
          {/* Day headers */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", borderBottom:"1px solid var(--border)" }}>
            {DAYS.map(d => <div key={d} style={{ padding:"10px 0", textAlign:"center", fontSize:11, color:"var(--muted)", fontWeight:700, letterSpacing:1 }}>{d}</div>)}
          </div>
          {/* Calendar grid */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)" }}>
            {/* Empty cells before first day */}
            {Array.from({length:firstDay}).map((_,i) => <div key={`e${i}`} style={{ minHeight:80, borderRight:"1px solid var(--border)", borderBottom:"1px solid var(--border)" }} />)}
            {/* Day cells */}
            {Array.from({length:daysInMonth}).map((_,i) => {
              const day = i+1;
              const dayEvents = eventsByDay[day] || [];
              const isToday = new Date().getDate()===day && new Date().getMonth()===month && new Date().getFullYear()===year;
              return (
                <div key={day} style={{ minHeight:80, borderRight:"1px solid var(--border)", borderBottom:"1px solid var(--border)", padding:6, background: isToday?"rgba(245,166,35,0.05)":"transparent" }}>
                  <div style={{ fontSize:13, fontWeight: isToday?700:400, color: isToday?"var(--gold)":"var(--text)", marginBottom:4, width:24, height:24, borderRadius:"50%", background: isToday?"rgba(245,166,35,0.15)":"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>{day}</div>
                  {dayEvents.map(e => (
        <Link key={e.id} to={eventPath(e)}
                      style={{ display:"block", background: e.theme&&THEMES[e.theme]?THEMES[e.theme]:"var(--gold)", backgroundSize:"cover", color:"#000", fontSize:10, fontWeight:700, padding:"2px 6px", borderRadius:4, marginBottom:3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", textDecoration:"none" }}
                      title={e.title}
                    >{e.title}</Link>
                  ))}
                </div>
              );
            })}
            {/* Trailing empty cells to complete last row */}
            {Array.from({length:(7 - ((firstDay + daysInMonth) % 7)) % 7}).map((_,i) => <div key={`t${i}`} style={{ minHeight:80, borderRight:"1px solid var(--border)", borderBottom:"1px solid var(--border)" }} />)}
          </div>
          {/* Legend */}
          {myEvents.length > 0 && (
            <div style={{ padding:"12px 24px", borderTop:"1px solid var(--border)", display:"flex", gap:12, flexWrap:"wrap" }}>
              {myEvents.filter(e => { const d=new Date(e.date); return d.getFullYear()===year&&d.getMonth()===month; }).map(e => (
                <div key={e.id} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--muted)" }}>
                  <div style={{ width:10, height:10, borderRadius:2, background: e.theme&&THEMES[e.theme]?THEMES[e.theme]:"var(--gold)" }} />
                  {e.title}
                </div>
              ))}
              {myEvents.filter(e => { const d=new Date(e.date); return d.getFullYear()===year&&d.getMonth()===month; }).length===0 && (
                <span style={{ fontSize:12, color:"var(--muted)" }}>No events this month</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Payouts View */}
      {view === "payouts" && (
        <div style={{ animation:"fadeUp 0.3s ease" }}>
          {/* Summary cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:16, marginBottom:32 }}>
            {[
              { label:"Gross Revenue", value:fmt(revenue), icon:"fa-solid fa-naira-sign", color:"var(--gold)", sub:"Total ticket sales" },
              { label:"StagePro Fees", value:fmt(totalStagePro), icon:"fa-solid fa-receipt", color:"var(--muted)", sub:`N100 x ${totalOrders} orders` },
              { label:"Squad Transfer Fee", value:fmt(totalSquad), icon:"fa-solid fa-credit-card", color:"var(--muted)", sub:"1.2% of paid volume" },
              { label:"Available for Payout", value:fmt(outstandingPayout), icon:"fa-solid fa-wallet", color:"var(--green)", sub:"Net sales less recorded payouts" },
              { label:"Already Paid Out", value:fmt(totalPaidOut), icon:"fa-solid fa-money-bill-transfer", color:"var(--muted)", sub:`${payoutRecords.filter(p => p.status === "paid").length} recorded payout${payoutRecords.filter(p => p.status === "paid").length !== 1 ? "s" : ""}` },
            ].map(s => (
              <div key={s.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:24 }}>
                <div style={{ fontSize:24, marginBottom:8, color:s.color }}><i className={s.icon} /></div>
                <div style={{ fontFamily:"Oswald", fontSize:28, color:s.color }}>{s.value}</div>
                <div style={{ fontSize:13, color:"var(--text)", fontWeight:600, marginTop:2 }}>{s.label}</div>
                <div style={{ fontSize:11, color:"var(--muted)", marginTop:2 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Fee explanation */}
          <div style={{ background:"rgba(245,166,35,0.06)", border:"1px solid var(--gold-dim)", borderRadius:12, padding:"16px 20px", marginBottom:24, fontSize:13, color:"var(--muted)", lineHeight:1.8 }}>
            <strong style={{ color:"var(--text)" }}>How fees work:</strong> StagePro charges N100 per paid order. Squad transfer fees are calculated at 1.2% of paid volume. Free events have no fees.
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:16, marginBottom:24 }}>
            <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14, padding:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <i className="fa-solid fa-building-columns" style={{ color:"var(--gold)", fontSize:20 }} />
                <div style={{ fontWeight:700 }}>Bank details</div>
              </div>
              {hasPayoutDetails ? (
                <div style={{ display:"flex", flexDirection:"column", gap:6, fontSize:13, color:"var(--muted)" }}>
                  <div><strong style={{ color:"var(--text)" }}>Bank:</strong> {payoutDetails.bankName}</div>
                  <div><strong style={{ color:"var(--text)" }}>Account name:</strong> {payoutDetails.accountName}</div>
                  <div><strong style={{ color:"var(--text)" }}>Account number:</strong> {payoutDetails.accountNumber}</div>
                  {payoutDetails.notes && <div><strong style={{ color:"var(--text)" }}>Notes:</strong> {payoutDetails.notes}</div>}
                  {canManage ? (
                    <Link to="/profile" style={{ color:"var(--gold)", fontSize:12, marginTop:6 }}>Update payout details â†’</Link>
                  ) : (
                    <div style={{ color:"var(--muted)", fontSize:12, marginTop:6 }}>Edit payout details in organizer account.</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize:13, color:"var(--muted)", lineHeight:1.7 }}>
                  Add your bank details in your profile before requesting a payout.
                  <div style={{ marginTop:10 }}>
                    {canManage ? (
                      <Link to="/profile" style={{ color:"var(--gold)", fontSize:12 }}>Add payout details â†’</Link>
                    ) : (
                      <span style={{ color:"var(--muted)", fontSize:12 }}>Organizer has not added payout details.</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14, padding:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <i className="fa-solid fa-hand-holding-dollar" style={{ color:"var(--gold)", fontSize:20 }} />
                <div style={{ fontWeight:700 }}>Manual payout status</div>
              </div>
              <div style={{ fontSize:13, color:"var(--muted)", lineHeight:1.8 }}>
                StagePro settles organizers manually right now. Your available balance is <strong style={{ color:"var(--green)" }}>{fmt(outstandingPayout)}</strong>.
              </div>
              <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
                <span style={{ background: hasPayoutDetails ? "rgba(61,220,132,0.14)" : "rgba(244,90,90,0.12)", color: hasPayoutDetails ? "var(--green)" : "var(--red)", padding:"4px 10px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                  {hasPayoutDetails ? "READY FOR PAYOUT" : "BANK DETAILS NEEDED"}
                </span>
                <span style={{ background:"rgba(245,166,35,0.12)", color:"var(--gold)", padding:"4px 10px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                  MANUAL SETTLEMENT
                </span>
              </div>
            </div>
          </div>

          {/* Per-event breakdown */}
          {payoutByEvent.length === 0 ? (
            <div style={{ textAlign:"center", padding:"48px 0", color:"var(--muted)" }}>No paid ticket sales yet.</div>
          ) : (
            <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden" }}>
              <div style={{ padding:"16px 24px", borderBottom:"1px solid var(--border)" }}>
                <h3 style={{ fontSize:20 }}>PAYOUT BREAKDOWN BY EVENT</h3>
              </div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"var(--bg3)" }}>
                      {["Event","Gross","StagePro Fee","Squad Fee","Net Payout"].map(h => (
                        <th key={h} style={{ padding:"10px 16px", textAlign:"left", color:"var(--muted)", fontWeight:600, fontSize:11, letterSpacing:1, whiteSpace:"nowrap" }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payoutByEvent.map((p, i) => (
                      <tr key={p.event.id} style={{ borderTop:"1px solid var(--border)", background: i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
                        <td style={{ padding:"12px 16px", fontWeight:600 }}>{p.event.title}</td>
                        <td style={{ padding:"12px 16px", fontFamily:"IBM Plex Mono", fontSize:12, color:"var(--gold)" }}>{fmt(p.gross)}</td>
                        <td style={{ padding:"12px 16px", fontFamily:"IBM Plex Mono", fontSize:12, color:"var(--muted)" }}>-{fmt(p.squad)}</td>
                        <td style={{ padding:"12px 16px", fontFamily:"IBM Plex Mono", fontSize:12, color:"var(--green)", fontWeight:700 }}>{fmt(Math.max(0, p.net))}</td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr style={{ borderTop:"2px solid var(--gold-dim)", background:"rgba(245,166,35,0.05)" }}>
                      <td style={{ padding:"12px 16px", fontWeight:700, fontSize:13 }}>TOTAL</td>
                      <td style={{ padding:"12px 16px", fontFamily:"IBM Plex Mono", fontSize:13, color:"var(--gold)", fontWeight:700 }}>{fmt(revenue)}</td>
                      <td style={{ padding:"12px 16px", fontFamily:"IBM Plex Mono", fontSize:13, color:"var(--muted)", fontWeight:700 }}>-{fmt(totalSquad)}</td>
                      <td style={{ padding:"12px 16px", fontFamily:"IBM Plex Mono", fontSize:13, color:"var(--green)", fontWeight:700 }}>{fmt(Math.max(0, netPayout))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Events table */}
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden" }}>
        <div style={{ padding:"20px 24px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h3 style={{ fontSize:22 }}>{isAdminView ? "ORGANIZER EVENTS" : "YOUR EVENTS"}</h3>
          <span style={{ fontSize:12, color:"var(--muted)" }}><i className="fa-solid fa-circle-info" style={{marginRight:4}} />CSV downloads buyer list</span>
        </div>
        {myEvents.length===0 ? (
          <div style={{ padding:40, textAlign:"center", color:"var(--muted)" }}>
            No events yet.
            {canManage && <span> <Link to="/dashboard/create" style={{ color:"var(--gold)" }}>Create your first one!</Link></span>}
          </div>
       ) : myEvents.map((event, i) => {
          const eventTickets = myTickets.filter(t => t.eventId === event.id);
          const sold = eventTickets.length;
          const cap = event.tiers.reduce((s,t) => s + (t.total||0), 0);
          const rev = eventTickets.reduce((s,t) => s + (t.price||0), 0);
          const pct = cap ? Math.round((sold/cap)*100) : 0;
          const checkedIn = eventTickets.filter(t => t.used).length;
          // Use sold (from event tiers) as denominator so check-in matches tickets sold stat
          const checkInPct = sold ? Math.round((checkedIn/sold)*100) : 0;
          return (
            <div key={event.id} style={{ padding:"20px 24px", borderBottom: i<myEvents.length-1?"1px solid var(--border)":"none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:20, flexWrap:"wrap" }}>
                <img
                  src={getEventImageSrc(event)}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = DEFAULT_EVENT_IMAGE;
                  }}
                  style={{ width:60, height:60, objectFit:"cover", borderRadius:8, flexShrink:0 }}
                  alt=""
                />
                <div style={{ flex:1, minWidth:160 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:2 }}>
                    <div style={{ fontWeight:600 }}>{event.title}</div>
                    <span style={{ background:(event.visibility || "public") === "private" ? "rgba(232,64,64,0.12)" : "rgba(61,220,132,0.14)", color:(event.visibility || "public") === "private" ? "var(--red)" : "var(--green)", padding:"2px 8px", borderRadius:100, fontSize:10, fontWeight:700 }}>
                      {(event.visibility || "public").toUpperCase()}
                    </span>
                  </div>
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
                  <div style={{ fontSize:12, fontFamily:"IBM Plex Mono", color:"var(--muted)" }}>{sold}/{cap}</div>
                </div>
                {/* Check-in bar */}
                <div style={{ minWidth:110 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--muted)", marginBottom:4 }}>
                    <span>Check-ins</span><span>{checkInPct}%</span>
                  </div>
                  <div style={{ height:4, background:"var(--border)", borderRadius:2, marginBottom:2 }}>
                    <div style={{ height:"100%", width:`${checkInPct}%`, background:"var(--green)", borderRadius:2, transition:"width 0.4s" }} />
                  </div>
                  <div style={{ fontSize:12, fontFamily:"IBM Plex Mono", color:"var(--muted)" }}>{checkedIn}/{sold}</div>
                </div>
                <div style={{ textAlign:"right", minWidth:90 }}>
                  <div style={{ fontFamily:"Oswald", fontSize:22, color:"var(--gold)" }}>{fmt(rev)}</div>
                  <div style={{ fontSize:12, color:"var(--muted)" }}>revenue</div>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {canManage && getEventLiveSheetConfig(event).viewUrl && (
                    <a href={getEventLiveSheetConfig(event).viewUrl} target="_blank" rel="noreferrer" style={{ background:"rgba(61,220,132,0.12)", border:"1px solid rgba(61,220,132,0.24)", color:"var(--green)", padding:"7px 12px", borderRadius:8, fontSize:13, fontWeight:700 }}>
                      <i className="fa-solid fa-table-list" style={{marginRight:5}} />
                      Sheet
                    </a>
                  )}
                  {canManage && (getEventLiveSheetConfig(event).webhookUrl || organizerLiveSheetWebhookUrl) && (
                    <button
                      onClick={() => handleSyncEventSheet(event)}
                      disabled={syncingEventId === event.id}
                      style={{ background:"rgba(245,166,35,0.12)", border:"1px solid var(--gold-dim)", color:"var(--gold)", padding:"7px 12px", borderRadius:8, fontSize:13, fontWeight:700, cursor: syncingEventId === event.id ? "wait" : "pointer" }}
                    >
                      <i className="fa-solid fa-arrows-rotate" style={{marginRight:5}} />
                      {syncingEventId === event.id ? "Syncing..." : "Sync Sheet"}
                    </button>
                  )}
                  <Link to={eventPath(event)} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"7px 12px", borderRadius:8, fontSize:13 }}>View</Link>
                  {canManage && <Link to={`/dashboard/edit/${event.id}`} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"7px 12px", borderRadius:8, fontSize:13 }}><i className="fa-solid fa-pen" style={{marginRight:5}} />Edit</Link>}
                  {canManage && <Link to={`/dashboard/analytics/${event.id}`} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"7px 12px", borderRadius:8, fontSize:13 }}><i className="fa-solid fa-chart-bar" style={{marginRight:5}} />Stats</Link>}
                  {canManage && <button onClick={() => openCompModal(event)} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"7px 12px", borderRadius:8, fontSize:13, cursor:"pointer" }}><i className="fa-solid fa-gift" style={{marginRight:5}} />Issue Comp</button>}
                  {canManage && <Link to="/validate" style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"7px 12px", borderRadius:8, fontSize:13 }}>Scan ▶</Link>}
                  {canManage && (
                    <button
                      onClick={() => handleBulkResendEmails(event, eventTickets)}
                      disabled={resendingEventId === event.id || eventTickets.filter(ticket => String(ticket.userEmail || "").trim()).length === 0}
                      style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"7px 12px", borderRadius:8, fontSize:13, cursor: resendingEventId === event.id ? "wait" : "pointer", opacity: eventTickets.filter(ticket => String(ticket.userEmail || "").trim()).length === 0 ? 0.5 : 1 }}
                    >
                      <i className="fa-solid fa-envelope" style={{marginRight:5}} />
                      {resendingEventId === event.id ? "Sending..." : "Resend All Ticket Emails"}
                    </button>
                  )}
                  <button onClick={() => downloadCSVWithEmail(event, myTickets)} style={{ background:"var(--gold)", border:"none", color:"#000", padding:"7px 12px", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                    <i className="fa-solid fa-download" style={{marginRight:5}} />{eventTickets.length > 0 && <span style={{ background:"rgba(0,0,0,0.2)", borderRadius:100, padding:"1px 6px", fontSize:11 }}>{eventTickets.length}</span>}
                  </button>
                  {canManage && <button onClick={() => setConfirmDelete(event)} style={{ background:"rgba(232,64,64,0.1)", border:"1px solid rgba(232,64,64,0.3)", color:"var(--red)", padding:"7px 12px", borderRadius:8, fontSize:13, cursor:"pointer" }}><i className="fa-solid fa-trash" /></button>}
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
  const [form, setForm] = useState({ visibility:"public", ...initialForm });
  const [touched, setTouched] = useState({});
  const [imageUploading, setImageUploading] = useState(false);
  const [imageProgress, setImageProgress] = useState(0);
  const [imgErr, setImgErr] = useState(false);
  const fileInputRef = useRef(null);

  const F = (k) => (e) => { setForm(p=>({...p,[k]:e.target.value})); setTouched(p=>({...p,[k]:true})); };
  const updateTier = (i,k,v) => setForm(p=>({...p,tiers:p.tiers.map((t,j)=>j===i?{...t,[k]:v}:t)}));
  const addTier = () => setForm(p=>({...p,tiers:[...p.tiers,{name:"",price:"",total:"",sold:0}]}));
  const removeTier = (i) => setForm(p=>({...p,tiers:p.tiers.filter((_,j)=>j!==i)}));

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Please select an image file."); return; }
    if (file.size > 5 * 1024 * 1024) { alert("Image must be under 5MB."); return; }
    setImageUploading(true);
    setImageProgress(0);
    try {
      const ext = file.name.split(".").pop();
      const path = `events/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const ref = storageRef(storage, path);
      const task = uploadBytesResumable(ref, file);
      task.on("state_changed",
        snap => setImageProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
        err => { console.error(err); setImageUploading(false); alert("Upload failed. Try again."); },
        async () => {
          const url = await getDownloadURL(task.snapshot.ref);
          setForm(p => ({ ...p, image: url }));
          setImageUploading(false);
          setImageProgress(0);
        }
      );
    } catch (err) {
      console.error(err); setImageUploading(false);
    }
  };

  const isValid = form.title && form.date && form.venue && form.tiers.every(t => t.name && t.price !== "" && t.total);

  const missingFields = [];
  if (!form.title) missingFields.push("Event title");
  if (!form.date) missingFields.push("Date");
  if (!form.venue) missingFields.push("Venue");
  form.tiers.forEach((t, i) => {
    if (!t.name) missingFields.push(`Tier ${i+1} name`);
    if (t.price === "") missingFields.push(`Tier ${i+1} price (use 0 for free)`);
    if (!t.total) missingFields.push(`Tier ${i+1} capacity`);
  });

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

        <div>
          <label style={{ fontSize:12, color:"var(--muted)", marginBottom:10, display:"block", letterSpacing:1 }}>EVENT VISIBILITY</label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {[
              {
                id: "public",
                title: "Public Event",
                body: "Shows on the homepage and can also be opened through its direct link.",
                icon: "fa-solid fa-earth-africa",
              },
              {
                id: "private",
                title: "Private Event",
                body: "Hidden from the homepage, but anyone with the event link can still open it.",
                icon: "fa-solid fa-lock",
              },
            ].map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => setForm(p => ({ ...p, visibility: option.id }))}
                style={{
                  background: form.visibility === option.id ? "rgba(245,166,35,0.12)" : "var(--bg3)",
                  border: `1px solid ${form.visibility === option.id ? "var(--gold)" : "var(--border)"}`,
                  borderRadius: 12,
                  padding: "16px 18px",
                  cursor: "pointer",
                  textAlign: "left",
                  color: form.visibility === option.id ? "var(--text)" : "var(--muted)",
                }}
              >
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, color: form.visibility === option.id ? "var(--gold)" : "var(--muted)" }}>
                  <i className={option.icon} />
                  <span style={{ fontWeight:700, fontSize:14 }}>{option.title}</span>
                </div>
                <div style={{ fontSize:12, lineHeight:1.7 }}>{option.body}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Venue */}
        <div>
          <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>VENUE <Req /></label>
          <input value={form.venue} onChange={F("venue")} onBlur={()=>setTouched(p=>({...p,venue:true}))} placeholder="e.g. Eko Convention Centre, Lagos" style={iStyle("venue", touched.venue&&!form.venue)} />
          {fieldErr("venue")}
        </div>

        <div>
          <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>CO-ORGANIZERS (OPTIONAL)</label>
          <input
            value={form.coOrganizerEmailsText || ""}
            onChange={F("coOrganizerEmailsText")}
            placeholder="organizer2@email.com, organizer3@email.com"
            style={iStyle("coOrganizerEmailsText", false)}
          />
          <div style={{ fontSize:11, color:"var(--muted)", marginTop:6, lineHeight:1.6 }}>
            Add existing StagePro organizer emails. Co-organizers can manage this event from their own dashboard.
          </div>
        </div>

        <div style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:12, padding:18 }}>
          <div style={{ fontFamily:"Oswald", fontSize:20, marginBottom:6 }}>EVENT LIVE SHEET</div>
          <div style={{ color:"var(--muted)", fontSize:12, lineHeight:1.7, marginBottom:14 }}>
            Add a dedicated Google Apps Script webhook and sheet link for this event. If left blank, StagePro will keep using your organizer-level fallback where available.
          </div>
          <div style={{ display:"grid", gap:14 }}>
            <div>
              <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>EVENT SHEET WEBHOOK URL</label>
              <input
                value={form.liveSheetWebhookUrl || ""}
                onChange={F("liveSheetWebhookUrl")}
                placeholder="https://script.google.com/macros/s/..."
                style={iStyle("liveSheetWebhookUrl", false)}
              />
            </div>
            <div>
              <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>EVENT SHEET VIEW URL</label>
              <input
                value={form.liveSheetViewUrl || ""}
                onChange={F("liveSheetViewUrl")}
                placeholder="https://docs.google.com/spreadsheets/..."
                style={iStyle("liveSheetViewUrl", false)}
              />
            </div>
          </div>
        </div>

        {/* Event Image — URL input */}
        <div>
          <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>EVENT IMAGE / FLYER</label>

          {/* URL input row */}
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <input
              value={form.image}
              onChange={e => { setForm(p=>({...p, image: e.target.value})); setImgErr(false); }}
              placeholder="Paste direct image URL (ends in .jpg, .png, .webp...)"
              style={{ ...iStyle("image", false), flex:1, fontSize:13 }}
            />
            {form.image && (
              <button type="button" onClick={() => { setForm(p=>({...p, image:""})); setImgErr(false); }}
                style={{ background:"rgba(232,64,64,0.1)", border:"1px solid var(--red)", color:"var(--red)", padding:"0 14px", borderRadius:8, cursor:"pointer", fontSize:13, flexShrink:0 }}>
                Clear
              </button>
            )}
          </div>

          {/* Live preview */}
          {form.image && !imgErr && (
            <div style={{ borderRadius:12, overflow:"hidden", border:"1px solid var(--border)", marginBottom:10, background:"var(--bg3)", minHeight:60, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <img
                src={form.image}
                alt="Preview"
                style={{ width:"100%", height:200, objectFit:"cover", display:"block" }}
                onError={() => setImgErr(true)}
              />
            </div>
          )}

          {/* Error state */}
          {form.image && imgErr && (
            <div style={{ borderRadius:12, border:"1px solid var(--red)", background:"rgba(232,64,64,0.06)", padding:"14px 16px", marginBottom:10, fontSize:12, color:"var(--red)", lineHeight:1.7 }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ marginRight:6 }} />
              <strong>Image could not load.</strong> Make sure the URL is a <em>direct image link</em> ending in <code>.jpg</code>, <code>.png</code>, or <code>.webp</code>.<br />
              <span style={{ color:"var(--muted)" }}>
                The URL you pasted may be a page link, not the image itself. See the tip below.
              </span>
            </div>
          )}

          <div style={{ fontSize:11, color:"var(--muted)", lineHeight:1.8 }}>
            <i className="fa-solid fa-circle-info" style={{ marginRight:5, color:"var(--gold)" }} />
            <strong style={{ color:"var(--text)" }}>Tip:</strong>{" "}
            Upload to <a href="https://imgur.com/upload" target="_blank" rel="noreferrer" style={{ color:"var(--gold)" }}>imgur.com</a> →
            once uploaded, <strong style={{ color:"var(--text)" }}>right-click the image → Open image in new tab</strong> →
            copy that URL (starts with <code style={{ color:"var(--gold)" }}>https://i.imgur.com/</code>).
          </div>
        </div>

        {/* Banner Theme / Color */}
        <div>
          <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>BANNER THEME <span style={{ color:"var(--muted)", fontWeight:400 }}>(used when no image is uploaded)</span></label>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(48px,1fr))", gap:8 }}>
            {[
              { id:"",          label:"None",     bg:"var(--bg3)",                                    border:true },
              { id:"purple",    label:"Purple",   bg:"linear-gradient(135deg,#6a11cb,#2575fc)" },
              { id:"fire",      label:"Fire",     bg:"linear-gradient(135deg,#f83600,#f9d423)" },
              { id:"ocean",     label:"Ocean",    bg:"linear-gradient(135deg,#0575e6,#021b79)" },
              { id:"forest",    label:"Forest",   bg:"linear-gradient(135deg,#134e5e,#71b280)" },
              { id:"gold",      label:"Gold",     bg:"linear-gradient(135deg,#f7971e,#ffd200)" },
              { id:"rose",      label:"Rose",     bg:"linear-gradient(135deg,#f953c6,#b91d73)" },
              { id:"midnight",  label:"Midnight", bg:"linear-gradient(135deg,#232526,#414345)" },
              { id:"neon",      label:"Neon",     bg:"linear-gradient(135deg,#00f260,#0575e6)" },
              { id:"sunset",    label:"Sunset",   bg:"linear-gradient(135deg,#f857a4,#ff5858)" },
              { id:"teal",      label:"Teal",     bg:"linear-gradient(135deg,#11998e,#38ef7d)" },
              { id:"royal",     label:"Royal",    bg:"linear-gradient(135deg,#141e30,#243b55)" },
            ].map(t => (
              <div key={t.id} title={t.label} onClick={() => setForm(p=>({...p, theme: t.id}))}
                style={{ height:40, borderRadius:8, background:t.bg, cursor:"pointer", border: form.theme===t.id ? "3px solid var(--gold)" : t.border ? "2px dashed var(--border)" : "2px solid transparent", transition:"border 0.15s", position:"relative" }}
              >
                {form.theme===t.id && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>✓</div>}
              </div>
            ))}
          </div>
          {form.theme && (
            <div style={{ marginTop:10, borderRadius:10, height:60, background: THEMES[form.theme]||"var(--bg3)", display:"flex", alignItems:"center", paddingLeft:16 }}>
              <span style={{ fontFamily:"Oswald", fontSize:20, color:"#fff", textShadow:"0 1px 4px rgba(0,0,0,0.5)" }}>Preview — {form.title||"Your Event Title"}</span>
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <label style={{ fontSize:12, color:"var(--muted)", marginBottom:8, display:"block", letterSpacing:1 }}>DESCRIPTION</label>
          <textarea value={form.description} onChange={F("description")} rows={4} placeholder="Describe your event — lineup, dress code, what to expect..." style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, resize:"vertical", fontFamily:"Manrope", outline:"none" }} />
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

        {/* Missing fields hint */}
        {missingFields.length > 0 && (
          <div style={{ background:"rgba(245,166,35,0.08)", border:"1px solid var(--gold-dim)", borderRadius:10, padding:"12px 16px", fontSize:12, color:"var(--muted)" }}>
            <i className="fa-solid fa-circle-exclamation" style={{ color:"var(--gold)", marginRight:6 }} />
            <strong style={{ color:"var(--text)" }}>Required to publish:</strong>{" "}
            {missingFields.join(" · ")}
          </div>
        )}

        <button onClick={()=>onSubmit(form)} disabled={!isValid||saving} style={{ width:"100%", padding:16, background:isValid?"var(--gold)":"var(--bg3)", color:isValid?"#000":"var(--muted)", border:"none", borderRadius:12, fontFamily:"Oswald", fontSize:22, letterSpacing:1, cursor:isValid?"pointer":"not-allowed", opacity:saving?0.7:1, marginTop:8 }}>
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
  const blank = { title:"", subtitle:"", date:"", time:"", venue:"", category:"Concert", visibility:"public", description:"", image:"", theme:"", coOrganizerEmailsText:"", liveSheetWebhookUrl:"", liveSheetViewUrl:"", tiers:[{ name:"General", price:"", total:"" }] };
  const handle = async (form) => {
    setSaving(true);
    const ev = await createEvent(form);
    if (ev) navigate(eventPath(ev));
    setSaving(false);
  };
  return <EventForm initialForm={blank} onSubmit={handle} saving={saving} submitLabel="PUBLISH EVENT" pageTitle="CREATE EVENT" />;
}

// ── Edit Event Page ────────────────────────────────────────────────────────
function EditEventPage({ ctx }) {
  const { organizerEvents, updateEvent } = ctx;
  const { eventId } = useParams();
  const navigate = useNavigate();
  const event = organizerEvents.find(e => e.id === eventId);
  const [saving, setSaving] = useState(false);

  if (!event) return <div style={{ textAlign:"center", padding:80, color:"var(--muted)" }}>Event not found.</div>;

  const prefilled = {
    title: event.title, subtitle: event.subtitle||"", date: event.date,
    time: event.time||"", venue: event.venue, category: event.category||"Concert", visibility: event.visibility || "public",
    description: event.description||"",
    image: event.image||"",
    theme: event.theme||"",
    coOrganizerEmailsText: Array.isArray(event.coOrganizerEmails) ? event.coOrganizerEmails.join(", ") : "",
    liveSheetWebhookUrl: event.liveSheet?.webhookUrl || event.liveSheetWebhookUrl || "",
    liveSheetViewUrl: event.liveSheet?.viewUrl || event.liveSheetViewUrl || "",
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
            <i className="fa-solid fa-camera" style={{fontSize:52,color:"var(--gold)"}} />
            <span style={{ fontFamily:"Oswald", fontSize:28, letterSpacing:1 }}>SNAP QR CODE</span>
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
          <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:10, display:"block" }}>TICKET ID</label>
          <input
            value={manualInput} onChange={e => setManualInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleManual()}
            placeholder="Paste ticket ID here..."
            autoFocus
            style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"14px 16px", color:"var(--text)", fontSize:14, fontFamily:"IBM Plex Mono", marginBottom:16, outline:"none" }}
          />
          <button onClick={handleManual} disabled={!manualInput.trim()} style={{ width:"100%", background: manualInput?"var(--gold)":"var(--bg3)", color: manualInput?"#000":"var(--muted)", border:"none", padding:14, borderRadius:10, cursor: manualInput?"pointer":"not-allowed", fontFamily:"Oswald", fontSize:20, letterSpacing:1, marginBottom:10 }}>
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
              <i className="fa-solid fa-triangle-exclamation" style={{fontSize:24,color:"var(--gold)"}} />
              <div>
                <div style={{ fontFamily:"Oswald", fontSize:20, color:"var(--red)" }}>ALREADY USED</div>
                <div style={{ fontSize:12, color:"var(--muted)" }}>This ticket was already scanned at entry</div>
              </div>
            </div>
          )}

          {/* Ticket card */}
          <div style={{ background:"var(--bg2)", border:`1px solid ${scannedTicket.used ? "var(--border)" : "var(--gold-dim)"}`, borderRadius:16, overflow:"hidden", marginBottom:16 }}>
            <div style={{ background: scannedTicket.used ? "var(--bg3)" : "rgba(245,166,35,0.08)", padding:"16px 24px", borderBottom:"1px solid var(--border)" }}>
              <div style={{ fontSize:11, letterSpacing:3, color:"var(--gold)", marginBottom:4 }}>TICKET DETAILS</div>
              <div style={{ fontFamily:"Oswald", fontSize:30 }}>{scannedTicket.eventTitle}</div>
            </div>
            <div style={{ padding:"20px 24px", display:"grid", gap:12 }}>
              {[
                ["Attendee", scannedTicket.userName],
                ["Tier", scannedTicket.tierName],
                ["Date", fmtDate(scannedTicket.eventDate)],
                ["Venue", scannedTicket.venue],
                ["Paid", fmt(scannedTicket.price)],
                ["Status", scannedTicket.used ? <span style={{color:"var(--red)"}}><i className="fa-solid fa-ban" style={{marginRight:5}} />Already Used</span> : <span style={{color:"var(--green)"}}><i className="fa-solid fa-circle-check" style={{marginRight:5}} />Valid</span>],
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
              style={{ width:"100%", background:"var(--green)", color:"#000", border:"none", borderRadius:12, padding:"18px 24px", cursor:"pointer", fontFamily:"Oswald", fontSize:26, letterSpacing:1, marginBottom:10 }}
            >
              ✓ MARK AS ATTENDED
            </button>
          ) : (
            <div style={{ background:"rgba(232,64,64,0.08)", border:"1px solid var(--red)", borderRadius:12, padding:"16px 24px", textAlign:"center", marginBottom:10 }}>
              <div style={{ fontFamily:"Oswald", fontSize:22, color:"var(--red)" }}><i className="fa-solid fa-ban" style={{marginRight:8}} />DO NOT ALLOW ENTRY</div>
              <div style={{ fontSize:13, color:"var(--muted)", marginTop:4 }}>Ticket already redeemed</div>
            </div>
          )}
          <button onClick={reset} style={{ width:"100%", background:"none", border:"1px solid var(--border)", color:"var(--muted)", borderRadius:10, padding:"12px 24px", cursor:"pointer", fontWeight:600, fontSize:14 }}>
            <i className="fa-solid fa-camera" style={{marginRight:8}} />Scan Another Ticket
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
            <div style={{ fontSize:64, marginBottom:12 }}>{confirmResult.ok ? <i className="fa-solid fa-circle-check" style={{color:"var(--green)"}} /> : <i className="fa-solid fa-circle-xmark" style={{color:"var(--red)"}} />}</div>
            <div style={{ fontFamily:"Oswald", fontSize:36, color: confirmResult.ok ? "var(--green)" : "var(--red)", marginBottom:8 }}>
              {confirmResult.ok ? "ENTRY GRANTED" : "ENTRY DENIED"}
            </div>
            {confirmResult.ticket && (
              <div style={{ fontSize:15, color:"var(--text)", marginBottom:4 }}>{confirmResult.ticket.userName}</div>
            )}
            <div style={{ fontSize:13, color:"var(--muted)" }}>{confirmResult.msg}</div>
          </div>
          <button onClick={reset} style={{ width:"100%", background:"var(--gold)", color:"#000", border:"none", borderRadius:12, padding:"16px 24px", cursor:"pointer", fontFamily:"Oswald", fontSize:22, letterSpacing:1 }}>
            <i className="fa-solid fa-camera" style={{marginRight:8}} />SCAN NEXT TICKET
          </button>
        </div>
      )}

      {/* ── ERROR ── */}
      {stage === "error" && (
        <div style={{ background:"rgba(232,64,64,0.08)", border:"1px solid var(--red)", borderRadius:16, padding:32, textAlign:"center", animation:"fadeUp 0.3s ease" }}>
          <div style={{ fontSize:48, marginBottom:12, color:"var(--red)" }}><i className="fa-solid fa-circle-xmark" /></div>
          <div style={{ fontFamily:"Oswald", fontSize:26, color:"var(--red)", marginBottom:8 }}>SCAN FAILED</div>
          <p style={{ color:"var(--muted)", fontSize:13, marginBottom:24 }}>{errorMsg}</p>
          <button onClick={() => fileInputRef.current?.click()} style={{ background:"var(--gold)", color:"#000", border:"none", padding:"12px 28px", borderRadius:10, cursor:"pointer", fontFamily:"Oswald", fontSize:18, letterSpacing:1, marginBottom:10, width:"100%" }}>
            <i className="fa-solid fa-camera" style={{marginRight:8}} />TRY AGAIN
          </button>
          <button onClick={reset} style={{ width:"100%", background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:"10px 24px", borderRadius:8, cursor:"pointer", fontSize:13 }}>
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}

// ── Analytics Page (/dashboard/analytics/:eventId) ────────────────────────
function AnalyticsPage({ ctx }) {
  const { eventId } = useParams();
  const { organizerEvents, tickets, currentUser, issueComplimentaryTickets } = ctx;
  const navigate = useNavigate();
  const event = organizerEvents.find(e => e.id === eventId);
  const [notifStatus, setNotifStatus] = useState("idle"); // idle | sending | sent | error
  const [compTierId, setCompTierId] = useState("");
  const [compQty, setCompQty] = useState("1");
  const [compName, setCompName] = useState("");
  const [compEmail, setCompEmail] = useState("");
  const [compStatus, setCompStatus] = useState({ type: "idle", msg: "" });

  useEffect(() => {
    if (!event?.tiers?.length) return;
    setCompTierId(prev => (prev && event.tiers.some(t => t.id === prev)) ? prev : event.tiers[0].id);
  }, [event]);

  if (!event || !isEventManager(event, currentUser)) return <Navigate to="/dashboard" />;

  const eventTickets = tickets.filter(t => t.eventId === eventId);
  const sold = eventTickets.length;
  const cap  = event.tiers.reduce((s,t) => s + (t.total||0), 0);
  const rev  = eventTickets.reduce((s,t) => s + (t.price||0), 0);
  const checkedIn = eventTickets.filter(t => t.used).length;
  const fillPct = cap ? Math.round((sold/cap)*100) : 0;
  const checkPct = sold ? Math.round((checkedIn/sold)*100) : 0;
  // Build daily sales data from ticket purchasedAt
  const dailySales = {};
  eventTickets.forEach(t => {
    const day = new Date(t.purchasedAt).toLocaleDateString("en-NG", { month:"short", day:"numeric" });
    dailySales[day] = (dailySales[day]||0) + 1;
  });
  const salesData = Object.entries(dailySales).slice(-14); // last 14 days

  // Tier breakdown
  const tierData = event.tiers.map(t => {
    const tierTickets = eventTickets.filter(ticket => (ticket.tierId ? ticket.tierId === t.id : ticket.tierName === t.name));
    const soldCount = tierTickets.length;
    return {
      name: t.name,
      sold: soldCount,
      total: t.total,
      rev: tierTickets.reduce((sum, ticket) => sum + Number(ticket.price || 0), 0),
      pct: t.total ? Math.round((soldCount / t.total) * 100) : 0,
    };
  });

  // Send push notification to all ticket holders
  const sendNotification = async (title, body) => {
    setNotifStatus("sending");
    try {
      const userIds = [...new Set(eventTickets.map(t => t.userId))];

      await addDoc(collection(db, "notifications"), {
        eventId,
        eventTitle: event.title,
        title,
        body,
        sentBy: currentUser.uid,
        sentAt: new Date().toISOString(),
        targetUsers: userIds,
        readBy: [],
      });

      const recipientMap = {};
      eventTickets.forEach((t) => {
        if (t.userEmail && !recipientMap[t.userEmail]) {
          recipientMap[t.userEmail] = { email: t.userEmail, name: t.userName };
        }
      });
      const recipients = Object.values(recipientMap);

      if (recipients.length > 0) {
        const emailRes = await fetch("/api/send-notification-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipients,
            eventTitle: event.title,
            eventDate: event.date ? new Date(event.date).toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "",
            eventVenue: event.venue,
            notifTitle: title,
            notifBody: body,
            eventImage: event.image || null,
            themeColor: { purple: "#6a11cb", fire: "#f83600", ocean: "#0575e6", forest: "#134e5e", gold: "#f7971e", rose: "#f953c6", midnight: "#232526", neon: "#00f260", sunset: "#f857a4", teal: "#11998e", royal: "#141e30" }[event.theme] || "#f5a623",
          }),
        });
        const emailPayload = await emailRes.json().catch(() => ({}));
        if (!emailRes.ok) {
          throw new Error(emailPayload?.error || "Could not send attendee emails");
        }
      }

      setNotifStatus("sent");
      setTimeout(() => setNotifStatus("idle"), 3000);
    } catch (err) {
      console.error(err);
      setNotifStatus("error");
      setTimeout(() => setNotifStatus("idle"), 3000);
    }
  };

  const handleIssueComp = async () => {
    if (!compTierId) return;
    setCompStatus({ type: "sending", msg: "Issuing complimentary tickets..." });
    const res = await issueComplimentaryTickets({
      eventId,
      tierId: compTierId,
      qty: Number(compQty || 0),
      attendeeName: compName,
      attendeeEmail: compEmail,
    });
    if (res.ok) {
      setCompStatus({ type: "sent", msg: `${res.count} complimentary ticket(s) issued.` });
      setCompQty("1");
      setCompName("");
      setCompEmail("");
      setTimeout(() => setCompStatus({ type: "idle", msg: "" }), 2500);
      return;
    }
    setCompStatus({ type: "error", msg: res.msg || "Could not issue complimentary tickets." });
  };

  const maxBar = Math.max(...salesData.map(([,v]) => v), 1);

  return (
    <div style={{ maxWidth:900, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <button onClick={() => navigate("/dashboard")} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", marginBottom:24, fontSize:14 }}>← Dashboard</button>

      {/* Header */}
      <div style={{ display:"flex", gap:20, alignItems:"center", marginBottom:40, flexWrap:"wrap" }}>
        <img
          src={getEventImageSrc(event)}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = DEFAULT_EVENT_IMAGE;
          }}
          style={{ width:80, height:80, objectFit:"cover", borderRadius:12, flexShrink:0 }}
          alt=""
        />
        <div>
          <div style={{ fontSize:11, letterSpacing:3, color:"var(--gold)", marginBottom:4 }}>ANALYTICS</div>
          <h1 style={{ fontSize:"clamp(28px,5vw,48px)", lineHeight:1 }}>{event.title}</h1>
          <div style={{ color:"var(--muted)", fontSize:13, marginTop:4 }}>{fmtDate(event.date)} · {event.venue}</div>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:16, marginBottom:32 }}>
        {[
          { label:"Revenue", value:fmt(rev), icon:"fa-solid fa-naira-sign", color:"var(--gold)" },
          { label:"Tickets Sold", value:`${sold} / ${cap}`, icon:"fa-solid fa-ticket", color:"var(--text)" },
          { label:"Fill Rate", value:`${fillPct}%`, icon:"fa-solid fa-chart-pie", color: fillPct>80?"var(--red)":"var(--green)" },
          { label:"Checked In", value:`${checkedIn} / ${sold}`, icon:"fa-solid fa-circle-check", color:"var(--green)" },
          { label:"Check-in Rate", value:`${checkPct}%`, icon:"fa-solid fa-door-open", color:"var(--text)" },
          { label:"Avg. Ticket", value: sold ? fmt(Math.round(rev/sold)) : "₦0", icon:"fa-solid fa-receipt", color:"var(--muted)" },
        ].map(s => (
          <div key={s.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"20px 16px" }}>
            <div style={{ fontSize:24, marginBottom:8, color:s.color }}><i className={s.icon} /></div>
            <div style={{ fontFamily:"Oswald", fontSize:26, color:s.color, lineHeight:1, marginBottom:4 }}>{s.value}</div>
            <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Daily sales chart */}
      {salesData.length > 0 && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:24, marginBottom:24 }}>
          <h3 style={{ fontSize:20, marginBottom:20 }}>DAILY TICKET SALES</h3>
          <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:120, overflowX:"auto", paddingBottom:8 }}>
            {salesData.map(([day, count]) => (
              <div key={day} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, flex:"0 0 auto", minWidth:40 }}>
                <div style={{ fontSize:11, color:"var(--gold)", fontWeight:700 }}>{count}</div>
                <div style={{ width:32, background:"var(--gold)", borderRadius:"4px 4px 0 0", height:`${(count/maxBar)*100}px`, transition:"height 0.4s", minHeight:4 }} />
                <div style={{ fontSize:10, color:"var(--muted)", whiteSpace:"nowrap", transform:"rotate(-35deg)", transformOrigin:"top center", marginTop:8 }}>{day}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tier breakdown */}
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:24, marginBottom:24 }}>
        <h3 style={{ fontSize:20, marginBottom:20 }}>TIER BREAKDOWN</h3>
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {tierData.map(t => (
            <div key={t.name}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <div>
                  <span style={{ fontWeight:600, fontSize:14 }}>{t.name}</span>
                  <span style={{ color:"var(--muted)", fontSize:13, marginLeft:10 }}>{t.sold} / {t.total} sold</span>
                </div>
                <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                  <span style={{ fontFamily:"Oswald", fontSize:20, color:"var(--gold)" }}>{fmt(t.rev)}</span>
                  <span style={{ fontSize:12, color: t.pct>80?"var(--red)":"var(--muted)", minWidth:36, textAlign:"right" }}>{t.pct}%</span>
                </div>
              </div>
              <div style={{ height:6, background:"var(--border)", borderRadius:3 }}>
                <div style={{ height:"100%", width:`${t.pct}%`, background: t.pct>80?"var(--red)":"var(--gold)", borderRadius:3, transition:"width 0.4s" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:24, marginBottom:24 }}>
        <h3 style={{ fontSize:20, marginBottom:8 }}>COMPLIMENTARY TICKETS</h3>
        <p style={{ color:"var(--muted)", fontSize:13, marginBottom:16 }}>Issue free tickets to guests without checkout.</p>
        <div style={{ display:"grid", gridTemplateColumns:"1.2fr 0.7fr 1fr 1fr auto", gap:10, alignItems:"end" }}>
          <div>
            <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>TIER</label>
            <select value={compTierId} onChange={e => setCompTierId(e.target.value)} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }}>
              {event.tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>QTY</label>
            <input type="number" min="1" value={compQty} onChange={e => setCompQty(e.target.value)} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
          </div>
          <div>
            <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>ATTENDEE NAME</label>
            <input value={compName} onChange={e => setCompName(e.target.value)} placeholder="Optional" style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
          </div>
          <div>
            <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>ATTENDEE EMAIL</label>
            <input type="email" value={compEmail} onChange={e => setCompEmail(e.target.value)} placeholder="Optional" style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:13, outline:"none" }} />
          </div>
          <button
            onClick={handleIssueComp}
            disabled={!compTierId || Number(compQty || 0) <= 0 || compStatus.type === "sending"}
            style={{ background: (!compTierId || Number(compQty || 0) <= 0) ? "var(--bg3)" : "var(--gold)", color: (!compTierId || Number(compQty || 0) <= 0) ? "var(--muted)" : "#000", border:"none", borderRadius:9, padding:"10px 14px", cursor: (!compTierId || Number(compQty || 0) <= 0) ? "not-allowed" : "pointer", fontWeight:700, fontSize:12, letterSpacing:1, whiteSpace:"nowrap" }}
          >
            {compStatus.type === "sending" ? "ISSUING..." : "ISSUE COMP"}
          </button>
        </div>
        {compStatus.type !== "idle" && (
          <div style={{ marginTop:12, fontSize:12, color: compStatus.type === "error" ? "var(--red)" : compStatus.type === "sent" ? "var(--green)" : "var(--muted)" }}>
            {compStatus.msg}
          </div>
        )}
      </div>

      {/* Push notification panel */}
      <NotificationSender event={event} eventTickets={eventTickets} onSend={sendNotification} status={notifStatus} />

      {/* Waitlist panel */}
      <WaitlistPanel eventId={eventId} event={event} />

      {/* Recent buyers */}
      {eventTickets.length > 0 && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden", marginTop:24 }}>
          <div style={{ padding:"16px 24px", borderBottom:"1px solid var(--border)" }}>
            <h3 style={{ fontSize:20 }}>RECENT BUYERS</h3>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:"var(--bg3)" }}>
                  {["Buyer","Tier","Price","Purchased","Status"].map(h => (
                    <th key={h} style={{ padding:"10px 16px", textAlign:"left", color:"var(--muted)", fontWeight:600, fontSize:11, letterSpacing:1, whiteSpace:"nowrap" }}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...eventTickets].sort((a,b) => new Date(b.purchasedAt)-new Date(a.purchasedAt)).slice(0,20).map((t,i) => (
                  <tr key={t.id} style={{ borderTop:"1px solid var(--border)", background: i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
                    <td style={{ padding:"10px 16px", fontWeight:600 }}>{t.userName}</td>
                    <td style={{ padding:"10px 16px", color:"var(--gold)" }}>{t.tierName}</td>
                    <td style={{ padding:"10px 16px", fontFamily:"IBM Plex Mono", fontSize:12 }}>{fmt(t.price)}</td>
                    <td style={{ padding:"10px 16px", color:"var(--muted)", whiteSpace:"nowrap" }}>{new Date(t.purchasedAt).toLocaleDateString("en-NG")}</td>
                    <td style={{ padding:"10px 16px" }}>
                      <span style={{ background: t.used?"rgba(61,220,132,0.15)":"rgba(245,166,35,0.15)", color: t.used?"var(--green)":"var(--gold)", padding:"2px 10px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                        {t.used ? "✓ Checked In" : "Pending"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notification Sender Panel ─────────────────────────────────────────────
function NotificationSender({ event, eventTickets, onSend, status }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const buyers = [...new Set(eventTickets.map(t => t.userId))].length;

  const quickMessages = [
    { label:"Event Reminder", title:`${event.title} is Tomorrow!`, body:`Don't forget — ${event.title} is happening tomorrow at ${event.venue}. See you there!` },
    { label:"Venue Update", title:"Venue Information", body:`Gates open at ${event.time||"the event time"}. Please bring your QR ticket for quick entry at ${event.venue}.` },
    { label:"⚡ Last Tickets", title:"Almost Sold Out!", body:`Only a few tickets left for ${event.title}. Share with friends before it's too late!` },
  ];

  return (
    <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden" }}>
      <button onClick={() => setOpen(p=>!p)} style={{ width:"100%", padding:"20px 24px", background:"none", border:"none", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", color:"var(--text)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <i className="fa-solid fa-bell" style={{fontSize:22,color:"var(--gold)"}} />
          <div style={{ textAlign:"left" }}>
            <div style={{ fontFamily:"Oswald", fontSize:20, letterSpacing:1 }}>SEND NOTIFICATION</div>
            <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>Message all {buyers} ticket holder{buyers!==1?"s":""} for this event</div>
          </div>
        </div>
        <span style={{ color:"var(--muted)", fontSize:20, transition:"transform 0.2s", transform: open?"rotate(180deg)":"rotate(0)" }}>▾</span>
      </button>

      {open && (
        <div style={{ padding:"0 24px 24px", borderTop:"1px solid var(--border)" }}>
          {/* Quick templates */}
          <div style={{ marginTop:20, marginBottom:16 }}>
            <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:10 }}>QUICK TEMPLATES</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {quickMessages.map(q => (
                <button key={q.label} onClick={() => { setTitle(q.title); setBody(q.body); }} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)", padding:"6px 14px", borderRadius:100, cursor:"pointer", fontSize:12, fontWeight:500, transition:"border-color 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor="var(--gold)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor="var(--border)"}
                >{q.label}</button>
              ))}
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div>
              <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>NOTIFICATION TITLE</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Event Reminder" maxLength={80}
                style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:14, outline:"none" }} />
            </div>
            <div>
              <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>MESSAGE</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder="Write your message to ticket holders..." maxLength={300}
                style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:14, resize:"vertical", fontFamily:"Manrope", outline:"none" }} />
              <div style={{ textAlign:"right", fontSize:11, color:"var(--muted)", marginTop:4 }}>{body.length}/300</div>
            </div>

            {/* Preview */}
            {(title || body) && (
              <div style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:14 }}>
                <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:8 }}>PREVIEW</div>
                <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                  <div style={{ width:36, height:36, borderRadius:8, background:"var(--gold)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><i className="fa-solid fa-star" style={{color:"#000",fontSize:16}} /></div>
                  <div>
                    <div style={{ fontWeight:700, fontSize:13, marginBottom:2 }}>{title || "Notification title"}</div>
                    <div style={{ color:"var(--muted)", fontSize:12, lineHeight:1.5 }}>{body || "Your message here..."}</div>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => onSend(title, body)}
              disabled={!title || !body || status === "sending" || buyers === 0}
              style={{ background: title&&body&&buyers>0?"var(--gold)":"var(--bg3)", color: title&&body&&buyers>0?"#000":"var(--muted)", border:"none", padding:"13px 20px", borderRadius:10, cursor: title&&body&&buyers>0?"pointer":"not-allowed", fontFamily:"Oswald", fontSize:18, letterSpacing:2, transition:"all 0.2s" }}
            >
              {status === "sending" ? "SENDING..." : status === "sent" ? "SENT!" : status === "error" ? "FAILED" : `SEND TO ${buyers} ATTENDEE${buyers!==1?"S":""}`}
            </button>
            {buyers === 0 && <div style={{ fontSize:12, color:"var(--muted)", textAlign:"center" }}>No ticket holders yet — notifications will be available once tickets are sold.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notification Bell — shows in-app notifications for attendees ───────────
function useNotifications(currentUser, events) {
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!currentUser || currentUser.role !== "customer") return;
    // Poll Firestore for notifications targeting this user every 60s
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, "notifications"));
        const all = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(n => n.targetUsers?.includes(currentUser.uid))
          .sort((a,b) => new Date(b.sentAt) - new Date(a.sentAt))
          .slice(0, 20);
        setNotifs(all);
        setUnread(all.filter(n => !n.readBy?.includes(currentUser.uid)).length);
      } catch {}
    };
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const markRead = async (notifId) => {
    try {
      await updateDoc(doc(db, "notifications", notifId), {
        readBy: [...(notifs.find(n=>n.id===notifId)?.readBy||[]), currentUser.uid],
      });
      setNotifs(prev => prev.map(n => n.id===notifId ? { ...n, readBy:[...(n.readBy||[]), currentUser.uid] } : n));
      setUnread(p => Math.max(0, p-1));
    } catch {}
  };

  const markAllRead = async () => {
    const unreadNotifs = notifs.filter(n => !n.readBy?.includes(currentUser.uid));
    for (const n of unreadNotifs) await markRead(n.id);
  };

  return { notifs, unread, markRead, markAllRead };
}

function NotificationBell({ currentUser, events }) {
  const { notifs, unread, markRead, markAllRead } = useNotifications(currentUser, events);
  const [open, setOpen] = useState(false);

  if (!currentUser || currentUser.role !== "customer") return null;

  return (
    <div style={{ position:"relative" }}>
      <button onClick={() => { setOpen(p=>!p); if (unread>0) markAllRead(); }}
        style={{ position:"relative", background:"none", border:"1px solid var(--border)", borderRadius:8, width:36, height:36, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}
      >
        <i className="fa-solid fa-bell" style={{ fontSize:16, color:"var(--muted)" }} />
        {unread > 0 && (
          <span style={{ position:"absolute", top:-4, right:-4, background:"var(--red)", color:"#fff", borderRadius:"50%", width:16, height:16, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:"fixed", inset:0, zIndex:998 }} />
          <div style={{ position:"absolute", right:0, top:44, width:320, background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, zIndex:999, overflow:"hidden", boxShadow:"0 8px 32px rgba(0,0,0,0.4)", animation:"fadeUp 0.2s ease" }}>
            <div style={{ padding:"14px 16px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontFamily:"Oswald", fontSize:18, letterSpacing:1 }}>NOTIFICATIONS</span>
              {notifs.length > 0 && <button onClick={markAllRead} style={{ background:"none", border:"none", color:"var(--gold)", fontSize:12, cursor:"pointer" }}>Mark all read</button>}
            </div>
            {notifs.length === 0 ? (
              <div style={{ padding:"32px 16px", textAlign:"center", color:"var(--muted)", fontSize:13 }}>No notifications yet</div>
            ) : (
              <div style={{ maxHeight:360, overflowY:"auto" }}>
                {notifs.map(n => {
                  const isRead = n.readBy?.includes(currentUser.uid);
                  return (
                    <div key={n.id} onClick={() => markRead(n.id)}
                      style={{ padding:"14px 16px", borderBottom:"1px solid var(--border)", cursor:"pointer", background: isRead?"transparent":"rgba(245,166,35,0.05)", transition:"background 0.2s" }}
                    >
                      <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                        {!isRead && <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--gold)", flexShrink:0, marginTop:5 }} />}
                        <div style={{ flex:1, paddingLeft: isRead?16:0 }}>
                          <div style={{ fontWeight:700, fontSize:13, marginBottom:3 }}>{n.title}</div>
                          <div style={{ color:"var(--muted)", fontSize:12, lineHeight:1.5, marginBottom:4 }}>{n.body}</div>
                          <div style={{ fontSize:11, color:"var(--gold)" }}>{new Date(n.sentAt).toLocaleDateString("en-NG", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Profile Page (/profile) ───────────────────────────────────────────────
async function fetchAdminDashboardData() {
  const [usersSnap, eventsSnap, ticketsSnap, payoutsSnap] = await Promise.all([
    getDocs(query(collection(db, "users"), where("role", "==", "organizer"))),
    getDocs(collection(db, "events")),
    getDocs(collection(db, "tickets")),
    getDocs(collection(db, "payouts")),
  ]);

  return {
    organizers: usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })),
    events: eventsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    tickets: ticketsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    payoutRecords: payoutsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.paidAt || b.createdAt || 0) - new Date(a.paidAt || a.createdAt || 0)),
  };
}

function buildOrganizerPayoutCards(organizers, events, tickets, payoutRecords) {
  return organizers.map(organizer => {
    const ownedEvents = events.filter(event => event.organizer === organizer.uid);
    const ownedEventIds = new Set(ownedEvents.map(event => event.id));
    const organizerTickets = tickets.filter(ticket => ownedEventIds.has(ticket.eventId));
    const summary = calculatePayoutSummary(organizerTickets);
    const organizerPayouts = payoutRecords.filter(record => record.organizerId === organizer.uid);
    const paidOut = organizerPayouts
      .filter(record => record.status === "paid" || record.status === "processing")
      .reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
    const outstanding = Math.max(0, summary.net - paidOut);
    return { organizer, ownedEvents, organizerTickets, summary, organizerPayouts, paidOut, outstanding };
  }).sort((a, b) => b.outstanding - a.outstanding);
}

function AdminHomePage({ ctx }) {
  const { notify } = ctx;
  const [loading, setLoading] = useState(true);
  const [adminData, setAdminData] = useState({ organizers: [], events: [], tickets: [], payoutRecords: [] });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        setAdminData(await fetchAdminDashboardData());
      } catch (err) {
        console.error("Admin overview fetch failed:", err);
        notify("Could not load admin dashboard.", "error");
      }
      setLoading(false);
    };
    load();
  }, [notify]);

  if (loading) return <Spinner />;

  const { organizers, events, tickets, payoutRecords } = adminData;
  const organizerCards = buildOrganizerPayoutCards(organizers, events, tickets, payoutRecords);
  const totalOutstanding = organizerCards.reduce((sum, card) => sum + card.outstanding, 0);
  const grossRevenue = organizerCards.reduce((sum, card) => sum + card.summary.gross, 0);
  const paidOut = payoutRecords
    .filter(record => record.status === "paid")
    .reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
  const missingBankDetails = organizerCards.filter(card => {
    const payoutDetails = card.organizer.payoutDetails || {};
    return !(
      payoutDetails.bankName?.trim() &&
      payoutDetails.accountName?.trim() &&
      payoutDetails.accountNumber?.trim()
    );
  }).length;
  const recentPayouts = payoutRecords.slice(0, 5);
  const topOutstanding = organizerCards.slice(0, 4);

  return (
    <div style={{ maxWidth:1200, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", gap:20, flexWrap:"wrap", marginBottom:28 }}>
        <div>
          <div style={{ fontSize:12, color:"var(--gold)", letterSpacing:2, marginBottom:10 }}>ADMIN CONTROL</div>
          <h1 style={{ fontSize:"clamp(38px,6vw,58px)", lineHeight:0.95, marginBottom:10 }}>Run StagePro from one place.</h1>
          <div style={{ color:"var(--muted)", maxWidth:620, lineHeight:1.8, fontSize:14 }}>
            Monitor organizer balances, keep payouts current, and stay on top of event activity without jumping through separate screens.
          </div>
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <Link to="/admin/payouts" style={{ background:"var(--gold)", color:"#000", padding:"12px 18px", borderRadius:10, fontWeight:700, fontSize:13 }}>
            Open Payouts
          </Link>
          <Link to="/admin" style={{ border:"1px solid var(--border)", color:"var(--text)", padding:"12px 18px", borderRadius:10, fontWeight:600, fontSize:13 }}>
            Pick Organizer View
          </Link>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:14, marginBottom:24 }}>
        {[
          { label:"Organizers", value:String(organizers.length), tone:"var(--gold)", icon:"fa-solid fa-users" },
          { label:"Live Events", value:String(events.length), tone:"var(--text)", icon:"fa-solid fa-calendar-days" },
          { label:"Gross Sales", value:fmt(grossRevenue), tone:"var(--green)", icon:"fa-solid fa-naira-sign" },
          { label:"Outstanding Payouts", value:fmt(totalOutstanding), tone:"var(--gold)", icon:"fa-solid fa-wallet" },
          { label:"Paid Out", value:fmt(paidOut), tone:"var(--muted)", icon:"fa-solid fa-building-columns" },
          { label:"Missing Bank Details", value:String(missingBankDetails), tone: missingBankDetails ? "var(--red)" : "var(--green)", icon:"fa-solid fa-circle-exclamation" },
        ].map(item => (
          <div key={item.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:18, padding:"18px 18px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ color:"var(--muted)", fontSize:11, letterSpacing:1 }}>{item.label.toUpperCase()}</div>
              <i className={item.icon} style={{ color:item.tone, fontSize:16 }} />
            </div>
            <div style={{ fontFamily:"Oswald", fontSize:32, color:item.tone, lineHeight:1 }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1.2fr) minmax(320px,0.8fr)", gap:18 }}>
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:18, padding:22 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
            <div>
              <div style={{ fontFamily:"Oswald", fontSize:28, lineHeight:1 }}>Highest Outstanding Balances</div>
              <div style={{ color:"var(--muted)", fontSize:13, marginTop:4 }}>Start with the organizers who need settlement attention first.</div>
            </div>
            <Link to="/admin/payouts" style={{ color:"var(--gold)", fontWeight:700, fontSize:13 }}>Manage payouts</Link>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {topOutstanding.length === 0 ? (
              <div style={{ color:"var(--muted)", fontSize:14 }}>No organizer payout data yet.</div>
            ) : topOutstanding.map(card => {
              const payoutDetails = card.organizer.payoutDetails || {};
              const bankReady = Boolean(
                payoutDetails.bankName?.trim() &&
                payoutDetails.accountName?.trim() &&
                payoutDetails.accountNumber?.trim()
              );
              return (
                <div key={card.organizer.uid} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:14, padding:"16px 18px", display:"flex", justifyContent:"space-between", gap:14, flexWrap:"wrap" }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>{card.organizer.name}</div>
                    <div style={{ color:"var(--muted)", fontSize:13 }}>{card.organizer.email}</div>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:10 }}>
                      <span style={{ background:"rgba(245,166,35,0.12)", color:"var(--gold)", padding:"4px 10px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                        {card.ownedEvents.length} event{card.ownedEvents.length !== 1 ? "s" : ""}
                      </span>
                      <span style={{ background: bankReady ? "rgba(61,220,132,0.14)" : "rgba(244,90,90,0.12)", color: bankReady ? "var(--green)" : "var(--red)", padding:"4px 10px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                        {bankReady ? "bank ready" : "needs bank details"}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:"var(--muted)", fontSize:11, letterSpacing:1, marginBottom:6 }}>OUTSTANDING</div>
                    <div style={{ fontFamily:"Oswald", fontSize:30, color:"var(--green)", lineHeight:1 }}>{fmt(card.outstanding)}</div>
                    <div style={{ color:"var(--muted)", fontSize:12, marginTop:8 }}>{card.summary.paidTickets.length} paid tickets</div>
                    <Link to={`/dashboard?organizerId=${encodeURIComponent(card.organizer.uid)}`} style={{ color:"var(--gold)", fontSize:12, fontWeight:700, display:"inline-block", marginTop:10 }}>
                      Open Dashboard
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:18, padding:22 }}>
            <div style={{ fontFamily:"Oswald", fontSize:28, lineHeight:1, marginBottom:12 }}>Admin Sections</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                { to:"/admin/payouts", title:"Payout Management", body:"Review bank details, outstanding balances, and mark transfers as paid.", icon:"fa-solid fa-building-columns" },
                { to:"/find-tickets", title:"Ticket Recovery", body:"Use the customer-safe recovery flow exactly as your attendees see it.", icon:"fa-solid fa-ticket" },
                { to:"/profile", title:"Account Settings", body:"Check the current admin account profile and role context.", icon:"fa-solid fa-user-shield" },
              ].map(section => (
                <Link key={section.title} to={section.to} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:14, padding:"16px 18px", display:"flex", gap:14, alignItems:"flex-start", color:"inherit" }}>
                  <div style={{ width:40, height:40, borderRadius:12, background:"rgba(245,166,35,0.14)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--gold)", flexShrink:0 }}>
                    <i className={section.icon} />
                  </div>
                  <div>
                    <div style={{ fontWeight:700, marginBottom:4 }}>{section.title}</div>
                    <div style={{ color:"var(--muted)", fontSize:13, lineHeight:1.7 }}>{section.body}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:18, padding:22 }}>
            <div style={{ fontFamily:"Oswald", fontSize:28, lineHeight:1, marginBottom:12 }}>Recent Payout Activity</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {recentPayouts.length === 0 ? (
                <div style={{ color:"var(--muted)", fontSize:14 }}>No payout activity has been recorded yet.</div>
              ) : recentPayouts.map(record => (
                <div key={record.id} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:14, padding:"14px 16px", display:"flex", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
                  <div>
                    <div style={{ fontWeight:700 }}>{record.organizerName || "Organizer"}</div>
                    <div style={{ color:"var(--muted)", fontSize:12 }}>
                      {new Date(record.paidAt || record.createdAt || Date.now()).toLocaleDateString("en-NG", { month:"short", day:"numeric", year:"numeric" })}
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:"var(--green)", fontFamily:"IBM Plex Mono", fontSize:15 }}>{fmt(Number(record.amount) || 0)}</div>
                    <div style={{ color:"var(--muted)", fontSize:12 }}>{record.notes || "Manual payout"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminPayoutsPage({ ctx }) {
  const { currentUser, notify } = ctx;
  const [loading, setLoading] = useState(true);
  const [organizers, setOrganizers] = useState([]);
  const [events, setEvents] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [payoutRecords, setPayoutRecords] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [recordingId, setRecordingId] = useState(null);
  const [runningBackfill, setRunningBackfill] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchAdminDashboardData();
        setOrganizers(data.organizers);
        setEvents(data.events);
        setTickets(data.tickets);
        setPayoutRecords(data.payoutRecords);
      } catch (err) {
        console.error("Admin payout fetch failed:", err);
        notify("Could not load payout data.", "error");
      }
      setLoading(false);
    };
    load();
  }, [notify]);

  const reloadAdminData = async () => {
    const data = await fetchAdminDashboardData();
    setOrganizers(data.organizers);
    setEvents(data.events);
    setTickets(data.tickets);
    setPayoutRecords(data.payoutRecords);
  };

  const updateDraft = (organizerId, patch) => {
    setDrafts(prev => ({
      ...prev,
      [organizerId]: {
        amount: prev[organizerId]?.amount || "",
        notes: prev[organizerId]?.notes || "",
        ...patch,
      },
    }));
  };

  const organizerCards = buildOrganizerPayoutCards(organizers, events, tickets, payoutRecords);

  const markAsPaid = async (card) => {
    const draft = drafts[card.organizer.uid] || {};
    const amount = Number(draft.amount || card.outstanding);
    if (!amount || amount <= 0) {
      notify("Enter a payout amount first.", "error");
      return;
    }

    setRecordingId(card.organizer.uid);
    try {
      const now = new Date().toISOString();
      const ref = await addDoc(collection(db, "payouts"), {
        organizerId: card.organizer.uid,
        organizerName: card.organizer.name,
        amount,
        notes: draft.notes?.trim() || "",
        status: "paid",
        createdAt: now,
        paidAt: now,
        recordedBy: currentUser.uid,
        bankSnapshot: card.organizer.payoutDetails || null,
      });
      setPayoutRecords(prev => [
        {
          id: ref.id,
          organizerId: card.organizer.uid,
          organizerName: card.organizer.name,
          amount,
          notes: draft.notes?.trim() || "",
          status: "paid",
          createdAt: now,
          paidAt: now,
          recordedBy: currentUser.uid,
          bankSnapshot: card.organizer.payoutDetails || null,
        },
        ...prev,
      ]);
      setDrafts(prev => ({ ...prev, [card.organizer.uid]: { amount: "", notes: "" } }));
      notify("Payout recorded.");
    } catch (err) {
      console.error("Payout record failed:", err);
      notify("Could not record payout.", "error");
    }
    setRecordingId(null);
  };

  const runTierIdBackfill = async () => {
    setRunningBackfill(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("No admin token available");
      const res = await fetch("/api/backfill-tier-ids", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.msg || "Backfill failed");
      notify(`TierId backfill complete: ${data.updated || 0} ticket(s) updated.`);
      await reloadAdminData();
    } catch (err) {
      console.error("TierId backfill failed:", err);
      notify(err?.message || "Could not backfill tier IDs.", "error");
    }
    setRunningBackfill(false);
  };

  return (
    <div style={{ maxWidth:1200, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:16, flexWrap:"wrap", marginBottom:28 }}>
        <div>
          <div style={{ marginBottom:12 }}>
            <Link to="/admin" style={{ color:"var(--muted)", fontSize:13, fontWeight:600 }}>
              <i className="fa-solid fa-arrow-left" style={{ marginRight:8 }} />
              Back to admin
            </Link>
          </div>
          <h1 style={{ fontSize:"clamp(36px,6vw,52px)", lineHeight:1, marginBottom:6 }}>PAYOUT ADMIN</h1>
          <div style={{ color:"var(--muted)", fontSize:14 }}>Track organizer bank details, outstanding balances, and manual settlements.</div>
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <button onClick={runTierIdBackfill} disabled={runningBackfill} style={{ background: runningBackfill ? "var(--bg3)" : "var(--bg2)", color: runningBackfill ? "var(--muted)" : "var(--text)", border:"1px solid var(--border)", borderRadius:12, padding:"12px 16px", cursor: runningBackfill ? "not-allowed" : "pointer", fontWeight:700, fontSize:13 }}>
            {runningBackfill ? "BACKFILLING..." : "BACKFILL TIER IDS"}
          </button>
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"12px 16px" }}>
            <div style={{ fontFamily:"Oswald", fontSize:24, color:"var(--gold)" }}>{organizerCards.length}</div>
            <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1 }}>ORGANIZERS</div>
          </div>
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"12px 16px" }}>
            <div style={{ fontFamily:"Oswald", fontSize:24, color:"var(--green)" }}>{fmt(organizerCards.reduce((sum, card) => sum + card.outstanding, 0))}</div>
            <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1 }}>OUTSTANDING</div>
          </div>
        </div>
      </div>

      {loading ? <Spinner /> : (
        <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
          {organizerCards.map(card => {
            const payoutDetails = card.organizer.payoutDetails || {};
            const hasPayoutDetails = Boolean(
              payoutDetails.bankName?.trim() &&
              payoutDetails.accountName?.trim() &&
              payoutDetails.accountNumber?.trim()
            );
            const draft = drafts[card.organizer.uid] || {};
            const recentPayouts = card.organizerPayouts.slice(0, 5);
            return (
              <div key={card.organizer.uid} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:18, padding:22 }}>
                <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1.3fr) minmax(280px,1fr)", gap:20 }}>
                  <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap", alignItems:"flex-start" }}>
                      <div>
                        <div style={{ fontFamily:"Oswald", fontSize:28, lineHeight:1 }}>{card.organizer.name}</div>
                        <div style={{ color:"var(--muted)", fontSize:13 }}>{card.organizer.email}</div>
                      </div>
                      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                        <span style={{ background: hasPayoutDetails ? "rgba(61,220,132,0.14)" : "rgba(244,90,90,0.12)", color: hasPayoutDetails ? "var(--green)" : "var(--red)", padding:"4px 10px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                          {hasPayoutDetails ? "BANK DETAILS READY" : "BANK DETAILS MISSING"}
                        </span>
                        <span style={{ background:"rgba(245,166,35,0.12)", color:"var(--gold)", padding:"4px 10px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                          MANUAL PAYOUTS ONLY
                        </span>
                        <span style={{ background:"rgba(245,166,35,0.12)", color:"var(--gold)", padding:"4px 10px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                          {card.ownedEvents.length} EVENT{card.ownedEvents.length !== 1 ? "S" : ""}
                        </span>
                      </div>
                    </div>

                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12 }}>
                      {[
                        { label:"Gross", value:fmt(card.summary.gross), color:"var(--gold)" },
                        { label:"Net", value:fmt(card.summary.net), color:"var(--green)" },
                        { label:"Paid Out", value:fmt(card.paidOut), color:"var(--muted)" },
                        { label:"Outstanding", value:fmt(card.outstanding), color:"var(--green)" },
                      ].map(item => (
                        <div key={item.label} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:12, padding:"14px 16px" }}>
                          <div style={{ fontFamily:"Oswald", fontSize:24, color:item.color }}>{item.value}</div>
                          <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1 }}>{item.label.toUpperCase()}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:12, padding:"14px 16px" }}>
                      <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:10 }}>BANK DETAILS</div>
                      {hasPayoutDetails ? (
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:10, fontSize:13, color:"var(--muted)" }}>
                          <div><strong style={{ color:"var(--text)" }}>Bank:</strong> {payoutDetails.bankName}</div>
                          <div><strong style={{ color:"var(--text)" }}>Account name:</strong> {payoutDetails.accountName}</div>
                          <div><strong style={{ color:"var(--text)" }}>Account number:</strong> {payoutDetails.accountNumber}</div>
                          {payoutDetails.notes && <div><strong style={{ color:"var(--text)" }}>Notes:</strong> {payoutDetails.notes}</div>}
                        </div>
                      ) : (
                        <div style={{ fontSize:13, color:"var(--muted)" }}>This organizer has not added payout details yet.</div>
                      )}
                    </div>

                    <div style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:12, padding:"14px 16px" }}>
                      <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:10 }}>RECENT PAYOUTS</div>
                      {recentPayouts.length === 0 ? (
                        <div style={{ fontSize:13, color:"var(--muted)" }}>No payouts recorded yet.</div>
                      ) : (
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          {recentPayouts.map(record => (
                            <div key={record.id} style={{ display:"flex", justifyContent:"space-between", gap:10, flexWrap:"wrap", fontSize:13 }}>
                              <span style={{ color:"var(--muted)" }}>{new Date(record.paidAt || record.createdAt || Date.now()).toLocaleDateString("en-NG", { month:"short", day:"numeric", year:"numeric" })}</span>
                              <span style={{ color:"var(--green)", fontFamily:"IBM Plex Mono" }}>{fmt(Number(record.amount) || 0)}</span>
                              <span style={{ color:"var(--muted)" }}>{record.notes || (record.source === "auto" ? "Auto payout" : "Manual payout")}</span>
                              <span style={{ color: record.status === "paid" ? "var(--green)" : record.status === "failed" ? "var(--red)" : "var(--gold)", fontSize:11, fontWeight:700 }}>
                                {(record.status || "processing").toUpperCase()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ background:"rgba(245,166,35,0.06)", border:"1px solid var(--gold-dim)", borderRadius:14, padding:18, display:"flex", flexDirection:"column", gap:14 }}>
                    <div>
                      <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:8 }}>RECORD MANUAL PAYOUT</div>
                      <div style={{ color:"var(--muted)", fontSize:13, lineHeight:1.7 }}>
                        Record how much has been transferred to this organizer so their outstanding balance stays accurate.
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, display:"block", marginBottom:6 }}>AMOUNT</label>
                      <input
                        value={draft.amount ?? (card.outstanding > 0 ? String(card.outstanding) : "")}
                        onChange={e => updateDraft(card.organizer.uid, { amount: e.target.value })}
                        placeholder="0"
                        style={{ width:"100%", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none" }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, display:"block", marginBottom:6 }}>NOTES</label>
                      <textarea
                        value={draft.notes || ""}
                        onChange={e => updateDraft(card.organizer.uid, { notes: e.target.value })}
                        rows={3}
                        placeholder="Bank transfer reference, date, or internal note"
                        style={{ width:"100%", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none", resize:"vertical", fontFamily:"Manrope" }}
                      />
                    </div>

                    <button
                      onClick={() => markAsPaid(card)}
                      disabled={recordingId === card.organizer.uid}
                      style={{ background:"var(--gold)", color:"#000", border:"none", borderRadius:10, padding:"13px 18px", cursor:"pointer", fontFamily:"Oswald", fontSize:20, letterSpacing:1 }}
                    >
                      {recordingId === card.organizer.uid ? "RECORDING..." : "MARK AS PAID"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProfilePage({ ctx }) {
  const { currentUser, tickets, events, updateProfile, notify } = ctx;
  const [searchParams] = useSearchParams();
  const [name, setName] = useState(currentUser.name);
  const [phone, setPhone] = useState(currentUser.phone || "");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("info"); // info | history | payouts
  const [bankName, setBankName] = useState(currentUser.payoutDetails?.bankName || "");
  const [accountName, setAccountName] = useState(currentUser.payoutDetails?.accountName || "");
  const [accountNumber, setAccountNumber] = useState(currentUser.payoutDetails?.accountNumber || "");
  const [payoutNotes, setPayoutNotes] = useState(currentUser.payoutDetails?.notes || "");
  const [liveSheetWebhookUrl, setLiveSheetWebhookUrl] = useState(currentUser.liveSheet?.webhookUrl || "");
  const [liveSheetViewUrl, setLiveSheetViewUrl] = useState(currentUser.liveSheet?.viewUrl || "");

  const myTickets = tickets.filter(t => t.userId === currentUser.uid || currentUser.role === "customer");
  const totalSpent = myTickets.reduce((s,t) => s + (t.price||0), 0);
  const eventsAttended = [...new Set(myTickets.map(t => t.eventId))].length;
  const organizerTickets = currentUser.role === "organizer"
    ? tickets.filter(t => events.some(e => e.organizer === currentUser.uid && e.id === t.eventId))
    : [];
  const payoutSummary = currentUser.role === "organizer" ? calculatePayoutSummary(organizerTickets) : null;
  const hasPayoutDetails = Boolean(bankName.trim() && accountName.trim() && accountNumber.trim());
  const hasLiveSheetConfig = Boolean(liveSheetWebhookUrl.trim() || liveSheetViewUrl.trim());
  const phoneRequired = searchParams.get("complete") === "phone" && !String(currentUser.phone || "").trim();
  const roleMeta = currentUser.role === "admin"
    ? {
        label: "Administrator",
        icon: "fa-solid fa-user-shield",
        accountTitle: "Platform Administrator",
        description: "You can access admin controls and oversee payouts.",
      }
    : currentUser.role === "organizer"
      ? {
          label: "Organizer",
          icon: "fa-solid fa-star",
          accountTitle: "Event Organizer",
          description: "You can create and manage events.",
        }
      : {
          label: "Attendee",
          icon: "fa-solid fa-ticket",
          accountTitle: "Event Attendee",
          description: "You can purchase and manage tickets.",
        };

  const handleSave = async () => {
    if (!name.trim() || !normalizePhone(phone)) return;
    setSaving(true);
    await updateProfile({ name, phone });
    setSaving(false);
  };

  const handlePayoutSave = async () => {
    if (!name.trim() || !normalizePhone(phone)) return;
    setSaving(true);
    await updateProfile({
      name,
      phone,
      payoutDetails: {
        bankName: bankName.trim(),
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        notes: payoutNotes.trim(),
      },
    });
    setSaving(false);
  };

  const handleLiveSheetSave = async () => {
    if (!name.trim() || !normalizePhone(phone)) return;
    setSaving(true);
    await updateProfile({
      name,
      phone,
      liveSheet: {
        webhookUrl: liveSheetWebhookUrl.trim(),
        viewUrl: liveSheetViewUrl.trim(),
      },
    });
    setSaving(false);
  };

  return (
    <div style={{ maxWidth:700, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:20, marginBottom:40, flexWrap:"wrap" }}>
        <div style={{ width:80, height:80, borderRadius:"50%", background:"var(--gold)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Oswald", fontSize:40, color:"#000", flexShrink:0 }}>
          {currentUser.name?.[0]?.toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize:"clamp(28px,5vw,48px)", lineHeight:1, marginBottom:4 }}>{currentUser.name}</h1>
          <div style={{ color:"var(--muted)", fontSize:13 }}>{currentUser.email}</div>
          <div style={{ display:"inline-block", marginTop:6, background:"rgba(245,166,35,0.15)", border:"1px solid var(--gold-dim)", color:"var(--gold)", padding:"2px 12px", borderRadius:100, fontSize:12, fontWeight:700 }}>
            <><i className={roleMeta.icon} style={{marginRight:6}} />{roleMeta.label}</>
          </div>
        </div>
      </div>

      {/* Stats row — customers only */}
      {currentUser.role === "customer" && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:32 }}>
          {[
            { label:"Events", value:eventsAttended, icon:"fa-solid fa-calendar-check" },
            { label:"Tickets", value:myTickets.length, icon:"fa-solid fa-ticket" },
            { label:"Spent", value:fmt(totalSpent), icon:"fa-solid fa-naira-sign" },
          ].map(s => (
            <div key={s.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 12px", textAlign:"center" }}>
              <div style={{ fontSize:24, marginBottom:6, color:"var(--gold)" }}><i className={s.icon} /></div>
              <div style={{ fontFamily:"Oswald", fontSize:24, color:"var(--gold)" }}>{s.value}</div>
              <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1 }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", gap:4, marginBottom:24, background:"var(--bg3)", borderRadius:10, padding:4 }}>
        {[["info",<><i className="fa-solid fa-user" style={{marginRight:6}} />Account</>],["history",<><i className="fa-solid fa-clock-rotate-left" style={{marginRight:6}} />Purchase History</>], ...(currentUser.role === "organizer" ? [["payouts",<><i className="fa-solid fa-building-columns" style={{marginRight:6}} />Payouts</>]] : [])].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:"10px 16px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:13, background: tab===id?"var(--bg2)":"transparent", color: tab===id?"var(--text)":"var(--muted)", transition:"all 0.2s" }}>{label}</button>
        ))}
      </div>

      {/* Account info tab */}
      {tab === "info" && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, display:"flex", flexDirection:"column", gap:20 }}>
          {phoneRequired && (
            <div style={{ background:"rgba(245,166,35,0.08)", border:"1px solid var(--gold-dim)", borderRadius:12, padding:"12px 14px", color:"var(--gold)", fontSize:13 }}>
              Add your phone number to complete your account setup and keep ticket records consistent.
            </div>
          )}
          <div>
            <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>DISPLAY NAME</label>
            <div style={{ display:"flex", gap:10 }}>
              <input value={name} onChange={e => setName(e.target.value)}
                style={{ flex:1, background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none" }} />
              <button onClick={handleSave} disabled={saving || (name.trim() === currentUser.name && normalizePhone(phone) === normalizePhone(currentUser.phone || "")) || !normalizePhone(phone)}
                style={{ background: (name.trim() !== currentUser.name || normalizePhone(phone) !== normalizePhone(currentUser.phone || "")) && normalizePhone(phone) ? "var(--gold)" : "var(--bg3)", color: (name.trim() !== currentUser.name || normalizePhone(phone) !== normalizePhone(currentUser.phone || "")) && normalizePhone(phone) ? "#000" : "var(--muted)", border:"none", padding:"12px 20px", borderRadius:8, cursor: (name.trim() !== currentUser.name || normalizePhone(phone) !== normalizePhone(currentUser.phone || "")) && normalizePhone(phone) ? "pointer" : "not-allowed", fontWeight:700, fontSize:13, whiteSpace:"nowrap" }}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
          <div>
            <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>PHONE NUMBER</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+234 801 234 5678"
              style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none" }} />
            <div style={{ fontSize:11, color:"var(--muted)", marginTop:4 }}>A phone number is required for guest checkout follow-up and ticket support.</div>
          </div>
          <div>
            <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>EMAIL ADDRESS</label>
            <input value={currentUser.email} readOnly style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", color:"var(--muted)", fontSize:14, outline:"none", cursor:"not-allowed" }} />
            <div style={{ fontSize:11, color:"var(--muted)", marginTop:4 }}>Email cannot be changed. Contact support if needed.</div>
          </div>
          <div style={{ borderTop:"1px solid var(--border)", paddingTop:20 }}>
            <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:12, display:"block" }}>ACCOUNT TYPE</label>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:28 }}><i className={roleMeta.icon} style={{color:"var(--gold)"}} /></span>
              <div>
                <div style={{ fontWeight:600, fontSize:15 }}>{roleMeta.accountTitle}</div>
                <div style={{ color:"var(--muted)", fontSize:13 }}>{roleMeta.description}</div>
              </div>
            </div>
            {currentUser.role === "organizer" && (
              <div style={{ marginTop:20, background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:12, padding:18 }}>
                <div style={{ fontFamily:"Oswald", fontSize:22, marginBottom:6 }}>LIVE SHEET</div>
                <div style={{ color:"var(--muted)", fontSize:13, lineHeight:1.7, marginBottom:14 }}>
                  Add your Google Apps Script webhook URL to stream organizer activity into a live sheet. You can also save the sheet link so it opens directly from your dashboard.
                </div>
                <div style={{ display:"grid", gap:14 }}>
                  <div>
                    <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>SHEET WEBHOOK URL</label>
                    <input value={liveSheetWebhookUrl} onChange={e => setLiveSheetWebhookUrl(e.target.value)} placeholder="https://script.google.com/macros/s/..."
                      style={{ width:"100%", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none" }} />
                  </div>
                  <div>
                    <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>SHEET VIEW URL</label>
                    <input value={liveSheetViewUrl} onChange={e => setLiveSheetViewUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/..."
                      style={{ width:"100%", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none" }} />
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap", alignItems:"center" }}>
                    <span style={{ background: hasLiveSheetConfig ? "rgba(61,220,132,0.14)" : "rgba(245,166,35,0.12)", color: hasLiveSheetConfig ? "var(--green)" : "var(--gold)", padding:"5px 12px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                      {hasLiveSheetConfig ? "LIVE SHEET CONNECTED" : "LIVE SHEET NOT SET"}
                    </span>
                    <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                      {liveSheetViewUrl.trim() && (
                        <a href={liveSheetViewUrl.trim()} target="_blank" rel="noreferrer" style={{ background:"var(--bg2)", color:"var(--text)", border:"1px solid var(--border)", padding:"12px 16px", borderRadius:10, fontWeight:700, fontSize:13 }}>
                          Open live sheet
                        </a>
                      )}
                      <button onClick={handleLiveSheetSave} disabled={saving}
                        style={{ background:"var(--gold)", color:"#000", border:"none", padding:"12px 20px", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:13, whiteSpace:"nowrap" }}>
                        {saving ? "Saving..." : "Save live sheet"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {currentUser.role === "admin" && (
              <div style={{ marginTop:16 }}>
                <Link to="/admin" style={{ display:"inline-flex", alignItems:"center", gap:8, background:"var(--gold)", color:"#000", padding:"10px 14px", borderRadius:10, fontWeight:700, fontSize:13 }}>
                  <i className="fa-solid fa-arrow-up-right-from-square" />
                  Open Admin Dashboard
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Purchase history tab */}
      {tab === "history" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {myTickets.length === 0 ? (
            <div style={{ textAlign:"center", padding:"48px 24px", color:"var(--muted)" }}>
              <div style={{ fontSize:48, marginBottom:12, color:"var(--gold)" }}><i className="fa-solid fa-ticket" /></div>
              <div style={{ fontFamily:"Oswald", fontSize:24, color:"var(--text)", marginBottom:8 }}>NO TICKETS YET</div>
              <Link to="/" style={{ color:"var(--gold)", fontSize:14 }}>Browse events →</Link>
            </div>
          ) : [...myTickets].sort((a,b) => new Date(b.purchasedAt)-new Date(a.purchasedAt)).map(t => (
            <div key={t.id} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
              <div>
                <div style={{ fontWeight:600, fontSize:14, marginBottom:2 }}>{t.eventTitle}</div>
                <div style={{ color:"var(--muted)", fontSize:12 }}>{fmtDate(t.eventDate)} · {t.tierName}</div>
                <div style={{ color:"var(--muted)", fontSize:11, marginTop:2 }}>Purchased {new Date(t.purchasedAt).toLocaleDateString("en-NG")}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontFamily:"Oswald", fontSize:22, color:"var(--gold)" }}>{fmt(t.price)}</span>
                <span style={{ background: t.used?"rgba(61,220,132,0.15)":"rgba(245,166,35,0.15)", color: t.used?"var(--green)":"var(--gold)", padding:"2px 10px", borderRadius:100, fontSize:11, fontWeight:700 }}>{t.used?"✓ Used":"Valid"}</span>
                <Link to={`/ticket/${t.id}`} style={{ color:"var(--muted)", fontSize:12, textDecoration:"underline" }}>View</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "payouts" && currentUser.role === "organizer" && (
        <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12 }}>
            {[
              { label:"Gross Sales", value:fmt(payoutSummary?.gross || 0), color:"var(--gold)" },
              { label:"Net Payout", value:fmt(payoutSummary?.net || 0), color:"var(--green)" },
              { label:"Paid Orders", value:(payoutSummary?.orderCount || 0).toLocaleString(), color:"var(--text)" },
            ].map(item => (
              <div key={item.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"18px 16px" }}>
                <div style={{ fontFamily:"Oswald", fontSize:28, color:item.color }}>{item.value}</div>
                <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1 }}>{item.label.toUpperCase()}</div>
              </div>
            ))}
          </div>

          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, display:"flex", flexDirection:"column", gap:18 }}>
            <div>
              <div style={{ fontFamily:"Oswald", fontSize:24, marginBottom:6 }}>BANK DETAILS FOR MANUAL PAYOUTS</div>
              <div style={{ color:"var(--muted)", fontSize:13, lineHeight:1.7 }}>
                StagePro settles organizers manually for now. Add the bank account details the admin team should use when paying out your balance.
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:14 }}>
              <div>
                <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>BANK NAME</label>
                <input value={bankName} onChange={e => setBankName(e.target.value)}
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none" }} />
              </div>
              <div>
                <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>ACCOUNT NAME</label>
                <input value={accountName} onChange={e => setAccountName(e.target.value)}
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none" }} />
              </div>
              <div>
                <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>ACCOUNT NUMBER</label>
                <input value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none" }} />
              </div>
            </div>

            <div>
              <label style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>NOTES</label>
              <textarea value={payoutNotes} onChange={e => setPayoutNotes(e.target.value)} rows={3}
                placeholder="Optional note for transfers, preferred bank branch, or other payout info"
                style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none", resize:"vertical", fontFamily:"Manrope" }} />
            </div>

            <div style={{ display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap", alignItems:"center" }}>
              <span style={{ background: hasPayoutDetails ? "rgba(61,220,132,0.14)" : "rgba(245,166,35,0.12)", color: hasPayoutDetails ? "var(--green)" : "var(--gold)", padding:"5px 12px", borderRadius:100, fontSize:11, fontWeight:700 }}>
                {hasPayoutDetails ? "PAYOUT DETAILS READY" : "ADD FULL BANK DETAILS"}
              </span>
              <button onClick={handlePayoutSave} disabled={saving}
                style={{ background:"var(--gold)", color:"#000", border:"none", padding:"12px 20px", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:13, whiteSpace:"nowrap" }}>
                {saving ? "Saving..." : "Save payout details"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Event Reviews Preview (embedded in EventPage) ──────────────────────────
function EventReviewsPreview({ eventId, event, currentUser, tickets, submitReview }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Check if current user attended this event (has a used ticket)
  const attended = tickets.some(t => t.eventId === eventId && t.used);
  // Check if event date has passed
  const eventPassed = true; // allow any ticket holder to review for now
  const canReview = currentUser?.role === "customer" && tickets.some(t => t.eventId === eventId);
  const alreadyReviewed = reviews.some(r => r.userId === currentUser?.uid);

  useEffect(() => {
    const load = async () => {
      try {
        const q = query(collection(db, "reviews"), where("eventId", "==", eventId));
        const snap = await getDocs(q);
        setReviews(snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)));
      } catch {}
      setLoading(false);
    };
    load();
  }, [eventId]);

  const avgRating = reviews.length ? (reviews.reduce((s,r) => s+r.rating, 0) / reviews.length).toFixed(1) : null;

  const handleSubmit = async () => {
    if (!rating || !comment.trim()) return;
    setSubmitting(true);
    const res = await submitReview(eventId, { rating, comment });
    if (res.ok) {
      const newReview = { id:res.id, userId:currentUser.uid, userName:currentUser.name, rating, comment, createdAt:new Date().toISOString() };
      setReviews(prev => [newReview, ...prev]);
      setShowForm(false); setRating(0); setComment("");
    }
    setSubmitting(false);
  };

  if (loading) return null;

  return (
    <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:20, marginTop:16 }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <h3 style={{ fontSize:18 }}>REVIEWS</h3>
          {avgRating && (
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ color:"var(--gold)", fontSize:16 }}>{"★".repeat(Math.round(Number(avgRating)))}</span>
              <span style={{ fontFamily:"Oswald", fontSize:20, color:"var(--gold)" }}>{avgRating}</span>
              <span style={{ color:"var(--muted)", fontSize:12 }}>({reviews.length})</span>
            </div>
          )}
        </div>
        {canReview && !alreadyReviewed && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ background:"var(--gold)", color:"#000", border:"none", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:13 }}>
            <i className="fa-solid fa-pen-to-square" style={{marginRight:8}} />Write a Review
          </button>
        )}
      </div>

      {/* Review form */}
      {showForm && (
        <div style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:12, padding:20, marginBottom:20, animation:"fadeUp 0.3s ease" }}>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, marginBottom:8 }}>YOUR RATING</div>
            <div style={{ display:"flex", gap:6 }}>
              {[1,2,3,4,5].map(s => (
                <span key={s} onMouseEnter={() => setHovered(s)} onMouseLeave={() => setHovered(0)} onClick={() => setRating(s)}
                  style={{ fontSize:32, cursor:"pointer", color:(hovered||rating)>=s?"var(--gold)":"var(--border)", transition:"color 0.15s" }}>★</span>
              ))}
            </div>
          </div>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="Share your experience..." maxLength={400}
            style={{ width:"100%", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:14, resize:"vertical", fontFamily:"Manrope", outline:"none", marginBottom:12 }} />
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={() => { setShowForm(false); setRating(0); setComment(""); }} style={{ flex:1, background:"none", border:"1px solid var(--border)", color:"var(--muted)", padding:10, borderRadius:8, cursor:"pointer", fontSize:13 }}>Cancel</button>
            <button onClick={handleSubmit} disabled={!rating||!comment.trim()||submitting}
              style={{ flex:2, background:rating&&comment.trim()?"var(--gold)":"var(--bg3)", color:rating&&comment.trim()?"#000":"var(--muted)", border:"none", padding:10, borderRadius:8, cursor:rating&&comment.trim()?"pointer":"not-allowed", fontWeight:700, fontSize:13 }}>
              {submitting ? "Submitting..." : "Submit Review"}
            </button>
          </div>
        </div>
      )}

      {/* Review list */}
      {reviews.length === 0 ? (
        <div style={{ textAlign:"center", padding:"24px 0", color:"var(--muted)", fontSize:13 }}>No reviews yet. Be the first!</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {reviews.slice(0,5).map(r => (
            <div key={r.id} style={{ borderTop:"1px solid var(--border)", paddingTop:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, flexWrap:"wrap", gap:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:28, height:28, borderRadius:"50%", background:"var(--gold)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#000", flexShrink:0 }}>{r.userName?.[0]}</div>
                  <span style={{ fontWeight:600, fontSize:13 }}>{r.userName}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ color:"var(--gold)", fontSize:13 }}>{"★".repeat(r.rating)}{"☆".repeat(5-r.rating)}</span>
                  <span style={{ color:"var(--muted)", fontSize:11 }}>{new Date(r.createdAt).toLocaleDateString("en-NG",{month:"short",day:"numeric",year:"numeric"})}</span>
                </div>
              </div>
              <p style={{ color:"var(--muted)", fontSize:13, lineHeight:1.7 }}>{r.comment}</p>
            </div>
          ))}
          {reviews.length > 5 && (
            <Link to={`${eventPath(event || eventId)}/reviews`} style={{ color:"var(--gold)", fontSize:13, textAlign:"center", display:"block", paddingTop:8 }}>See all {reviews.length} reviews →</Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Full Reviews Page (/event/:eventId/reviews) ───────────────────────────
function ReviewsPage({ ctx }) {
  const { eventId: eventRouteParam } = useParams();
  const eventId = resolveEventIdFromParam(eventRouteParam);
  const { events, currentUser, tickets, submitReview } = ctx;
  const navigate = useNavigate();
  const event = events.find(e => e.id === eventId);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(0); // 0 = all

  useEffect(() => {
    const load = async () => {
      try {
        const q = query(collection(db, "reviews"), where("eventId","==", eventId));
        const snap = await getDocs(q);
        setReviews(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
      } catch {}
      setLoading(false);
    };
    load();
  }, [eventId]);

  if (!event) return <Navigate to="/" />;

  const avgRating = reviews.length ? (reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1) : null;
  const filtered = filter ? reviews.filter(r=>r.rating===filter) : reviews;
  const dist = [5,4,3,2,1].map(s => ({ stars:s, count:reviews.filter(r=>r.rating===s).length }));

  return (
    <div style={{ maxWidth:800, margin:"0 auto", padding:"40px 24px", animation:"fadeUp 0.4s ease" }}>
      <button onClick={() => navigate(eventPath(event || eventId))} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:14, marginBottom:24 }}>← Back to Event</button>

      <h1 style={{ fontSize:48, marginBottom:4 }}>REVIEWS</h1>
      <div style={{ color:"var(--muted)", fontSize:14, marginBottom:32 }}>{event.title}</div>

      {/* Rating summary */}
      {reviews.length > 0 && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:24, marginBottom:28, display:"grid", gridTemplateColumns:"auto 1fr", gap:32, alignItems:"center" }}>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"Oswald", fontSize:72, color:"var(--gold)", lineHeight:1 }}>{avgRating}</div>
            <div style={{ color:"var(--gold)", fontSize:20, marginBottom:4 }}>{"★".repeat(Math.round(Number(avgRating)))}</div>
            <div style={{ color:"var(--muted)", fontSize:12 }}>{reviews.length} review{reviews.length!==1?"s":""}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {dist.map(d => (
              <div key={d.stars} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }} onClick={() => setFilter(filter===d.stars?0:d.stars)}>
                <span style={{ fontSize:12, color: filter===d.stars?"var(--gold)":"var(--muted)", minWidth:12, fontWeight: filter===d.stars?700:400 }}>{d.stars}★</span>
                <div style={{ flex:1, height:8, background:"var(--border)", borderRadius:4 }}>
                  <div style={{ height:"100%", width:`${reviews.length?Math.round((d.count/reviews.length)*100):0}%`, background: filter===d.stars?"var(--gold)":"var(--gold-dim)", borderRadius:4, transition:"width 0.4s" }} />
                </div>
                <span style={{ fontSize:12, color:"var(--muted)", minWidth:20, textAlign:"right" }}>{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <div style={{ textAlign:"center", padding:"48px 0", color:"var(--muted)" }}>
          <div style={{ fontSize:48, marginBottom:12, color:"var(--gold)" }}><i className="fa-solid fa-star" /></div>
          <div style={{ fontFamily:"Oswald", fontSize:24, color:"var(--text)", marginBottom:8 }}>NO REVIEWS YET</div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {filtered.map(r => (
            <div key={r.id} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:20 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"var(--gold)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:700, color:"#000" }}>{r.userName?.[0]}</div>
                  <div>
                    <div style={{ fontWeight:600, fontSize:14 }}>{r.userName}</div>
                    <div style={{ color:"var(--muted)", fontSize:11 }}>{new Date(r.createdAt).toLocaleDateString("en-NG",{month:"long",day:"numeric",year:"numeric"})}</div>
                  </div>
                </div>
                <div style={{ color:"var(--gold)", fontSize:18 }}>{"★".repeat(r.rating)}{"☆".repeat(5-r.rating)}</div>
              </div>
              <p style={{ color:"var(--muted)", fontSize:14, lineHeight:1.8 }}>{r.comment}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Waitlist Panel (shown in AnalyticsPage) ───────────────────────────────
function WaitlistPanel({ eventId, event }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [notifying, setNotifying] = useState(null);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, "waitlist"), where("eventId","==",eventId));
        const snap = await getDocs(q);
        setEntries(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>new Date(a.joinedAt)-new Date(b.joinedAt)));
      } catch {}
      setLoading(false);
    };
    load();
  }, [open, eventId]);

  const notifyEntry = async (entry) => {
    setNotifying(entry.id);
    try {
      // Save a targeted notification for this user
      await addDoc(collection(db, "notifications"), {
        eventId, eventTitle: event.title,
        title: `A ${entry.tierName} ticket is available!`,
        body: `Good news — a ticket for ${event.title} (${entry.tierName}) has become available. Grab it before it's gone!`,
        targetUsers: [entry.userId],
        sentAt: new Date().toISOString(),
        readBy: [],
      });
      // Mark as notified
      await updateDoc(doc(db, "waitlist", entry.id), { notified: true });
      setEntries(prev => prev.map(e => e.id===entry.id ? {...e, notified:true} : e));
    } catch (err) { console.error(err); }
    setNotifying(null);
  };

  const byTier = entries.reduce((acc, e) => {
    if (!acc[e.tierName]) acc[e.tierName] = [];
    acc[e.tierName].push(e);
    return acc;
  }, {});

  return (
    <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden", marginTop:16 }}>
      <button onClick={() => setOpen(p=>!p)} style={{ width:"100%", padding:"20px 24px", background:"none", border:"none", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", color:"var(--text)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <i className="fa-solid fa-clipboard-list" style={{fontSize:22,color:"var(--gold)"}} />
          <div style={{ textAlign:"left" }}>
            <div style={{ fontFamily:"Oswald", fontSize:20, letterSpacing:1 }}>WAITLIST</div>
            <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>Attendees waiting for sold-out tiers</div>
          </div>
        </div>
        <span style={{ color:"var(--muted)", fontSize:20, transition:"transform 0.2s", transform: open?"rotate(180deg)":"rotate(0)" }}>▾</span>
      </button>

      {open && (
        <div style={{ borderTop:"1px solid var(--border)", padding:24 }}>
          {loading ? <Spinner /> : entries.length === 0 ? (
            <div style={{ textAlign:"center", padding:"24px 0", color:"var(--muted)", fontSize:13 }}>No one on the waitlist yet.</div>
          ) : Object.entries(byTier).map(([tierName, tierEntries]) => (
            <div key={tierName} style={{ marginBottom:24 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"var(--gold)", letterSpacing:1, marginBottom:12 }}>{tierName.toUpperCase()} — {tierEntries.length} waiting</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {tierEntries.map((e, i) => (
                  <div key={e.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"var(--bg3)", borderRadius:10, padding:"12px 16px", flexWrap:"wrap", gap:10 }}>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"IBM Plex Mono" }}>#{i+1}</span>
                        <span style={{ fontWeight:600, fontSize:13 }}>{e.userName}</span>
                        {e.notified && <span style={{ fontSize:10, background:"rgba(61,220,132,0.15)", color:"var(--green)", padding:"1px 8px", borderRadius:100, fontWeight:700 }}>NOTIFIED</span>}
                      </div>
                      <div style={{ fontSize:11, color:"var(--muted)", marginTop:2 }}>{e.userEmail} · Joined {new Date(e.joinedAt).toLocaleDateString("en-NG")}</div>
                    </div>
                    <button
                      onClick={() => notifyEntry(e)}
                      disabled={e.notified || notifying===e.id}
                      style={{ background: e.notified?"var(--bg2)":"var(--gold)", color: e.notified?"var(--muted)":"#000", border:`1px solid ${e.notified?"var(--border)":"var(--gold)"}`, padding:"7px 14px", borderRadius:8, cursor: e.notified?"default":"pointer", fontSize:12, fontWeight:700 }}
                    >
                      {notifying===e.id ? "..." : e.notified ? "✓ Notified" : <><i className="fa-solid fa-bell" style={{marginRight:4}} />Notify</>}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
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
      <h2 style={{ fontFamily:"Oswald", fontSize:22, letterSpacing:1, marginBottom:12, color:"var(--text)" }}>{title}</h2>
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
        <p>If you have questions about these Terms of Service, please contact us at <span style={{ color:"var(--gold)" }}>davidbibiresanmi@gmail.com</span> or write to us at StagePro HQ, Victoria Island, Lagos, Nigeria.</p>
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

// ── Cookies Policy Page (/cookies) ────────────────────────────────────────
function CookiesPage() {
  return (
    <LegalPage
      title="COOKIE POLICY"
      subtitle={"Last updated: " + new Date().toLocaleDateString("en-NG", { year:"numeric", month:"long", day:"numeric" })}
    >
      <LegalSection title="1. What Are Cookies?">
        <p>Cookies are small text files placed on your device when you visit a website. They are widely used to make websites work efficiently, remember your preferences, and provide information to site owners. StagePro uses browser storage technologies (including localStorage and sessionStorage) that function similarly to cookies to deliver a smooth experience on our platform.</p>
      </LegalSection>

      <LegalSection title="2. What We Use and Why">
        <p style={{ marginBottom:12 }}>StagePro uses the following types of browser storage:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:12 }}>
          <li>
            <strong style={{ color:"var(--text)" }}>Session Storage — Essential:</strong> We use sessionStorage to temporarily hold your ticket cart while you navigate from an event page to checkout. This data is automatically deleted when you close your browser tab and is never sent to our servers.
          </li>
          <li>
            <strong style={{ color:"var(--text)" }}>Firebase Authentication Tokens — Essential:</strong> When you sign in, Google Firebase stores a secure authentication token in your browser's localStorage. This keeps you signed in between visits without requiring you to re-enter your password each time. Without this, the platform cannot function for signed-in users.
          </li>
          <li>
            <strong style={{ color:"var(--text)" }}>Theme Preference — Functional:</strong> StagePro detects your operating system's light or dark mode preference automatically. No data about this preference is stored on our servers.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. What We Do NOT Use">
        <p style={{ marginBottom:12 }}>StagePro does not use:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:8 }}>
          <li>Third-party advertising or tracking cookies</li>
          <li>Analytics cookies from services such as Google Analytics</li>
          <li>Social media tracking pixels (e.g. Meta Pixel, Twitter Pixel)</li>
          <li>Any cookies designed to build profiles of your browsing behaviour across other websites</li>
        </ul>
        <p style={{ marginTop:12 }}>We are committed to using only the minimum storage necessary to operate the platform. We do not sell, share, or monetise any data derived from your browser storage.</p>
      </LegalSection>

      <LegalSection title="4. Third-Party Services">
        <p>StagePro is built on Google Firebase, which may set its own cookies or local storage entries as part of its authentication and database services. These are governed by Google's Privacy Policy, available at <span style={{ color:"var(--gold)" }}>policies.google.com/privacy</span>. We do not control these entries directly, but they are limited to what is necessary for authentication to function.</p>
      </LegalSection>

      <LegalSection title="5. Managing and Clearing Storage">
        <p style={{ marginBottom:12 }}>You can clear all browser storage set by StagePro at any time through your browser settings. The steps vary by browser:</p>
        <ul style={{ paddingLeft:20, display:"flex", flexDirection:"column", gap:8 }}>
          <li><strong style={{ color:"var(--text)" }}>Chrome:</strong> Settings → Privacy and Security → Clear Browsing Data → Cookies and other site data</li>
          <li><strong style={{ color:"var(--text)" }}>Safari:</strong> Settings → Safari → Advanced → Website Data → Remove All Website Data</li>
          <li><strong style={{ color:"var(--text)" }}>Firefox:</strong> Settings → Privacy & Security → Cookies and Site Data → Clear Data</li>
        </ul>
        <p style={{ marginTop:12 }}>Please note that clearing storage will sign you out of StagePro and delete any items currently in your ticket cart.</p>
      </LegalSection>

      <LegalSection title="6. Your Consent">
        <p>By using StagePro, you consent to our use of browser storage as described in this policy. Since we only use storage that is strictly necessary for the platform to function, we do not require a separate cookie consent banner. If we introduce any optional or non-essential storage in the future, we will update this policy and seek your explicit consent where required by Nigerian law or applicable international standards.</p>
      </LegalSection>

      <LegalSection title="7. Changes to This Policy">
        <p>We may update this Cookie Policy from time to time to reflect changes in our technology or legal requirements. Any changes will be posted on this page with an updated date. We encourage you to review this page periodically.</p>
      </LegalSection>

      <LegalSection title="8. Contact Us">
        <p>If you have any questions about our use of cookies or browser storage, please contact us at <span style={{ color:"var(--gold)" }}>privacy@stagepro.ng</span> or visit our <Link to="/contact" style={{ color:"var(--gold)" }}>Contact Us</Link> page.</p>
      </LegalSection>
    </LegalPage>
  );
}

// ── Help Centre Page (/help) ───────────────────────────────────────────────
function HelpPage() {
  const [openFaq, setOpenFaq] = useState(null);

  const faqs = [
    {
      category: "BUYING TICKETS",
      items: [
        {
          q: "How do I buy tickets on StagePro?",
          a: "Browse events on the homepage, select the event you want to attend, choose your ticket tier and quantity, then click 'Proceed to Checkout'. You'll need a StagePro account to complete your purchase. After confirming, your ticket will appear instantly under 'My Tickets'."
        },
        {
          q: "Do I need to print my ticket?",
          a: "No — StagePro tickets are 100% digital. Simply open the StagePro app or website on your phone, go to 'My Tickets', tap the ticket, and present the QR code at the event entrance for scanning."
        },
        {
          q: "Can I buy tickets for someone else?",
          a: "Yes. You can purchase tickets and then transfer them to another person's StagePro account. Go to 'My Tickets', tap the ticket you'd like to transfer, and use the 'Transfer' button to send it to their registered email address."
        },
        {
          q: "What payment methods are accepted?",
          a: "StagePro processes payments securely via Squad. You can pay with debit or credit cards and bank transfer. Free events require no payment at all."
        },
        {
          q: "Is it safe to buy tickets on StagePro?",
          a: "Yes. All transactions are secured using industry-standard encryption. Your account is protected by Google Firebase Authentication. We never store card details on our servers."
        },
      ]
    },
    {
      category: "MY TICKETS",
      items: [
        {
          q: "Where can I find my tickets?",
          a: "Sign in to your StagePro account and click 'My Tickets' in the navigation bar. All your purchased tickets will be listed there, including past and upcoming events."
        },
        {
          q: "My QR code isn't scanning at the venue — what do I do?",
          a: "Make sure your screen brightness is turned up fully and that there is no glare. If the QR code still won't scan, ask the organiser to look up your ticket by Ticket ID — you can find it displayed below the QR code on your ticket page. You can also show them the URL: stagepro-phi.vercel.app/ticket/[your-ticket-id]."
        },
        {
          q: "Can I get a refund?",
          a: "All ticket sales are final unless the event is cancelled or significantly changed by the organiser. If an event you have tickets for is cancelled, the organiser is required to issue a full refund within 14 days. Contact the event organiser directly or reach us at davidbibiresanmi@gmail.com if you need assistance."
        },
        {
          q: "How do I transfer a ticket to someone else?",
          a: "Go to 'My Tickets', tap the ticket you want to transfer, then tap the 'Transfer' button. Enter the recipient's email address — they must already have a StagePro account. The ticket will be moved to their account instantly."
        },
        {
          q: "What happens if I lose my phone before the event?",
          a: "Your tickets are stored securely in the cloud, not just on your device. Simply sign in to StagePro on any device using your email and password, and your tickets will be there."
        },
      ]
    },
    {
      category: "ACCOUNTS & SECURITY",
      items: [
        {
          q: "How do I create a StagePro account?",
          a: "Click 'Get Started' on the homepage, enter your full name, email address, and a password. Choose whether you're an Attendee (buying tickets) or an Organiser (creating events), then click 'Create Account'."
        },
        {
          q: "I forgot my password — how do I reset it?",
          a: "On the login page, click 'Forgot your password?' and enter your registered email address. We'll send you a password reset link. Check your spam folder if you don't see it within a few minutes."
        },
        {
          q: "Can I change my email address?",
          a: "Email addresses cannot be changed once registered as they are tied to your account identity. If you need to change your email, please contact us at davidbibiresanmi@gmail.com and we will assist you."
        },
        {
          q: "How do I update my display name?",
          a: "Click your profile avatar (the gold circle with your initial) in the top navigation bar to go to your Profile page. You can update your display name there and save the changes."
        },
      ]
    },
    {
      category: "FOR ORGANISERS",
      items: [
        {
          q: "How do I create an event on StagePro?",
          a: "Register for a StagePro account and choose 'Organiser' as your account type. Once signed in, go to your Dashboard and click '+ Create Event'. Fill in your event details, upload a flyer, set your ticket tiers and pricing, then click 'Publish Event'."
        },
        {
          q: "How do I scan tickets at my event?",
          a: "Go to the 'Scan' page from your navigation bar. Tap 'Snap QR Code' and point your camera at the attendee's QR code. StagePro will immediately tell you if the ticket is valid and allow you to mark it as used. You can also look up tickets manually by entering the Ticket ID."
        },
        {
          q: "How do I download my buyer list?",
          a: "On your Dashboard, find the event and click the gold download (⬇) button. A CSV file will be downloaded containing all ticket holders for that event, including names, email addresses, ticket tiers, and purchase dates."
        },
        {
          q: "Can I edit an event after publishing?",
          a: "Yes. From your Dashboard, click 'Edit' on any event to update its details. Changes go live immediately. Please note that changing ticket prices after tickets have been sold is not recommended and may cause disputes with existing ticket holders."
        },
        {
          q: "How do I notify attendees about my event?",
          a: "Go to your Dashboard → click '📊 Stats' on the event → scroll to the 'Send Notification' panel. You can write a custom message or use a quick template to notify all ticket holders instantly. They will see it in their notification bell on the StagePro platform."
        },
      ]
    },
  ];

  return (
    <div style={{ maxWidth:860, margin:"0 auto", padding:"48px 24px 80px", animation:"fadeUp 0.4s ease" }}>
      <Link to="/" style={{ color:"var(--muted)", fontSize:14, display:"inline-block", marginBottom:32 }}>← Back</Link>

      <div style={{ marginBottom:56 }}>
        <div style={{ fontSize:12, letterSpacing:4, color:"var(--gold)", textTransform:"uppercase", marginBottom:12, fontWeight:500 }}>Support</div>
        <h1 style={{ fontSize:"clamp(40px,8vw,72px)", lineHeight:0.95, marginBottom:16 }}>HELP CENTRE</h1>
        <p style={{ color:"var(--muted)", fontSize:15, maxWidth:560 }}>Find answers to the most common questions about buying tickets, managing your account, and running events on StagePro.</p>
      </div>

      {/* Quick links */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12, marginBottom:56 }}>
        {[
          { icon:<i className="fa-solid fa-ticket" />, label:"Buying Tickets", anchor:"buying-tickets" },
          { icon:<i className="fa-solid fa-mobile-screen-button" />, label:"My Tickets", anchor:"my-tickets" },
          { icon:<i className="fa-solid fa-lock" />, label:"Accounts", anchor:"accounts-security" },
          { icon:<i className="fa-solid fa-star" />, label:"For Organisers", anchor:"for-organisers" },
        ].map(c => (
          <a key={c.label} href={`#${c.anchor}`}
            style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 20px", textDecoration:"none", display:"flex", alignItems:"center", gap:12, transition:"border-color 0.2s, transform 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor="var(--gold)"; e.currentTarget.style.transform="translateY(-2px)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.transform=""; }}
          >
            <span style={{ fontSize:28 }}>{c.icon}</span>
            <span style={{ fontWeight:600, fontSize:14, color:"var(--text)" }}>{c.label}</span>
          </a>
        ))}
      </div>

      {/* FAQ sections */}
      {faqs.map(section => (
        <div key={section.category} id={section.category.toLowerCase().replace(/\s+/g,"-")} style={{ marginBottom:48 }}>
          <h2 style={{ fontFamily:"Oswald", fontSize:26, letterSpacing:2, color:"var(--gold)", marginBottom:20, paddingBottom:12, borderBottom:"1px solid var(--border)" }}>{section.category}</h2>
          <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
            {section.items.map((item, i) => {
              const key = `${section.category}-${i}`;
              const isOpen = openFaq === key;
              return (
                <div key={key} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, overflow:"hidden", transition:"border-color 0.2s" }}
                  onMouseEnter={e => { if (!isOpen) e.currentTarget.style.borderColor="var(--gold-dim)"; }}
                  onMouseLeave={e => { if (!isOpen) e.currentTarget.style.borderColor="var(--border)"; }}
                >
                  <button onClick={() => setOpenFaq(isOpen ? null : key)}
                    style={{ width:"100%", padding:"18px 24px", background:"none", border:"none", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", gap:16, textAlign:"left" }}
                  >
                    <span style={{ fontWeight:600, fontSize:15, color:"var(--text)", lineHeight:1.4 }}>{item.q}</span>
                    <span style={{ color:"var(--gold)", fontSize:22, flexShrink:0, transition:"transform 0.25s", transform: isOpen?"rotate(45deg)":"rotate(0)" }}>+</span>
                  </button>
                  {isOpen && (
                    <div style={{ padding:"0 24px 20px", color:"var(--muted)", fontSize:14, lineHeight:1.85, animation:"fadeUp 0.2s ease", borderTop:"1px solid var(--border)" }}>
                      <div style={{ paddingTop:16 }}>{item.a}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Still need help? */}
      <div style={{ background:"linear-gradient(135deg,rgba(245,166,35,0.12),rgba(245,166,35,0.04))", border:"1px solid var(--gold-dim)", borderRadius:16, padding:"32px 40px", textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12, color:"var(--gold)" }}><i className="fa-solid fa-headset" /></div>
        <h3 style={{ fontFamily:"Oswald", fontSize:28, marginBottom:8 }}>STILL NEED HELP?</h3>
        <p style={{ color:"var(--muted)", fontSize:14, marginBottom:20 }}>Can't find the answer you're looking for? Our support team is happy to help.</p>
        <Link to="/contact" style={{ background:"var(--gold)", color:"#000", padding:"12px 32px", borderRadius:10, fontWeight:700, fontSize:15, display:"inline-block" }}>Contact Support →</Link>
      </div>
    </div>
  );
}

// ── Contact Us Page (/contact) ─────────────────────────────────────────────
function ContactPage() {
  const [form, setForm] = useState({ name:"", email:"", subject:"", category:"general", message:"" });
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const F = k => e => setForm(p=>({...p,[k]:e.target.value}));

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.message) return;
    setStatus("sending");
    // Save to Firestore so organizers/admin can view enquiries
    try {
      await addDoc(collection(db, "enquiries"), {
        ...form,
        submittedAt: new Date().toISOString(),
        status: "open",
      });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  const iStyle = { width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", color:"var(--text)", fontSize:14, outline:"none", fontFamily:"Manrope" };

  return (
    <div style={{ maxWidth:860, margin:"0 auto", padding:"48px 24px 80px", animation:"fadeUp 0.4s ease" }}>
      <Link to="/" style={{ color:"var(--muted)", fontSize:14, display:"inline-block", marginBottom:32 }}>← Back</Link>

      <div style={{ marginBottom:48 }}>
        <div style={{ fontSize:12, letterSpacing:4, color:"var(--gold)", textTransform:"uppercase", marginBottom:12, fontWeight:500 }}>Support</div>
        <h1 style={{ fontSize:"clamp(40px,8vw,72px)", lineHeight:0.95, marginBottom:16 }}>CONTACT US</h1>
        <p style={{ color:"var(--muted)", fontSize:15 }}>We're here to help. Fill in the form below and we'll get back to you within 24 hours on business days.</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:40, alignItems:"start" }}>

        {/* Contact form */}
        <div style={{ gridColumn:"1 / -1" }}>
          {status === "sent" ? (
            <div style={{ background:"rgba(61,220,132,0.08)", border:"1px solid var(--green)", borderRadius:16, padding:"48px 32px", textAlign:"center", animation:"fadeUp 0.4s ease" }}>
              <div style={{ fontSize:56, marginBottom:16, color:"var(--green)" }}><i className="fa-solid fa-circle-check" /></div>
              <h2 style={{ fontFamily:"Oswald", fontSize:36, color:"var(--green)", marginBottom:8 }}>MESSAGE SENT!</h2>
              <p style={{ color:"var(--muted)", fontSize:14, marginBottom:24 }}>Thanks for reaching out. We'll get back to you at <strong style={{ color:"var(--text)" }}>{form.email}</strong> within 24 hours.</p>
              <button onClick={() => { setForm({ name:"", email:"", subject:"", category:"general", message:"" }); setStatus("idle"); }}
                style={{ background:"var(--gold)", color:"#000", border:"none", padding:"12px 28px", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:14 }}>Send Another Message</button>
            </div>
          ) : (
            <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:32 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
                <div>
                  <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>FULL NAME *</label>
                  <input value={form.name} onChange={F("name")} placeholder="Amara Okafor" style={iStyle} />
                </div>
                <div>
                  <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>EMAIL ADDRESS *</label>
                  <input type="email" value={form.email} onChange={F("email")} placeholder="you@email.com" style={iStyle} />
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
                <div>
                  <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>CATEGORY</label>
                  <select value={form.category} onChange={F("category")} style={{...iStyle, background:"var(--bg3)"}}>
                    <option value="general">General Enquiry</option>
                    <option value="tickets">Ticket Issue</option>
                    <option value="refund">Refund Request</option>
                    <option value="organiser">Organiser Support</option>
                    <option value="technical">Technical Problem</option>
                    <option value="account">Account Help</option>
                    <option value="partnership">Partnership / Business</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>SUBJECT</label>
                  <input value={form.subject} onChange={F("subject")} placeholder="Brief summary of your issue" style={iStyle} />
                </div>
              </div>

              <div style={{ marginBottom:24 }}>
                <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:6, display:"block" }}>YOUR MESSAGE *</label>
                <textarea value={form.message} onChange={F("message")} rows={6}
                  placeholder="Please describe your issue or question in as much detail as possible. Include any relevant ticket IDs, event names, or error messages."
                  style={{...iStyle, resize:"vertical"}} />
              </div>

              {status === "error" && (
                <div style={{ background:"rgba(232,64,64,0.08)", border:"1px solid var(--red)", borderRadius:8, padding:"10px 16px", marginBottom:16, fontSize:13, color:"var(--red)" }}>
                  Something went wrong. Please try again or email us directly at <strong>davidbibiresanmi@gmail.com</strong>
                </div>
              )}

              <button onClick={handleSubmit} disabled={!form.name||!form.email||!form.message||status==="sending"}
                style={{ width:"100%", background: form.name&&form.email&&form.message?"var(--gold)":"var(--bg3)", color: form.name&&form.email&&form.message?"#000":"var(--muted)", border:"none", padding:"15px 24px", borderRadius:10, cursor: form.name&&form.email&&form.message?"pointer":"not-allowed", fontFamily:"Oswald", fontSize:20, letterSpacing:1 }}>
                {status==="sending" ? "SENDING..." : "SEND MESSAGE →"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Contact info cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:16, marginTop:48 }}>
        {[
          { icon:<i className="fa-solid fa-envelope" />, title:"Email Support", detail:"stageproticketingco@gmail.com", sub:"Response within 24 hours" },
          { icon:<i className="fa-solid fa-building" />, title:"Office", detail:"Victoria Island, Lagos", sub:"Nigeria" },
          { icon:<i className="fa-solid fa-clock" />, title:"Support Hours", detail:"Mon – Fri, 9am – 6pm", sub:"West Africa Time (WAT)" },
          { icon:<i className="fa-solid fa-bolt" />, title:"Urgent Issues", detail:"stageproticketingco@gmail.com", sub:"For time-sensitive event matters" },
        ].map(c => (
          <div key={c.title} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"20px 24px" }}>
            <div style={{ fontSize:28, marginBottom:10 }}>{c.icon}</div>
            <div style={{ fontFamily:"Oswald", fontSize:17, letterSpacing:1, marginBottom:4 }}>{c.title}</div>
            <div style={{ fontSize:14, color:"var(--text)", fontWeight:600, marginBottom:2 }}>{c.detail}</div>
            <div style={{ fontSize:12, color:"var(--muted)" }}>{c.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Guest Ticket Lookup Page (/find-tickets) ───────────────────────────────
function GuestTicketLookupPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | found | empty | error
  const [tickets, setTickets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");

  const handleSearch = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return;
    setStatus("loading");
    setTickets([]);
    setMessage("");
    try {
      // Query Firestore directly from the client — no Admin SDK, no quota issues
      const q = query(collection(db, "tickets"), where("userEmail", "==", trimmed));
      const snap = await getDocs(q);
      const found = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));
      setTickets(found);
      setStatus(found.length ? "found" : "empty");
    } catch (err) {
      console.error(err);
      setMessage("Could not look up tickets. Please try again.");
      setStatus("error");
    }
  };

  const iStyle = { width:"100%", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, padding:"14px 16px", color:"var(--text)", fontSize:15, outline:"none", fontFamily:"Manrope" };

  return (
    <div style={{ maxWidth:680, margin:"0 auto", padding:"48px 24px 80px", animation:"fadeUp 0.4s ease" }}>
      <Link to="/" style={{ color:"var(--muted)", fontSize:14, display:"inline-block", marginBottom:32 }}>← Back</Link>

      {/* Header */}
      <div style={{ marginBottom:40 }}>
        <div style={{ fontSize:12, letterSpacing:4, color:"var(--gold)", textTransform:"uppercase", marginBottom:12, fontWeight:500 }}>Guest Tickets</div>
        <h1 style={{ fontSize:"clamp(36px,7vw,64px)", lineHeight:0.95, marginBottom:16 }}>FIND MY TICKETS</h1>
        <p style={{ color:"var(--muted)", fontSize:15, lineHeight:1.7 }}>
          Bought tickets without creating an account? Enter the email address you used at checkout to view your tickets instantly.
        </p>
      </div>

      {/* Search box */}
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, marginBottom:24 }}>
        <label style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, marginBottom:8, display:"block" }}>EMAIL ADDRESS USED AT CHECKOUT</label>
        <div style={{ display:"flex", gap:10 }}>
          <div style={{ position:"relative", flex:1 }}>
            <i className="fa-solid fa-envelope" style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", fontSize:14, pointerEvents:"none" }} />
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setStatus("idle"); }}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="your@email.com"
              style={{ ...iStyle, paddingLeft:42 }}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={!email.includes("@") || status === "loading"}
            style={{ background: email.includes("@") ? "var(--gold)" : "var(--bg3)", color: email.includes("@") ? "#000" : "var(--muted)", border:"none", padding:"0 24px", borderRadius:10, cursor: email.includes("@") ? "pointer" : "not-allowed", fontFamily:"Oswald", fontSize:18, letterSpacing:1, flexShrink:0, transition:"background 0.2s" }}
          >
            {status === "loading" ? <i className="fa-solid fa-circle-notch fa-spin" /> : "FIND TICKETS"}
          </button>
        </div>
      </div>

      {/* Empty state */}
      {status === "empty" && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:"40px 28px", textAlign:"center", animation:"fadeUp 0.3s ease" }}>
          <div style={{ fontSize:48, marginBottom:16, color:"var(--muted)" }}><i className="fa-solid fa-ticket-slash" /></div>
          <h3 style={{ fontFamily:"Oswald", fontSize:28, marginBottom:8 }}>NO TICKETS FOUND</h3>
          <p style={{ color:"var(--muted)", fontSize:14, marginBottom:20, lineHeight:1.7 }}>
            {message || <>We couldn't find any tickets for <strong style={{ color:"var(--text)" }}>{email}</strong>.<br />Make sure you're using the exact email you entered at checkout.</>}
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:320, margin:"0 auto" }}>
            <Link to="/register" style={{ background:"var(--gold)", color:"#000", padding:"12px 24px", borderRadius:10, fontFamily:"Oswald", fontSize:18, letterSpacing:1, textAlign:"center" }}>CREATE AN ACCOUNT</Link>
            <Link to="/contact" style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--muted)", padding:"12px 24px", borderRadius:10, fontSize:13, textAlign:"center" }}>Contact Support</Link>
          </div>
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div style={{ background:"rgba(232,64,64,0.08)", border:"1px solid var(--red)", borderRadius:12, padding:"16px 20px", fontSize:13, color:"var(--red)" }}>
          <i className="fa-solid fa-triangle-exclamation" style={{ marginRight:8 }} />
          {message || <>Something went wrong. Please try again or contact <a href="mailto:davidbibiresanmi@gmail.com" style={{ color:"var(--red)" }}>davidbibiresanmi@gmail.com</a>.</>}
        </div>
      )}

      {/* Results */}
      {status === "found" && (
        <div style={{ animation:"fadeUp 0.3s ease" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <h2 style={{ fontFamily:"Oswald", fontSize:26, letterSpacing:1 }}>
              {tickets.length} TICKET{tickets.length !== 1 ? "S" : ""} FOUND
            </h2>
            <span style={{ fontSize:13, color:"var(--muted)" }}>{email}</span>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {tickets.map(ticket => {
              const isOpen = selected === ticket.id;
              const isUsed = ticket.used;
              return (
                <div key={ticket.id}
                  style={{ background:"var(--bg2)", border:`1px solid ${isOpen ? "var(--gold)" : "var(--border)"}`, borderRadius:14, overflow:"hidden", transition:"border-color 0.2s", cursor:"pointer" }}
                  onClick={() => setSelected(isOpen ? null : ticket.id)}
                >
                  {/* Ticket row */}
                  <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:16 }}>
                    <div style={{ width:44, height:44, borderRadius:10, background: isUsed ? "var(--bg3)" : "rgba(245,166,35,0.12)", border:`1px solid ${isUsed ? "var(--border)" : "var(--gold-dim)"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <i className={`fa-solid fa-ticket`} style={{ color: isUsed ? "var(--muted)" : "var(--gold)", fontSize:18 }} />
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:15, color:"var(--text)", marginBottom:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{ticket.eventTitle}</div>
                      <div style={{ fontSize:12, color:"var(--muted)" }}>
                        {ticket.tierName} · {new Date(ticket.eventDate).toLocaleDateString("en-NG", { day:"numeric", month:"short", year:"numeric" })}
                        {ticket.venue && ` · ${ticket.venue}`}
                      </div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                      <span style={{ background: isUsed ? "var(--bg3)" : "rgba(61,220,132,0.1)", color: isUsed ? "var(--muted)" : "var(--green)", border:`1px solid ${isUsed ? "var(--border)" : "rgba(61,220,132,0.3)"}`, borderRadius:100, padding:"2px 10px", fontSize:11, fontWeight:600, letterSpacing:1 }}>
                        {isUsed ? "USED" : "VALID"}
                      </span>
                      <i className={`fa-solid fa-chevron-${isOpen ? "up" : "down"}`} style={{ color:"var(--muted)", fontSize:11 }} />
                    </div>
                  </div>

                  {/* Expanded QR */}
                  {isOpen && (
                    <div style={{ borderTop:"1px solid var(--border)", padding:24, display:"flex", flexDirection:"column", alignItems:"center", gap:16, background:"var(--bg3)", animation:"fadeUp 0.2s ease" }}>
                      <QRCode ticketId={ticket.id} size={200} />
                      <p style={{ fontSize:12, color:"var(--muted)", textAlign:"center" }}>
                        {isUsed
                          ? "This ticket has already been scanned and used for entry."
                          : "Present this QR code at the entrance for entry."}
                      </p>
                      <Link
                        to={`/ticket/${ticket.id}`}
                        onClick={e => e.stopPropagation()}
                        style={{ background:"var(--gold)", color:"#000", padding:"10px 28px", borderRadius:8, fontFamily:"Oswald", fontSize:16, letterSpacing:1 }}
                      >
                        VIEW FULL TICKET
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Create account nudge */}
          <div style={{ marginTop:32, background:"linear-gradient(135deg,rgba(245,166,35,0.08),rgba(245,166,35,0.03))", border:"1px solid var(--gold-dim)", borderRadius:14, padding:"20px 24px", display:"flex", alignItems:"center", gap:16 }}>
            <i className="fa-solid fa-star" style={{ color:"var(--gold)", fontSize:24, flexShrink:0 }} />
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Create a free account</div>
              <div style={{ color:"var(--muted)", fontSize:13 }}>Save your tickets in one place, transfer tickets, and get notified about your upcoming events.</div>
            </div>
            <Link to="/register" style={{ background:"var(--gold)", color:"#000", padding:"10px 20px", borderRadius:8, fontFamily:"Oswald", fontSize:16, letterSpacing:1, flexShrink:0 }}>JOIN FREE</Link>
          </div>
        </div>
      )}
    </div>
  );
}