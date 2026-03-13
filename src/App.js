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
const MODEL_ID = "inworld-tts-1.5-max";

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
const instanceAppId = 'frank-exec-series-v14';

const App = () => {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "I'm Frank. Darling, the velvet is on and the pen is ink-black. Let’s see if these pages have enough soul to survive the weekend. Send me the pilot." }
  ]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isHandsFree, setIsHandsFree] = useState(false); 
  const [activeTab, setActiveTab] = useState('chat');
  const [errorMessage, setErrorMessage] = useState(null);
  const [scriptData, setScriptData] = useState(null);
  const [deepDiveData, setDeepDiveData] = useState(null);
  const [seriesBible, setSeriesBible] = useState(""); 
  const [isDeepDiving, setIsDeepDiving] = useState(false);
  const [lastScriptContent, setLastScriptContent] = useState("");

  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const scrollRef = useRef(null);
  const speechQueue = useRef([]);
  const audioBufferQueue = useRef([]); 
  const isCurrentlyPlaying = useRef(false);
  const isFetchingNext = useRef(false);
  const recognitionRef = useRef(null);
  const handsFreeActiveRef = useRef(false);
  const abortControllerRef = useRef(null);
  const scriptMemoryRef = useRef(""); 

  useEffect(() => { handsFreeActiveRef.current = isHandsFree; }, [isHandsFree]);

  useEffect(() => {
    signInAnonymously(auth).catch(() => setErrorMessage("Firebase Auth Failed. Check your settings."));
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const chatDoc = doc(db, 'artifacts', instanceAppId, 'users', user.uid, 'series_bible', 'main');
    return onSnapshot(chatDoc, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.messages) setMessages(data.messages);
        if (data.scriptData) setScriptData(data.scriptData);
        if (data.deepDiveData) setDeepDiveData(data.deepDiveData);
        if (data.seriesBible) setSeriesBible(data.seriesBible);
        if (data.lastScriptContent) scriptMemoryRef.current = data.lastScriptContent;
      }
    });
  }, [user]);

  const saveToCloud = async (newMessages, sData, dData, bible, fullScript) => {
    if (!user) return;
    const chatDoc = doc(db, 'artifacts', instanceAppId, 'users', user.uid, 'series_bible', 'main');
    const update = { messages: newMessages.slice(-20) }; // Keep history lean
    if (sData) update.scriptData = sData;
    if (dData) update.deepDiveData = dData;
    if (bible) update.seriesBible = bible;
    if (fullScript) update.lastScriptContent = fullScript;
    await setDoc(chatDoc, update, { merge: true });
  };

  // --- AUDIO ---
  const fetchAudioChunk = async (text) => {
    const authHeader = `Basic ${INWORLD_API_KEY.trim()}`;
    const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({ text, voiceId: VOICE_ID, modelId: MODEL_ID })
    });
    const json = await response.json();
    return Uint8Array.from(atob(json.audioContent), c => c.charCodeAt(0)).buffer;
  };

  const processAudioQueue = async () => {
    if (isCurrentlyPlaying.current || isPaused || audioBufferQueue.current.length === 0) {
      if (!isCurrentlyPlaying.current && speechQueue.current.length > 0) fillAudioBuffer();
      return;
    }
    isCurrentlyPlaying.current = true;
    setIsSpeaking(true);
    const item = audioBufferQueue.current.shift();
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    const ctx = audioContextRef.current;
    try {
      const buffer = await ctx.decodeAudioData(item.buffer);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      sourceNodeRef.current = source;
      source.onended = () => { isCurrentlyPlaying.current = false; processAudioQueue(); };
      source.start(0);
      fillAudioBuffer();
    } catch (e) { isCurrentlyPlaying.current = false; processAudioQueue(); }
  };

  const fillAudioBuffer = async () => {
    if (isFetchingNext.current || speechQueue.current.length === 0) return;
    isFetchingNext.current = true;
    try {
      const text = speechQueue.current.shift();
      const buffer = await fetchAudioChunk(text);
      audioBufferQueue.current.push({ buffer });
      processAudioQueue();
    } finally { isFetchingNext.current = false; }
  };

  const stopSpeech = () => {
    speechQueue.current = [];
    audioBufferQueue.current = [];
    if (sourceNodeRef.current) sourceNodeRef.current.stop();
    isCurrentlyPlaying.current = false;
    setIsSpeaking(false);
  };

  // --- THE BRAIN (2026 VERSION) ---
  const fetchFrankAI = async (history, isDeepDive = false) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    const script = scriptMemoryRef.current;
    // Updated 2026 Model: Gemini 3 Flash
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`;
    
    const body = {
      system_instruction: {
        parts: [{ text: "You are Frank, a flamboyant, high-status movie executive. Be theatrical, blunt, and use script-specific quotes." }]
      },
      contents: history.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    };

    // If it's a script/deep dive, we anchor the context
    if (isDeepDive || script.length > 1000) {
      body.contents.push({
        role: 'user',
        parts: [{ text: `PERFORM SURGICAL ANALYSIS ON THIS SCRIPT:\n${script}` }]
      });
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify(body)
      });
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text;
    } catch (e) { return "Brain glitch, darling. Refresh and let's try that take again."; }
  };

  const handleFrankResponse = async (text, isDeepDive = false) => {
    if (!text && !isDeepDive) return;
    stopSpeech();
    setIsProcessing(true);
    if (isDeepDive) { setIsDeepDiving(true); setActiveTab('deep-dive'); }
    
    const userMsg = isDeepDive ? "[Deep Dive Requested]" : text;
    const tempHistory = [...messages, { role: 'user', content: userMsg }];
    
    try {
      const reply = await fetchFrankAI(tempHistory, isDeepDive);
      const newMsgs = [...tempHistory, { role: 'assistant', content: reply }];
      setMessages(newMsgs);
      
      if (isDeepDive) setDeepDiveData({ content: reply });
      else if (text.includes("SCRIPT")) setScriptData({ content: reply, grade: "REVIEWED" });

      await saveToCloud(newMsgs, scriptData, deepDiveData, seriesBible, scriptMemoryRef.current);
      
      // Jimmy speaks the reply
      const cleaned = reply.replace(/[*_#]/g, '').slice(0, 1000); 
      speechQueue.current = cleaned.split(/[.!?]\s+/).filter(s => s.length > 2);
      processAudioQueue();
    } finally { setIsProcessing(false); setIsDeepDiving(false); setInputText(''); }
  };

  return (
    <div className="flex flex-col h-screen bg-[#faf9f6] text-stone-800 font-sans overflow-hidden">
      <header className="p-6 bg-white border-b flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-black text-white flex items-center justify-center font-bold italic rounded">F</div>
          <h1 className="font-black uppercase tracking-tighter text-xl">Frank AI</h1>
        </div>
        <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">
          <button onClick={() => setActiveTab('chat')} className={activeTab === 'chat' ? 'text-black border-b-2 border-black' : ''}>Lounge</button>
          <button onClick={() => setActiveTab('executive-report')} className={activeTab === 'executive-report' ? 'text-black border-b-2 border-black' : ''}>Report</button>
          <button onClick={() => setActiveTab('deep-dive')} className={activeTab === 'deep-dive' ? 'text-black border-b-2 border-black' : ''}>Surgery</button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col relative">
        <div className="flex-1 overflow-y-auto p-10 space-y-8 font-serif">
          {activeTab === 'chat' ? (
            messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-6 rounded-2xl ${m.role === 'user' ? 'bg-stone-800 text-white' : 'bg-white border shadow-sm'}`}>
                  {m.content}
                </div>
              </div>
            ))
          ) : (
            <div className="max-w-3xl mx-auto bg-white p-12 shadow-sm rounded-3xl whitespace-pre-wrap">
              {activeTab === 'executive-report' ? (scriptData?.content || "No pass yet.") : (deepDiveData?.content || "Surgery prepped.")}
            </div>
          )}
          {isProcessing && <div className="text-stone-400 animate-pulse italic">Frank is scribbling...</div>}
          <div ref={scrollRef} />
        </div>

        <div className="p-6 bg-white border-t space-y-4 shadow-2xl">
          <div className="flex justify-center gap-4">
            <button onClick={() => handleFrankResponse(null, true)} className={`px-8 py-3 rounded-full font-black text-[10px] uppercase tracking-widest transition-all ${isDeepDiving ? 'bg-red-600 text-white animate-pulse' : 'bg-stone-900 text-white'}`}>
              <Stethoscope size={14} className="inline mr-2" /> Deep Dive Surgery
            </button>
          </div>
          <div className="max-w-4xl mx-auto flex gap-3">
            <input 
              value={inputText} 
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleFrankResponse(inputText)}
              className="flex-1 bg-stone-50 border-none p-4 rounded-xl outline-none"
              placeholder="Convince me, darling..."
            />
            <button onClick={() => handleFrankResponse(inputText)} className="w-12 h-12 bg-black text-white rounded-full flex items-center justify-center"><Send size={18} /></button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
