import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Mic, MicOff, Pause, Play, RotateCcw, Loader2, 
  FileUp, Trash2, Stethoscope, Scissors 
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- CONFIGURATION ---
const apiKey = process.env.REACT_APP_GEMINI_API_KEY; 

// Jimmy Voice Clone - Locked Credentials
const INWORLD_API_KEY = "SjdZdzZYYWUwY21LdlliOXdrTEhFNDlhUkYxM2FCWHA6bUt1aGszVVJnYU9NN0twNm5odnhyWlJLWURhT2lDUFJFNUFnQk81RXpKajJkcVVSUlhtV0hseGhmZEc3U2IzYg=="; 
const VOICE_ID = "default-oglabcjnetcklcq7rghmbw__jimmy"; 

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
  const [messages, setMessages] = useState([{ role: 'assistant', content: "I'm Frank. Darling, the velvet is on. Let’s see if these pages have enough soul to survive the weekend." }]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [scriptData, setScriptData] = useState(null);
  const [deepDiveData, setDeepDiveData] = useState(null);

  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const recognitionRef = useRef(null);
  const scriptMemoryRef = useRef("");

  useEffect(() => {
    signInAnonymously(auth);
    onAuthStateChanged(auth, setUser);
  }, []);

  // --- AUDIO ENGINE ---
  const speak = async (text) => {
    try {
      const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${INWORLD_API_KEY}` },
        body: JSON.stringify({ text, voiceId: VOICE_ID, modelId: "inworld-tts-1.5-max" })
      });
      const json = await response.json();
      const binary = window.atob(json.audioContent);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      sourceNodeRef.current = source;
      setIsSpeaking(true);
      source.onended = () => setIsSpeaking(false);
      source.start(0);
    } catch (e) { console.error("Voice Error", e); }
  };

  // --- BRAIN ENGINE ---
  const handleFrankResponse = async (textToProcess, isDeepDive = false) => {
    if (!textToProcess && !isDeepDive) return;
    setIsProcessing(true);
    if (isDeepDive) setActiveTab('deep-dive');
    
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const prompt = isDeepDive ? `PERFORM SURGERY ON THIS SCRIPT: ${scriptMemoryRef.current}` : textToProcess;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `You are Frank, a flamboyant Sunset Blvd executive. Respond to: ${prompt}` }] }]
        })
      });
      
      const data = await response.json();
      const reply = data.candidates[0].content.parts[0].text;
      
      const newMessages = [...messages, { role: 'user', content: isDeepDive ? "[Deep Dive]" : textToProcess }, { role: 'assistant', content: reply }];
      setMessages(newMessages);
      if (isDeepDive) setDeepDiveData({ content: reply });
      
      speak(reply);
    } catch (e) { setMessages(prev => [...prev, { role: 'assistant', content: "Brain freeze, darling." }]); }
    finally { setIsProcessing(false); setInputText(''); }
  };

  // --- TOOLS: MIC & PDF ---
  const toggleMic = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (isRecording) { recognitionRef.current.stop(); setIsRecording(false); return; }
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.onresult = (e) => setInputText(prev => prev + " " + e.results[e.results.length-1][0].transcript);
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    scriptMemoryRef.current = text;
    handleFrankResponse(`[Script Uploaded] CONTENT: ${text.slice(0, 10000)}`);
  };

  return (
    <div className="flex flex-col h-screen bg-[#faf9f6] text-stone-800 font-sans overflow-hidden">
      <header className="p-6 bg-white border-b flex justify-between shadow-sm">
        <h1 className="font-black italic text-2xl">FRANK AI</h1>
        <div className="flex gap-4 text-[10px] uppercase font-bold text-stone-400">
          <button onClick={() => setActiveTab('chat')} className={activeTab === 'chat' ? 'text-black' : ''}>Lounge</button>
          <button onClick={() => setActiveTab('deep-dive')} className={activeTab === 'deep-dive' ? 'text-black' : ''}>Surgery</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-10 space-y-6 bg-[#fdfcfb]">
        {activeTab === 'chat' ? (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-6 rounded-2xl ${m.role === 'user' ? 'bg-stone-800 text-white' : 'bg-white border'}`}>
                {m.content}
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white p-10 rounded-xl shadow-sm whitespace-pre-wrap">{deepDiveData?.content || "Surgery prepped."}</div>
        )}
        {isProcessing && <div className="italic text-stone-400">Frank is scribbling...</div>}
      </main>

      <footer className="p-8 bg-white border-t space-y-4">
        <div className="flex justify-center gap-4">
          <button onClick={() => handleFrankResponse(null, true)} className="bg-red-600 text-white px-6 py-2 rounded-full text-[10px] font-bold uppercase"><Stethoscope size={14} className="inline mr-2"/> Surgery</button>
        </div>
        <div className="max-w-4xl mx-auto flex gap-4">
          <input value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleFrankResponse(inputText)} className="flex-1 bg-stone-50 p-4 rounded-xl outline-none" placeholder="Convince me, darling..." />
          <button onClick={toggleMic} className={`w-12 h-12 rounded-full flex items-center justify-center ${isRecording ? 'bg-red-500 text-white' : 'bg-stone-100'}`}><Mic size={20}/></button>
          <label className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center cursor-pointer"><FileUp size={20}/><input type="file" className="hidden" onChange={handleFileUpload}/></label>
          <button onClick={() => handleFrankResponse(inputText)} className="bg-black text-white px-8 rounded-xl font-bold uppercase text-[10px]">Send</button>
        </div>
      </footer>
    </div>
  );
};

export default App;
