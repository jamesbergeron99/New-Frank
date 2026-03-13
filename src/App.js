import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Mic, MicOff, Pause, Play, RotateCcw, Loader2, AlertCircle, 
  FileUp, Trash2, CheckCircle2, Stethoscope, Scissors, Zap as ZapIcon, ZapOff 
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
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
  const [messages, setMessages] = useState([{ role: 'assistant', content: "I'm Frank. Darling, let’s see if these pages have enough soul to survive the weekend. Send me the pilot." }]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [scriptData, setScriptData] = useState(null);
  const [deepDiveData, setDeepDiveData] = useState(null);

  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const speechQueue = useRef([]);
  const isCurrentlyPlaying = useRef(false);

  // --- AUTH & DATA ---
  useEffect(() => {
    signInAnonymously(auth);
    onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const chatDoc = doc(db, 'artifacts', 'frank-v1', 'users', user.uid, 'bible', 'main');
    return onSnapshot(chatDoc, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.messages) setMessages(d.messages);
        if (d.scriptData) setScriptData(d.scriptData);
        if (d.deepDiveData) setDeepDiveData(d.deepDiveData);
      }
    });
  }, [user]);

  // --- AUDIO (INWORLD) ---
  const speak = async (text) => {
    try {
      const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${INWORLD_API_KEY}` },
        body: JSON.stringify({ text, voiceId: VOICE_ID, modelId: "inworld-tts-1.5-max" })
      });
      const json = await response.json();
      const buffer = Uint8Array.from(atob(json.audioContent), c => c.charCodeAt(0)).buffer;
      
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      const audioBuffer = await ctx.decodeAudioData(buffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsSpeaking(false);
      sourceNodeRef.current = source;
      setIsSpeaking(true);
      source.start(0);
    } catch (e) { console.error("Audio Error", e); }
  };

  // --- BRAIN (GEMINI 2.5 FLASH) ---
  const callFrank = async (prompt) => {
    // This URL is the most stable "workhorse" endpoint in 2026
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `You are Frank, a flamboyant movie executive. Respond to this: ${prompt}` }] }]
      })
    });
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  };

  const handleSend = async () => {
    if (!inputText) return;
    const text = inputText;
    setInputText('');
    setIsProcessing(true);

    try {
      const reply = await callFrank(text);
      const newMsgs = [...messages, { role: 'user', content: text }, { role: 'assistant', content: reply }];
      setMessages(newMsgs);
      
      // Save to Firebase
      if (user) {
        await setDoc(doc(db, 'artifacts', 'frank-v1', 'users', user.uid, 'bible', 'main'), { messages: newMsgs }, { merge: true });
      }

      speak(reply);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Studio's offline, darling. Try again." }]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#faf9f6] text-stone-800 font-sans">
      <header className="p-6 bg-white border-b flex justify-between shadow-sm">
        <h1 className="font-black italic text-2xl">FRANK</h1>
        <div className="flex gap-4 text-[10px] uppercase font-bold text-stone-400">
          <button onClick={() => setActiveTab('chat')}>Lounge</button>
          <button onClick={() => setActiveTab('report')}>Report</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-10 space-y-6">
        {activeTab === 'chat' ? (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-6 rounded-2xl ${m.role === 'user' ? 'bg-stone-800 text-white' : 'bg-white border shadow-sm'}`}>
                {m.content}
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white p-10 rounded-xl shadow-sm">{scriptData?.content || "No analysis yet."}</div>
        )}
        {isProcessing && <div className="italic text-stone-400">Frank is thinking...</div>}
      </main>

      <footer className="p-6 bg-white border-t flex gap-4">
        <input 
          value={inputText} 
          onChange={(e) => setInputText(e.target.value)} 
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="flex-1 bg-stone-50 p-4 rounded-xl outline-none" 
          placeholder="Convince me, darling..." 
        />
        <button onClick={handleSend} className="bg-black text-white px-8 rounded-xl font-bold">SEND</button>
      </footer>
    </div>
  );
};

export default App;
