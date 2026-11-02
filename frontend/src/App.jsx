import React from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';
import { enablePush, useAuth, useFetch, useToast } from './lib.jsx';
import Login from './pages/Login.jsx';
import GuardianLink from './pages/GuardianLink.jsx';
import { StudentHome, NewRequest, MyGuardians } from './pages/Student.jsx';
import Mentor from './pages/Mentor.jsx';
import Guard from './pages/Guard.jsx';
import Admin from './pages/Admin.jsx';

const NAV = {
  STUDENT: [['/student', 'My Outpasses'], ['/student/new', 'New Request'], ['/student/guardians', 'My Guardians']],
  MENTOR: [['/mentor', 'Requests']],
  GUARD: [['/guard', 'Gate Scanner']],
  ADMIN: [['/admin', 'Admin Dashboard']],
};
const HOME = { STUDENT: '/student', MENTOR: '/mentor', GUARD: '/guard', ADMIN: '/admin' };

function Shell({ role, children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data: college } = useFetch('/public/college');
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={HOME[user.role]} replace />;
  return (
    <div className="min-h-screen md:flex">
      <aside className="md:w-60 bg-slate-900 text-slate-100 md:min-h-screen">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-700">
          <ShieldCheck className="text-blue-400" />
          <div><div className="font-bold leading-tight">SDOMS</div><div className="text-xs text-slate-400">{college?.name}</div></div>
        </div>
        <nav className="flex md:block overflow-x-auto p-2 gap-1">
          {NAV[role].map(([to, label]) => (
            <NavLink key={to} to={to} end className={({ isActive }) => `block whitespace-nowrap rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-blue-600' : 'hover:bg-slate-800'}`}>{label}</NavLink>
          ))}
        </nav>
        <div className="hidden md:block p-4 mt-auto text-sm text-slate-400">
          <div className="text-slate-200">{user.name}</div><div className="text-xs mb-3">{user.role}</div>
        <button onClick={() => enablePush().then(() => toast('Phone notifications enabled')).catch((e) => toast(e.message, 'err'))} className="mb-3 text-left hover:text-white">Enable notifications</button>
        <button onClick={() => { logout(); nav('/login'); }} className="flex items-center gap-2 hover:text-white"><LogOut size={16} /> Logout</button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8 max-w-6xl">
        <div className="md:hidden flex justify-between text-sm mb-3"><span>{user.name}</span><span className="flex gap-3"><button onClick={() => enablePush().then(() => toast('Phone notifications enabled')).catch((e) => toast(e.message, 'err'))} className="text-blue-600">Notifications</button><button onClick={() => { logout(); nav('/login'); }} className="text-blue-600">Logout</button></span></div>
        {children}
      </main>
    </div>
  );
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={HOME[user.role]} replace /> : <Login />} />
      <Route path="/g/:token" element={<GuardianLink />} />
      <Route path="/student" element={<Shell role="STUDENT"><StudentHome /></Shell>} />
      <Route path="/student/new" element={<Shell role="STUDENT"><NewRequest /></Shell>} />
      <Route path="/student/guardians" element={<Shell role="STUDENT"><MyGuardians /></Shell>} />
      <Route path="/mentor" element={<Shell role="MENTOR"><Mentor /></Shell>} />
      <Route path="/guard" element={<Shell role="GUARD"><Guard /></Shell>} />
      <Route path="/admin" element={<Shell role="ADMIN"><Admin /></Shell>} />
      <Route path="*" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />
    </Routes>
  );
}
