import React, { useState, useEffect, useRef } from 'react';
import { Send, Play, Pause, RotateCcw, Volume2, AlertCircle } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- CONFIGURATION ---
const apiKey = process.env.REACT_APP_GEMINI_API_KEY; 
const INWORLD_API_KEY = process.env.REACT_APP_INWORLD_KEY; 
const VOICE_ID = process.env.REACT_APP_VOICE_ID; 

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const App = () => {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([{ role: 'assistant', content: "I'm Frank. Darling, the velvet is on. Let’s see if these pages have soul. Send me the pilot." }]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);

  useEffect(() => {
    signInAnonymously(auth);
    return auth.onAuthStateChanged(setUser);
  }, []);

  // --- AUDIO ENGINE ---
  const speak = async (text) => {
    if (!INWORLD_API_KEY) return;
    try {
      const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Basic ${INWORLD_API_KEY.trim()}` 
        },
        body: JSON.stringify({ text, voiceId: VOICE_ID, modelId: "inworld-tts-1.5-max" })
      });
      const json = await response.json();
      if (!json.audioContent) return;

      const buffer = Uint8Array.from(atob(json.audioContent), c => c.charCodeAt(0)).buffer;
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioContextRef.current;
      
      const audioBuffer = await ctx.decodeAudioData(buffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      sourceNodeRef.current = source;
      setIsSpeaking(true);
      source.onended = () => setIsSpeaking(false);
      source.start(0);
    } catch (e) { console.error("Audio failed", e); }
  };

  const handleSend = async () => {
    if (!inputText || isProcessing) return;
    const prompt = inputText;
    setInputText('');
    setIsProcessing(true);

    try {
      // Using the 2026 Stable Workhorse Model
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `You are Frank, a theatrical movie executive. Respond sharply to: ${prompt}` }] }]
        })
      });
      const data = await res.json();
      const reply = data.candidates[0].content.parts[0].text;

      const newMsgs = [...messages, { role: 'user', content: prompt }, { role: 'assistant', content: reply }];
      setMessages(newMsgs);
      speak(reply);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Brain freeze, darling. Try again." }]);
    } finally { setIsProcessing(true); setIsProcessing(false); }
  };

  return (
    <div className="flex flex-col h-screen bg-[#faf9f6] text-stone-800 font-sans overflow-hidden">
      <header className="p-6 bg-white border-b flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-black text-white flex items-center justify-center font-bold italic rounded">F</div>
          <h1 className="font-black uppercase tracking-tighter text-xl text-stone-900">Frank AI</h1>
        </div>
        {isSpeaking && <div className="flex gap-1 items-end h-4"><div className="w-1 bg-stone-300 animate-pulse h-full"/><div className="w-1 bg-stone-300 animate-pulse h-2/3"/><div className="w-1 bg-stone-300 animate-pulse h-1/2"/></div>}
      </header>

      <main className="flex-1 overflow-y-auto p-10 space-y-6 bg-[#fdfcfb]">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-6 rounded-2xl ${m.role === 'user' ? 'bg-stone-900 text-white shadow-lg' : 'bg-white border border-stone-100 shadow-sm font-serif'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {isProcessing && <div className="flex items-center gap-2 text-stone-400 italic text-sm"><Volume2 size={14} className="animate-bounce"/> Frank is considering...</div>}
      </main>

      <footer className="p-8 bg-white border-t space-y-4">
        <div className="flex justify-center gap-6">
           <button className="w-12 h-12 rounded-full border border-stone-200 flex items-center justify-center text-stone-400 hover:text-black transition-colors"><RotateCcw size={20}/></button>
           <button onClick={() => { if(sourceNodeRef.current) sourceNodeRef.current.stop(); setIsSpeaking(false); }} className="w-14 h-14 bg-black text-white rounded-full flex items-center justify-center shadow-xl active:scale-95 transition-all">
             {isSpeaking ? <Pause size={24} fill="currentColor"/> : <Play size={24} fill="currentColor" className="ml-1"/>}
           </button>
        </div>
        <div className="max-w-4xl mx-auto flex gap-4">
          <input 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Defend your arc, darling..." 
            className="flex-1 bg-stone-50 border border-stone-100 p-4 rounded-2xl outline-none focus:ring-2 focus:ring-stone-200 transition-all"
          />
          <button onClick={handleSend} className="bg-black text-white px-8 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-stone-800 transition-all">Send</button>
        </div>
      </footer>
    </div>
  );
};

export default App;
