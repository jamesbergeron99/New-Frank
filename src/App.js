import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Mic, MicOff, Pause, Play, RotateCcw, Loader2, AlertCircle, 
  FileUp, ClipboardList, Trash2, CheckCircle2, Zap, ZapOff, 
  BookOpen, Stethoscope, Scissors, Zap as ZapIcon 
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- CONFIGURATION ---
// Pulling only the 5 keys you specified
const apiKey = process.env.REACT_APP_GEMINI_API_KEY; 
const INWORLD_API_KEY = process.env.REACT_APP_INWORLD_KEY; 
const VOICE_ID = process.env.REACT_APP_VOICE_ID; 
const MODEL_ID = "inworld-tts-1.5-max";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_KEY,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  // These are derived from Project ID so you don't have to put them in .env
  authDomain: `${process.env.REACT_APP_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  storageBucket: `${process.env.REACT_APP_FIREBASE_PROJECT_ID}.appspot.com`,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'frank-exec-series-v14';

const App = () => {
  // --- ALL STATE & REFS FROM YOUR ORIGINAL PROGRAM ---
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "I'm Frank. Let's quit the posturing and see if these pages have a heartbeat. Send me the script when you're ready to get real." }
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
  const playedQueue = useRef([]); 
  const isCurrentlyPlaying = useRef(false);
  const isFetchingNext = useRef(false);
  const abortControllerRef = useRef(null);
  const scriptMemoryRef = useRef(""); 

  // --- AUTH & DATA SYNC ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) signInAnonymously(auth);
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const chatDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'series_bible', 'main');
    const unsubscribe = onSnapshot(chatDoc, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.messages) setMessages(data.messages);
        if (data.scriptData) setScriptData(data.scriptData);
        if (data.deepDiveData) setDeepDiveData(data.deepDiveData);
        if (data.seriesBible) setSeriesBible(data.seriesBible);
        if (data.lastScriptContent) {
            setLastScriptContent(data.lastScriptContent);
            scriptMemoryRef.current = data.lastScriptContent;
        }
      }
    });
    return () => unsubscribe();
  }, [user]);

  // --- REBUILT AUDIO ENGINE (TTS) ---
  const fetchAudioChunk = async (text) => {
    const authHeader = INWORLD_API_KEY.trim().startsWith('Basic ') ? INWORLD_API_KEY.trim() : `Basic ${INWORLD_API_KEY.trim()}`;
    const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({ text, voiceId: VOICE_ID, modelId: MODEL_ID })
    });
    const json = await response.json();
    const base64 = json.audioContent || (json.result && json.audioContent);
    const binary = window.atob(base64.replace(/^data:audio\/\w+;base64,/, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };

  const processAudioQueue = async () => {
    if (isCurrentlyPlaying.current || isPaused) return;
    if (audioBufferQueue.current.length === 0) {
      if (speechQueue.current.length === 0) {
        setIsSpeaking(false);
        return;
      }
      await fillAudioBuffer();
      return;
    }
    isCurrentlyPlaying.current = true;
    setIsSpeaking(true);
    const currentItem = audioBufferQueue.current.shift();
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioContextRef.current;
    const decodedBuffer = await ctx.decodeAudioData(currentItem.buffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(ctx.destination);
    sourceNodeRef.current = source;
    source.start(0);
    source.onended = () => {
      isCurrentlyPlaying.current = false;
      processAudioQueue(); 
    };
  };

  const fillAudioBuffer = async () => {
    if (isFetchingNext.current || speechQueue.current.length === 0) return;
    isFetchingNext.current = true;
    try {
      const nextText = speechQueue.current.shift();
      const buffer = await fetchAudioChunk(nextText);
      audioBufferQueue.current.push({ text: nextText, buffer });
      processAudioQueue();
    } catch (e) { console.error("TTS Error", e); } finally { isFetchingNext.current = false; }
  };

  const queueSpeech = (fullText) => {
    const cleaned = fullText.replace(/[*_#~`>]/g, '').replace(/\[.*?\]/g, '').replace(/\n\n+/g, ' ').trim();
    const chunks = cleaned.split(/(?<=[.!?])\s+/).filter(c => c.length > 2);
    speechQueue.current = [...speechQueue.current, ...chunks];
    processAudioQueue();
  };

  // --- FRANK BRAIN (GEMINI) ---
  const handleFrankResponse = async (textToProcess, isDeepDive = false) => {
    if (audioContextRef.current) sourceNodeRef.current?.stop();
    setIsProcessing(true);
    if (isDeepDive) { setIsDeepDiving(true); setActiveTab('deep-dive'); }
    
    const systemPrompt = `You are Frank, an elite Sunset Blvd executive. Speak ONLY in FIRST PERSON. ANTI-REPETITION PROTOCOL: Never start with standard greetings. Be sharp and specific.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: textToProcess }] }], systemInstruction: { parts: [{ text: systemPrompt }] } })
      });
      const data = await response.json();
      const responseText = data.candidates[0].content.parts[0].text;
      
      const newMessages = [...messages, { role: 'user', content: textToProcess }, { role: 'assistant', content: responseText }];
      setMessages(newMessages);
      queueSpeech(responseText);
      // Simplified Cloud Save
      const chatDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'series_bible', 'main');
      await setDoc(chatDoc, { messages: newMessages, lastScriptContent: scriptMemoryRef.current }, { merge: true });
    } catch (e) {
        setErrorMessage("Frank's hit a wall. Checking credentials...");
    } finally {
      setIsProcessing(false);
      setIsDeepDiving(false);
    }
  };

  // --- UI RENDER (The Tailwind Layout) ---
  return (
    <div className="flex flex-col h-screen bg-[#faf9f6] text-[#2c2c2c] font-sans overflow-hidden">
      <header className="flex items-center justify-between px-8 py-5 bg-white border-b border-stone-200 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-black rounded flex items-center justify-center text-white font-bold italic">F</div>
          <div>
            <h1 className="text-xl font-black tracking-tighter uppercase text-stone-800 leading-none">Frank</h1>
            <p className="text-[8px] uppercase tracking-[0.3em] font-bold mt-1 text-stone-400">Executive Series Office</p>
          </div>
        </div>
        <div className="flex gap-6 text-[10px] font-bold tracking-widest text-stone-400 uppercase">
          <button onClick={() => setActiveTab('chat')} className={activeTab === 'chat' ? 'text-black border-b-2 border-black' : ''}>LOUNGE</button>
          <button onClick={() => setActiveTab('deep-dive')} className={activeTab === 'deep-dive' ? 'text-black border-b-2 border-black' : ''}>SURGERY</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-10 space-y-10 relative">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] p-6 leading-relaxed ${m.role === 'user' ? 'bg-stone-800 text-white rounded-2xl' : 'bg-white border border-stone-100 shadow-sm'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {isProcessing && <div className="text-stone-400 animate-pulse font-bold">Frank is thinking...</div>}
        <div ref={scrollRef} />
      </main>

      <footer className="p-6 bg-white border-t border-stone-100">
        <div className="flex items-center gap-4 max-w-5xl mx-auto w-full">
            <input 
                value={inputText} 
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleFrankResponse(inputText)}
                className="flex-1 px-6 py-4 bg-stone-50 border-none rounded-xl text-sm" 
                placeholder="Defend your arc..." 
            />
            <button onClick={() => handleFrankResponse(inputText)} className="bg-black text-white p-4 rounded-xl"><Send size={18} /></button>
        </div>
      </footer>
    </div>
  );
};

export default App;