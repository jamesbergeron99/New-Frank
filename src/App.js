import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Mic, MicOff, Pause, Play, RotateCcw, Loader2, AlertCircle, 
  FileUp, Trash2, CheckCircle2, Stethoscope, Scissors, Zap as ZapIcon, ZapOff 
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- CONFIGURATION (Render Environment Variables) ---
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
const appId = 'frank-exec-series-v14';

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
  const scriptMemoryRef = useRef(""); 

  useEffect(() => { handsFreeActiveRef.current = isHandsFree; }, [isHandsFree]);

  useEffect(() => {
    signInAnonymously(auth);
    return auth.onAuthStateChanged(setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const chatDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'series_bible', 'main');
    return onSnapshot(chatDoc, (docSnap) => {
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
  }, [user]);

  // --- TTS ENGINE ---
  const fetchAudioChunk = async (text) => {
    const authHeader = `Basic ${INWORLD_API_KEY.trim()}`;
    const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({ text, voiceId: VOICE_ID, modelId: MODEL_ID })
    });
    const json = await response.json();
    const binary = window.atob(json.audioContent);
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
    const item = audioBufferQueue.current.shift();
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    const ctx = audioContextRef.current;
    const decodedBuffer = await ctx.decodeAudioData(item.buffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(ctx.destination);
    sourceNodeRef.current = source;
    source.onended = () => { isCurrentlyPlaying.current = false; processAudioQueue(); };
    source.start(0);
    fillAudioBuffer();
  };

  const fillAudioBuffer = async () => {
    if (isFetchingNext.current || speechQueue.current.length === 0) return;
    isFetchingNext.current = true;
    try {
      const nextText = speechQueue.current.shift();
      const buffer = await fetchAudioChunk(nextText);
      audioBufferQueue.current.push({ buffer });
    } finally { isFetchingNext.current = false; }
  };

  const queueSpeech = (fullText) => {
    const cleaned = fullText.replace(/[*_#~`>]/g, '').replace(/\[.*?\]/g, '').replace(/\n\n+/g, ' ').trim();
    speechQueue.current = cleaned.split(/(?<=[.!?])\s+/).filter(c => c.length > 2);
    processAudioQueue();
  };

  const stopSpeech = () => {
    speechQueue.current = [];
    audioBufferQueue.current = [];
    if (sourceNodeRef.current) try { sourceNodeRef.current.stop(); } catch (e) {}
    isCurrentlyPlaying.current = false;
    setIsSpeaking(false);
  };

  // --- DICTATION ENGINE ---
  const toggleDictation = (forceStart = false) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (isRecording && !forceStart) { recognitionRef.current?.stop(); setIsRecording(false); return; }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    micBaseTextRef.current = inputText;
    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (e) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setInputText((micBaseTextRef.current + ' ' + transcript).trim());
    };
    recognition.onend = () => {
      setIsRecording(false);
      if (handsFreeActiveRef.current && inputText.length > 3) handleFrankResponse(inputText);
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  // --- GEMINI BRAIN ---
  const handleFrankResponse = async (textToProcess, isDeepDive = false) => {
    if (!textToProcess && !isDeepDive) return;
    stopSpeech();
    setIsProcessing(true);
    if (isDeepDive) { setIsDeepDiving(true); setActiveTab('deep-dive'); }
    setInputText('');

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ parts: [{ text: `You are Frank, a flamboyant, blunt Sunset Blvd executive. Respond to: ${isDeepDive ? "SURGERY ON: " + scriptMemoryRef.current : textToProcess}` }] }]
      };
      
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      const reply = data.candidates[0].content.parts[0].text;

      const newMsgs = [...messages, { role: 'user', content: isDeepDive ? "[Surgical Deep Dive]" : textToProcess }, { role: 'assistant', content: reply }];
      setMessages(newMsgs);
      
      if (isDeepDive) setDeepDiveData({ content: reply });
      else if (textToProcess.includes("SCRIPT")) setScriptData({ content: reply, grade: "REVIEWED" });

      queueSpeech(reply);
    } finally { setIsProcessing(false); setIsDeepDiving(false); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsProcessing(true);
    const text = await file.text();
    scriptMemoryRef.current = text;
    handleFrankResponse(`[Episode Uploaded] SCRIPT CONTENT: ${text.slice(0, 30000)}`);
  };

  return (
    <div className="flex flex-col h-screen bg-[#faf9f6] text-stone-800 font-sans overflow-hidden">
      <header className="p-6 bg-white border-b flex justify-between items-center">
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

      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-10 space-y-6">
          {activeTab === 'chat' ? (
            messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-6 rounded-2xl ${m.role === 'user' ? 'bg-stone-800 text-white' : 'bg-white border shadow-sm'}`}>
                  {m.content}
                </div>
              </div>
            ))
          ) : (
            <div className="max-w-3xl mx-auto bg-white p-12 shadow-sm rounded-3xl whitespace-pre-wrap font-serif">
              {activeTab === 'executive-report' ? (scriptData?.content || "No pass yet.") : (deepDiveData?.content || "Surgery prepped.")}
            </div>
          )}
          {isProcessing && <div className="italic text-stone-400">Frank is considering...</div>}
        </div>

        <div className="p-6 bg-white border-t space-y-4">
          <div className="flex justify-center gap-4">
            <button onClick={() => handleFrankResponse(null, true)} className="px-8 py-2 bg-stone-900 text-white rounded-full text-[10px] font-bold uppercase tracking-widest">
              <Stethoscope size={14} className="inline mr-2" /> Surgery
            </button>
          </div>
          <div className="max-w-4xl mx-auto flex gap-3">
            <input 
              value={inputText} 
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleFrankResponse(inputText)}
              className="flex-1 bg-stone-50 p-4 rounded-xl outline-none"
              placeholder="Convince me, darling..."
            />
            <button onClick={() => toggleDictation()} className={`w-12 h-12 rounded-full flex items-center justify-center ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-stone-100'}`}>
              {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <label className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center cursor-pointer">
              <FileUp size={20} />
              <input type="file" className="hidden" accept=".pdf,.txt" onChange={handleFileUpload} />
            </label>
            <button onClick={() => handleFrankResponse(inputText)} className="w-12 h-12 bg-black text-white rounded-full flex items-center justify-center"><Send size={18} /></button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
