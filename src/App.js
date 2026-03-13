import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Mic, MicOff, Pause, Play, RotateCcw, Loader2, AlertCircle, 
  FileUp, Trash2, CheckCircle2, Stethoscope, Scissors, Zap as ZapIcon, ZapOff 
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- CONFIGURATION (Now using Environment Variables) ---
const apiKey = process.env.REACT_APP_GEMINI_API_KEY; 
const INWORLD_API_KEY = process.env.REACT_APP_INWORLD_KEY; 
const VOICE_ID = process.env.REACT_APP_VOICE_ID; 
const MODEL_ID = "inworld-tts-1.5-max";

// Replace these with your actual Firebase credentials from the Firebase Console
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
  const micBaseTextRef = useRef(""); 
  const handsFreeActiveRef = useRef(false);
  const abortControllerRef = useRef(null);
  const scriptMemoryRef = useRef(""); 

  useEffect(() => { handsFreeActiveRef.current = isHandsFree; }, [isHandsFree]);

  // --- AUTH ---
  useEffect(() => {
    const login = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        setErrorMessage("Authentication failed. Check Firebase config.");
      }
    };
    login();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- DATA SYNC ---
  useEffect(() => {
    if (!user) return;
    const chatDoc = doc(db, 'artifacts', instanceAppId, 'users', user.uid, 'series_bible', 'main');
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
    }, (err) => console.error("Sync error:", err));
    return () => unsubscribe();
  }, [user]);

  const saveToCloud = async (newMessages, sData = null, dData = null, bible = null, fullScript = null) => {
    if (!user) return;
    const lightweightMessages = newMessages.map(m => m.content.includes("SCRIPT CONTENT:") ? { ...m, content: "[Full Script Analyzed]" } : m);
    const chatDoc = doc(db, 'artifacts', instanceAppId, 'users', user.uid, 'series_bible', 'main');
    const update = { messages: lightweightMessages };
    if (sData !== null) update.scriptData = sData;
    if (dData !== null) update.deepDiveData = dData;
    if (bible !== null) update.seriesBible = bible;
    if (fullScript !== null) update.lastScriptContent = fullScript;
    await setDoc(chatDoc, update, { merge: true });
  };

  const clearHistory = async () => {
    if (!user) return;
    const chatDoc = doc(db, 'artifacts', instanceAppId, 'users', user.uid, 'series_bible', 'main');
    const reset = [{ role: 'assistant', content: "The slate is wiped clean, darling. Let's start with a bang." }];
    setMessages(reset);
    setScriptData(null);
    setDeepDiveData(null);
    setSeriesBible("");
    setLastScriptContent("");
    scriptMemoryRef.current = "";
    await setDoc(chatDoc, { messages: reset, scriptData: null, deepDiveData: null, seriesBible: "", lastScriptContent: "" });
  };

  // --- AUDIO ENGINE ---
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
        if (handsFreeActiveRef.current) setTimeout(() => toggleDictation(true), 600);
        return;
      }
      await fillAudioBuffer();
      if (audioBufferQueue.current.length === 0) {
        setTimeout(processAudioQueue, 150);
        return;
      }
    }
    isCurrentlyPlaying.current = true;
    setIsSpeaking(true);
    const currentItem = audioBufferQueue.current.shift();
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    try {
      const decodedBuffer = await ctx.decodeAudioData(currentItem.buffer.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(ctx.destination);
      sourceNodeRef.current = source;
      source.start(0);
      fillAudioBuffer();
      source.onended = () => {
        isCurrentlyPlaying.current = false;
        processAudioQueue(); 
      };
    } catch (e) {
      isCurrentlyPlaying.current = false;
      processAudioQueue();
    }
  };

  const fillAudioBuffer = async () => {
    if (isFetchingNext.current || speechQueue.current.length === 0) return;
    isFetchingNext.current = true;
    try {
      const nextText = speechQueue.current.shift();
      const buffer = await fetchAudioChunk(nextText);
      audioBufferQueue.current.push({ text: nextText, buffer });
    } catch (e) { } finally { isFetchingNext.current = false; }
  };

  const queueSpeech = (fullText) => {
    const cleaned = fullText.replace(/[*_#~`>]/g, '').replace(/\[.*?\]/g, '').replace(/\n\n+/g, ' ').replace(/\s+/g, ' ').trim();
    const chunks = cleaned.split(/(?<=[.!?])\s+/).filter(c => c.length > 2);
    speechQueue.current = [...speechQueue.current, ...chunks];
    processAudioQueue();
  };

  const stopSpeech = () => {
    speechQueue.current = [];
    audioBufferQueue.current = [];
    if (sourceNodeRef.current) try { sourceNodeRef.current.stop(); } catch (e) {}
    isCurrentlyPlaying.current = false;
    setIsSpeaking(false);
    setIsPaused(false);
  };

  const togglePause = async () => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    if (isPaused) {
      setIsPaused(false);
      await ctx.resume();
      processAudioQueue();
    } else {
      setIsPaused(true);
      await ctx.suspend();
    }
  };

  // --- MICROPHONE ENGINE ---
  const toggleDictation = (forceStart = false) => {
    if (isRecording && !forceStart) { 
      recognitionRef.current?.stop();
      setIsRecording(false); 
      return; 
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    micBaseTextRef.current = inputText;

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (e) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setInputText((micBaseTextRef.current + ' ' + transcript).replace(/\s+/g, ' ').trim());
    };
    recognition.onend = () => {
      setIsRecording(false);
      if (handsFreeActiveRef.current) {
        const val = document.querySelector('#frank-input')?.value;
        if (val?.trim().length > 3) handleFrankResponse(val);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  // --- BRAIN: GEMINI API CALL ---
  const fetchFrankAI = async (history, deepDiveRequest = false) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    const latestTurn = history[history.length - 1].content;
    const isScriptMode = latestTurn.includes("SCRIPT CONTENT:") || latestTurn.length > 1000 || deepDiveRequest;
    const surgeryScript = scriptMemoryRef.current || lastScriptContent;

    const systemPrompt = `You are Frank, a theatrical, flamboyant, sharp-tongued elite Sunset Blvd executive. Speak ONLY in FIRST PERSON. Start with a RANDOM, SHARP observation about the script vibes. All fixes must be NARRATIVELY GROUNDED.`;
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const consolidatedPrompt = `CONTEXT: ${seriesBible || "New Pilot."} INPUT: ${deepDiveRequest ? `SURGERY ON: ${surgeryScript}` : latestTurn}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: consolidatedPrompt }] }], systemInstruction: { parts: [{ text: systemPrompt }] } })
      });
      if (response.ok) {
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    } catch (e) { if (e.name === 'AbortError') return null; }
    return "Frank is momentarily speechless, darling. Try again.";
  };

  const handleFrankResponse = async (textToProcess, isDeepDive = false) => {
    if (!textToProcess && !isDeepDive) return;
    stopSpeech();
    setIsProcessing(true);
    if (isDeepDive) { setIsDeepDiving(true); setActiveTab('deep-dive'); }
    setInputText('');

    try {
      const responseText = await fetchFrankAI([...messages, { role: 'user', content: textToProcess || "[Deep Dive Request]" }], isDeepDive);
      const isScript = textToProcess?.includes("SCRIPT CONTENT:") || isDeepDive;
      const newMessages = [...messages, { role: 'user', content: isDeepDive ? "[Surgical Deep Dive]" : textToProcess }, { role: 'assistant', content: responseText }];
      
      if (isScript) {
        const up = responseText.toUpperCase();
        const grade = up.includes("GREEN LIGHT") ? "GREEN LIGHT" : (up.includes("CONSIDER") ? "CONSIDER" : "PASS");
        if (isDeepDive) setDeepDiveData({ content: responseText, grade });
        else setScriptData({ content: responseText, grade });
        await saveToCloud(newMessages, scriptData, deepDiveData, seriesBible, scriptMemoryRef.current);
      } else {
        setMessages(newMessages);
        await saveToCloud(newMessages);
      }
      queueSpeech(responseText);
    } finally { setIsProcessing(false); setIsDeepDiving(false); }
  };

  return (
    <div className="flex flex-col h-screen bg-[#faf9f6] text-[#2c2c2c] font-sans overflow-hidden text-sm">
      <header className="flex items-center justify-between px-8 py-5 bg-white border-b border-stone-200 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-black rounded flex items-center justify-center text-white font-bold italic shadow-lg">F</div>
          <div>
            <h1 className="text-xl font-black tracking-tighter uppercase text-stone-800 leading-none">Frank</h1>
            <p className="text-[8px] uppercase tracking-[0.3em] font-bold mt-1 text-stone-400">Executive Series Office</p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-[10px] font-bold tracking-widest text-stone-400 uppercase">
          <button onClick={() => setActiveTab('chat')} className={activeTab === 'chat' ? 'text-black border-b-2 border-black' : ''}>LOUNGE</button>
          <button onClick={() => setActiveTab('executive-report')} className={activeTab === 'executive-report' ? 'text-black border-b-2 border-black' : ''}>REPORT CARD</button>
          <button onClick={() => setActiveTab('deep-dive')} className={activeTab === 'deep-dive' ? 'text-black border-b-2 border-black' : ''}>SURGERY</button>
          <button onClick={clearHistory} className="text-red-400"><Trash2 size={12} /></button>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        {activeTab === 'chat' ? (
          <div className="flex-1 overflow-y-auto p-10 space-y-10 font-serif">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] p-6 rounded-2xl ${m.role === 'user' ? 'bg-stone-800 text-white' : 'bg-white border'}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {isProcessing && <div className="text-stone-400 animate-pulse">Frank is thinking...</div>}
            <div ref={scrollRef} />
          </div>
        ) : (
          <div className="flex-1 p-16 overflow-y-auto">
             <div className="max-w-3xl mx-auto bg-white p-12 shadow-sm rounded-3xl">
                <h2 className="text-3xl font-black mb-6 uppercase tracking-tighter">
                  {activeTab === 'executive-report' ? "Executive Pass" : "Surgical Deep Dive"}
                </h2>
                <div className="whitespace-pre-wrap leading-relaxed">
                  {activeTab === 'executive-report' ? (scriptData?.content || "No pilot analyzed.") : (deepDiveData?.content || "Surgery suite empty.")}
                </div>
             </div>
          </div>
        )}

        <div className="bg-white border-t p-6 space-y-4">
          <div className="flex items-center justify-center gap-4">
            <button onClick={togglePause} className="w-12 h-12 bg-black text-white rounded-full flex items-center justify-center">
              {isPaused ? <Play size={20} /> : <Pause size={20} />}
            </button>
            <button 
              onClick={() => handleFrankResponse(null, true)} 
              className={`px-6 py-2 rounded-full font-bold text-[10px] ${isDeepDiving ? 'bg-red-600 text-white' : 'bg-stone-100'}`}
            >
              <Stethoscope size={14} className="inline mr-2" /> DEEP DIVE
            </button>
          </div>
          <div className="flex gap-4 max-w-4xl mx-auto">
            <input 
              id="frank-input"
              value={inputText} 
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleFrankResponse(inputText)}
              className="flex-1 bg-stone-50 p-4 rounded-xl outline-none"
              placeholder="Defend your arc, darling..." 
            />
            <button onClick={() => toggleDictation()} className={`w-12 h-12 rounded-full flex items-center justify-center ${isRecording ? 'bg-red-500 text-white' : 'bg-stone-100'}`}>
              <Mic size={20} />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;