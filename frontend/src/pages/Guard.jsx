import React, { useEffect, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, LogOut, LogIn } from 'lucide-react';
import { api, errMsg, fmt, Btn, Card, useFetch, useToast } from '../lib.jsx';

const LOOK = {
  VALID: ['VALID OUTPASS', 'bg-emerald-600'], INVALID: ['INVALID OUTPASS', 'bg-rose-600'], EXPIRED: ['EXPIRED OUTPASS', 'bg-amber-600'],
  ALREADY_USED: ['ALREADY USED OUTPASS', 'bg-slate-700'], CANCELLED: ['CANCELLED OUTPASS', 'bg-rose-800'],
};

export default function Guard() {
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState('');
  const [res, setRes] = useState(null);
  const [manual, setManual] = useState('');
  const [camErr, setCamErr] = useState('');
  const toast = useToast();
  const { data: recent, reload } = useFetch('/guard/recent');

  const check = async (text) => {
    setCode(text);
    try { setRes((await api.post('/guard/scan', { code: text })).data); } catch (e) { toast(errMsg(e), 'err'); }
  };
  useEffect(() => {
    if (!scanning) return;
    const sc = new Html5Qrcode('reader');
    sc.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 }, (t) => { sc.stop().catch(() => {}); setScanning(false); check(t); }, () => {})
      .catch(() => { setCamErr('Camera not available. Type the code below instead.'); setScanning(false); });
    return () => { try { sc.isScanning && sc.stop().catch(() => {}); } catch {} };
  }, [scanning]);

  const mark = async (type) => {
    try { await api.post(`/guard/${type}`, { code }); toast(type === 'exit' ? 'Student marked as EXITED' : 'Student marked as RETURNED'); setRes(null); setCode(''); reload(); }
    catch (e) { toast(errMsg(e), 'err'); check(code); }
  };
  const [label, color] = res ? LOOK[res.result] : [];
  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-xl font-bold">Gate Scanner</h1>
      <Card>
        {scanning ? <div id="reader" className="w-full" /> : <Btn onClick={() => { setRes(null); setCamErr(''); setScanning(true); }}><Camera size={14} className="inline mr-1" />Scan QR code</Btn>}
        {scanning && <Btn color="gray" className="mt-2" onClick={() => setScanning(false)}>Stop</Btn>}
        {camErr && <p className="text-amber-700 text-sm mt-2">{camErr}</p>}
        <div className="flex gap-2 mt-3"><input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or paste QR text" className="flex-1 rounded-lg border px-3 py-2 text-sm" /><Btn color="gray" onClick={() => manual && check(manual)}>Check</Btn></div>
      </Card>
      {res && (
        <div className="rounded-xl overflow-hidden shadow">
          <div className={`${color} text-white text-center py-3 text-lg font-bold`}>{label}</div>
          <div className="bg-white p-4 text-sm space-y-1">
            {res.reason && <p className="text-rose-600">{res.reason}</p>}
            {res.pass && (<>
              <div><b>{res.pass.student.name}</b> ({res.pass.student.enrollmentNo}) - {res.pass.student.course}</div>
              <div>Pass: {res.pass.passNumber} | To: {res.pass.destination}</div>
              <div>Leave {fmt(res.pass.leaveTime)} - Return {fmt(res.pass.returnTime)}</div>
              <div>Guardian: {res.pass.guardianApproved ? 'Approved' : 'No'} | Mentor: {res.pass.mentorApproved ? 'Approved' : 'No'}</div>
            </>)}
            {res.result === 'VALID' && res.next === 'EXIT' && <Btn color="green" className="w-full mt-2" onClick={() => mark('exit')}><LogOut size={14} className="inline mr-1" />MARK STUDENT AS EXITED</Btn>}
            {res.result === 'VALID' && res.next === 'RETURN' && <Btn className="w-full mt-2" onClick={() => mark('return')}><LogIn size={14} className="inline mr-1" />MARK STUDENT AS RETURNED</Btn>}
          </div>
        </div>
      )}
      <Card title="Recent gate activity">
        {!recent?.length ? 'No entries yet.' : recent.map((l) => <div key={l.id} className="text-sm py-1 border-b last:border-0">{l.type === 'EXIT' ? 'OUT' : 'IN'} - {l.name} - {l.passNumber} - {fmt(l.at)}</div>)}
      </Card>
    </div>
  );
}
