import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem('token');
  if (t) c.headers.Authorization = 'Bearer ' + t;
  return c;
});
api.interceptors.response.use((r) => r, (e) => {
  const p = location.pathname;
  if (e.response?.status === 401 && !p.startsWith('/login') && !p.startsWith('/g/')) {
    localStorage.clear();
    location.href = '/login';
  }
  return Promise.reject(e);
});
export const errMsg = (e) => e.response?.data?.error || e.message;

function base64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) {
    throw new Error('Push notifications require HTTPS (localhost is supported for testing)');
  }
  const { data } = await api.get('/notifications/push-key');
  if (!data.publicKey) throw new Error('Push notifications are not configured yet');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');
  const registration = await navigator.serviceWorker.register('/sw.js');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64ToUint8Array(data.publicKey),
  });
  await api.post('/notifications/push-subscriptions', subscription.toJSON());
  return true;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------- auth ----------
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const login = async (loginId, password) => {
    const { data } = await api.post('/auth/login', { loginId, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };
  const logout = () => { localStorage.clear(); setUser(null); };
  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, type }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-2 w-72">
        {items.map((t) => (
          <div key={t.id} className={`flex gap-2 items-start rounded-lg p-3 text-sm shadow-lg text-white ${t.type === 'ok' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
            {t.type === 'ok' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}<span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- small UI parts ----------
export const STATUS = {
  PENDING_GUARDIAN: ['Pending Guardian Approval', 'amber'], GUARDIAN_REJECTED: ['Guardian Rejected', 'rose'],
  PENDING_MENTOR: ['Guardian Approved - Pending Mentor', 'sky'], MENTOR_REJECTED: ['Mentor Rejected', 'rose'],
  APPROVED: ['Approved - QR Generated', 'emerald'], EXITED: ['Student Exited', 'violet'], RETURNED: ['Student Returned', 'slate'],
  EXPIRED: ['Expired', 'slate'], CANCELLED: ['Cancelled', 'slate'],
};
const COLORS = {
  amber: 'bg-amber-100 text-amber-800', rose: 'bg-rose-100 text-rose-800', sky: 'bg-sky-100 text-sky-800',
  emerald: 'bg-emerald-100 text-emerald-800', violet: 'bg-violet-100 text-violet-800', slate: 'bg-slate-200 text-slate-700',
};
export const Badge = ({ status }) => {
  const [label, c] = STATUS[status] || [status, 'slate'];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${COLORS[c]}`}>{label}</span>;
};
export const Spinner = ({ text = 'Loading...' }) => <div className="flex items-center gap-2 p-6 text-slate-500"><Loader2 className="animate-spin" size={18} />{text}</div>;
export const Card = ({ title, children, className = '', right }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-slate-200 ${className}`}>
    {title && <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100"><h2 className="font-semibold">{title}</h2>{right}</div>}
    <div className="p-4">{children}</div>
  </div>
);
export const Btn = ({ color = 'blue', className = '', ...p }) => {
  const c = { blue: 'bg-blue-600 hover:bg-blue-700', green: 'bg-emerald-600 hover:bg-emerald-700', red: 'bg-rose-600 hover:bg-rose-700', gray: 'bg-slate-600 hover:bg-slate-700' }[color];
  return <button {...p} className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50 ${c} ${className}`} />;
};
export const Input = ({ label, ...p }) => (
  <label className="block text-sm"><span className="text-slate-600">{label}</span>
    <input {...p} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" /></label>
);
export const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

// tiny data hook
export function useFetch(path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true; setLoading(true);
    api.get(path).then((r) => live && setData(r.data)).catch(() => live && setData(null)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [path, tick, ...deps]);
  return { data, loading, reload: () => setTick((t) => t + 1) };
}
