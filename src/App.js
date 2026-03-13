import React, { useState, useEffect, useRef } from 'react';
import { Send, Play, Pause, RotateCcw, FileUp, Volume2 } from 'lucide-react';
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
  const [messages, setMessages] = useState([{ role: 'assistant', content: "I'm Frank. Darling, the velvet is on. Let’s see if these pages have enough soul to survive the weekend. Send me the pilot." }]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);

  useEffect(() => {
    signInAnonymously(auth);
    return auth.onAuthStateChanged(setUser);
  }, []);

  // --- THE PERFECT TTS (RESTORING ORIGINAL LOGIC) ---
  const speak = async (text) => {
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
      
      // The original binary conversion that worked
      const binary = window.atob(json.audioContent);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      sourceNodeRef.current = source;
      setIsSpeaking(true);
      source.onended = () => setIsSpeaking(false);
      source.start(0);
    } catch (e) { console.error("Jimmy's voice cut out!", e); }
  };

  // --- THE BRAIN (SIMPLE & DRAMATIC) ---
  const handleSend = async () => {
    if (!inputText || isProcessing) return;
    const prompt = inputText;
    setInputText('');
    setIsProcessing(true);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `You are Frank, a theatrical movie executive. Use drama and script quotes. Respond to: ${prompt}` }] }]
        })
      });
      const data = await res.json();
      const reply = data.candidates[0].content.parts[0].text;

      setMessages(prev => [...prev, { role: 'user', content: prompt }, { role: 'assistant', content: reply }]);
      speak(reply);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Brain freeze, darling. Try again." }]);
    } finally { setIsProcessing(false); }
  };

  return (
    <div className="flex flex-col h-screen bg-[#faf9f6] text-stone-800 font-sans">
      <header className="p-6 bg-white border-b flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-black text-white flex items-center justify-center font-bold italic rounded">F</div>
          <h1 className="font-black tracking-tighter text-xl">Frank AI</h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-10 space-y-6">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-6 rounded-2xl ${m.role === 'user' ? 'bg-stone-900 text-white shadow-lg' : 'bg-white border shadow-sm font-serif'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {isProcessing && <div className="italic text-stone-400">Frank is scribbling...</div>}
      </main>

      <footer className="p-8 bg-white border-t space-y-4 shadow-2xl">
        <div className="flex justify-center gap-6">
           <button onClick={() => { if(sourceNodeRef.current) sourceNodeRef.current.stop(); setIsSpeaking(false); }} className="w-14 h-14 bg-black text-white rounded-full flex items-center justify-center shadow-xl">
             {isSpeaking ? <Pause size={24} fill="currentColor"/> : <Play size={24} fill="currentColor" className="ml-1"/>}
           </button>
        </div>
        <div className="max-w-4xl mx-auto flex gap-4">
          <input 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Defend your arc, darling..." 
            className="flex-1 bg-stone-50 border p-4 rounded-2xl outline-none"
          />
          <button onClick={handleSend} className="bg-black text-white px-8 rounded-2xl font-bold uppercase tracking-widest text-[10px]">Send</button>
        </div>
      </footer>
    </div>
  );
};

export default App;
