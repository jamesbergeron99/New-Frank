import React, { useState, useEffect, useRef } from 'react';
import { Send, Mic, MicOff, Play, Pause, FileUp, Trash2 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- CONFIGURATION (SECURELY PULLING FROM YOUR .ENV) ---
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
  const [messages, setMessages] = useState([{ role: 'assistant', content: "I'm Frank. Darling, the velvet is on. Send me the pilot." }]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    signInAnonymously(auth);
    onAuthStateChanged(auth, setUser);
  }, []);

  // --- ORIGINAL WORKING TTS LOGIC ---
  const speak = async (text) => {
    try {
      const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Basic ${INWORLD_API_KEY}` 
        },
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
    } catch (e) { console.error("Voice failed", e); }
  };

  // --- ORIGINAL WORKING BRAIN LOGIC ---
  const handleFrankResponse = async (text) => {
    if (!text || isProcessing) return;
    setIsProcessing(true);
    setInputText('');

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `You are Frank, a flamboyant movie executive. Respond to: ${text}` }] }]
        })
      });
      const data = await response.json();
      const reply = data.candidates[0].content.parts[0].text;

      setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: reply }]);
      speak(reply);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Brain freeze, darling." }]);
    } finally { setIsProcessing(false); }
  };

  // --- ORIGINAL WORKING MIC LOGIC ---
  const toggleMic = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (isRecording) { recognitionRef.current.stop(); setIsRecording(false); return; }
    
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.onresult = (e) => {
      const transcript = e.results[e.results.length - 1][0].transcript;
      setInputText(prev => prev + " " + transcript);
    };
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  };

  return (
    <div className="flex flex-col h-screen bg-[#faf9f6] text-stone-800 font-sans">
      <header className="p-6 bg-white border-b flex justify-between shadow-sm">
        <h1 className="font-black italic text-2xl">FRANK</h1>
        <button onClick={() => setMessages([])} className="text-stone-400"><Trash2 size={18}/></button>
      </header>

      <main className="flex-1 overflow-y-auto p-10 space-y-6">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-6 rounded-2xl ${m.role === 'user' ? 'bg-stone-800 text-white' : 'bg-white border shadow-sm'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {isProcessing && <div className="italic text-stone-400">Frank is thinking...</div>}
      </main>

      <footer className="p-6 bg-white border-t flex flex-col gap-4">
        <div className="flex gap-4">
          <input 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleFrankResponse(inputText)}
            className="flex-1 bg-stone-50 p-4 rounded-xl outline-none border" 
            placeholder="Convince me, darling..." 
          />
          <button onClick={toggleMic} className={`p-4 rounded-full ${isRecording ? 'bg-red-500 text-white' : 'bg-stone-100'}`}><Mic size={20}/></button>
          <button onClick={() => handleFrankResponse(inputText)} className="bg-black text-white px-8 rounded-xl font-bold">SEND</button>
        </div>
      </footer>
    </div>
  );
};

export default App;
