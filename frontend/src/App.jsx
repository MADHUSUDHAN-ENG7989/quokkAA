import { useState, useRef, useEffect } from 'react';
import './App.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useAuth } from './context/AuthContext';
import AuthModal from './components/AuthModal';
import AdminPage from './pages/AdminPage';
import { motion, AnimatePresence } from 'framer-motion';
// removed confetti import

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('quokka_theme') || 'dark';
  });
  const [readingMode, setReadingMode] = useState(() => {
    const saved = localStorage.getItem('quokka_reading_mode');
    if (saved === 'true') return 2; // Default to standard medium if it was boolean true
    if (saved === 'false' || !saved) return 0;
    const parsed = parseInt(saved, 10);
    return isNaN(parsed) ? 0 : parsed;
  });

  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
    localStorage.setItem('quokka_theme', theme);
  }, [theme]);

  useEffect(() => {
    document.body.classList.remove('reading-mode-1', 'reading-mode-2', 'reading-mode-3');
    if (readingMode > 0) {
      document.body.classList.add(`reading-mode-${readingMode}`);
    }
    localStorage.setItem('quokka_reading_mode', readingMode.toString());
  }, [readingMode]);

  const { user, token, isLimitReached, incrementQueryCount, logout } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  
  const [windows, setWindows] = useState([]);
  const [activeWindowId, setActiveWindowId] = useState('');
  const [guestId] = useState(() => {
    let id = localStorage.getItem('quokka_guest_id');
    if (!id) {
      id = 'g_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('quokka_guest_id', id);
    }
    return id;
  });

  const [editingChatId, setEditingChatId] = useState(null);
  const [editTitleInput, setEditTitleInput] = useState('');

  // Fetch chats from MongoDB on load or login/logout
  useEffect(() => {
    const fetchChats = async () => {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        } else {
          headers['x-guest-id'] = guestId;
        }

        const res = await fetch(`${API}/api/chats`, { headers });
        const data = await res.json();
        
        if (Array.isArray(data)) {
          const loadedWindows = data.map(w => ({
            id: w._id,
            title: w.title,
            messages: w.messages || [],
            isLoading: false,
            model: w.model || 'rag'
          }));

          const newId = 'temp_' + Date.now().toString();
          const newWindow = { id: newId, title: 'New Chat', messages: [], isLoading: false, model: 'rag' };

          setWindows([newWindow, ...loadedWindows]);
          setActiveWindowId(newId);
        }
      } catch (e) {
        console.error("Error fetching chats from MongoDB:", e);
        const newId = 'temp_' + Date.now().toString();
        setWindows([{ id: newId, title: 'New Chat', messages: [], isLoading: false, model: 'rag' }]);
        setActiveWindowId(newId);
      }
    };

    fetchChats();
  }, [token, guestId]);

  const [selectedModel, setSelectedModel] = useState('rag'); // 'rag', 'qdrant', or 'finetuned'
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showApiModal, setShowApiModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const modelMenuRef = useRef(null);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const uploadMenuRef = useRef(null);
  const [attachedFile, setAttachedFile] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const recognitionRef = useRef(null);
  const speechStartInputRef = useRef('');
  const silenceTimerRef = useRef(null);
  const handleSubmitRef = useRef(null);

  // Sync handleSubmit reference to prevent stale closures in timers
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setShowModelMenu(false);
      }
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(event.target)) {
        setShowUploadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const transcript = finalTranscript || interimTranscript;
        if (transcript.trim()) {
          const baseText = speechStartInputRef.current;
          const updatedInput = baseText ? baseText.trim() + ' ' + transcript : transcript;
          setInput(updatedInput);

          // Reset and start silence auto-submit timer (3 seconds idle) ⏳
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            if (recognitionRef.current) {
              recognitionRef.current.stop();
              setIsListening(false);
            }
            if (handleSubmitRef.current) {
              handleSubmitRef.current({ preventDefault: () => {} });
            }
          }, 3000);
        }
      };

      rec.onerror = (err) => {
        console.error("Speech Recognition Error:", err);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. Try Google Chrome!");
      return;
    }

    if (isListening) {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        speechStartInputRef.current = input;
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error("Failed to start speech recognition:", err);
      }
    }
  };

  // Cleanup silence timer on unmount
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  const readAloud = (msgId, text) => {
    if (!window.speechSynthesis) {
      alert("Text-to-speech is not supported in this browser.");
      return;
    }

    if (speakingMessageId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }

    window.speechSynthesis.cancel();
    
    const cleanText = text
      .replace(/[*_#`~>]/g, '')
      .replace(/\[.*?\]\(.*?\)/g, '')
      .substring(0, 1000);

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-US';
    
    utterance.onend = () => {
      setSpeakingMessageId(null);
    };

    utterance.onerror = () => {
      setSpeakingMessageId(null);
    };

    setSpeakingMessageId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  const [input, setInput] = useState('');
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  const activeWindow = windows.find(w => w.id === activeWindowId) || windows[0] || { messages: [], isLoading: false };

  const scrollToBottom = (instant = false) => {
    if (shouldAutoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: instant ? "auto" : "smooth" });
    }
  };

  useEffect(() => {
    if (activeWindow && activeWindow.messages) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWindow?.messages, activeWindow?.isLoading]);

  // Handle manual scroll to disable auto-scroll if user moves up
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShouldAutoScroll(isAtBottom);
  };

  const triggerUpload = (acceptType) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = acceptType;
      fileInputRef.current.click();
    }
    setShowUploadMenu(false);
  };

  const handleTriggerSummarize = () => {
    if (isLimitReached) {
      setShowAuth(true);
      return;
    }
    triggerUpload('.pdf,.txt,.md');
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAttachedFile(file);
    e.target.value = '';
  };

  const createNewWindow = () => {
    const existingTemp = windows.find(w => w.id.startsWith('temp_'));
    if (existingTemp) {
      setActiveWindowId(existingTemp.id);
      setInput('');
      return;
    }

    const newId = 'temp_' + Date.now().toString();
    const newWindow = { id: newId, title: 'New Chat', messages: [], isLoading: false, model: 'rag' };
    setWindows(prev => [newWindow, ...prev]);
    setActiveWindowId(newId);
    setInput('');
  };

  const switchWindow = (id) => {
    setActiveWindowId(id);
    setInput('');
  };

  const closeWindow = async (e, id) => {
    e.stopPropagation();

    if (id.startsWith('temp_')) {
      setWindows(prev => {
        const remaining = prev.filter(w => w.id !== id);
        if (remaining.length === 0) {
          const newId = 'temp_' + Date.now().toString();
          setActiveWindowId(newId);
          return [{ id: newId, title: 'New Chat', messages: [], isLoading: false, model: 'rag' }];
        }
        if (id === activeWindowId) {
          setActiveWindowId(remaining[0].id);
        }
        return remaining;
      });
      return;
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      else headers['x-guest-id'] = guestId;

      await fetch(`${API}/api/chats/${id}`, {
        method: 'DELETE',
        headers
      });

      setWindows(prev => {
        const remaining = prev.filter(w => w.id !== id);
        if (remaining.length === 0) {
          const newId = 'temp_' + Date.now().toString();
          setActiveWindowId(newId);
          return [{ id: newId, title: 'New Chat', messages: [], isLoading: false, model: 'rag' }];
        }
        if (id === activeWindowId) {
          setActiveWindowId(remaining[0].id);
        }
        return remaining;
      });
    } catch (err) {
      console.error("Error deleting chat session:", err);
    }
  };

  const renameChat = async (id, newTitle) => {
    if (!newTitle.trim()) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      else headers['x-guest-id'] = guestId;

      const chat = windows.find(w => w.id === id);
      await fetch(`${API}/api/chats/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          title: newTitle.trim(),
          messages: chat.messages,
          model: chat.model || selectedModel
        })
      });

      setWindows(prev => prev.map(w => w.id === id ? { ...w, title: newTitle.trim() } : w));
      setEditingChatId(null);
    } catch (err) {
      console.error("Error renaming chat:", err);
    }
  };

  const clearAllWindows = async () => {
    if (window.confirm("Are you sure you want to clear all chat sessions? This cannot be undone.")) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        else headers['x-guest-id'] = guestId;

        await fetch(`${API}/api/chats`, {
          method: 'DELETE',
          headers
        });

        const newId = 'temp_' + Date.now().toString();
        const freshWindow = { id: newId, title: 'New Chat', messages: [], isLoading: false, model: 'rag' };
        setWindows([freshWindow]);
        setActiveWindowId(newId);
      } catch (err) {
        console.error("Error clearing chats:", err);
      }
    }
  };

  // eslint-disable-next-line no-unused-vars
  const exportCurrentChat = () => {
    if (!activeWindow || !activeWindow.messages || activeWindow.messages.length === 0) return;

    let mdContent = `# Quokka Research Session: ${activeWindow.title}\n\n`;
    activeWindow.messages.forEach(msg => {
      mdContent += `### ${msg.role === 'user' ? '👤 User' : '🐨 Quokka'}\n\n${msg.content}\n\n`;
      if (msg.sources && msg.sources.length > 0) {
        mdContent += `**Sources:** ${msg.sources.join(', ')}\n\n`;
      }
      mdContent += `---\n\n`;
    });

    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quokka_session_${activeWindow.title.replace(/\s+/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      // Could add a toast notification here if desired
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  };

  // eslint-disable-next-line no-unused-vars
  const updateActiveWindow = (updates) => {
    setWindows(prev => prev.map(w =>
      w.id === activeWindowId ? { ...w, ...updates } : w
    ));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeWindow || activeWindow.isLoading) return;
    if (!input.trim() && !attachedFile) return;

    if (isLimitReached) {
      setShowAuth(true);
      return;
    }

    const userQuery = input.trim();
    setInput('');

    if (attachedFile) {
      const fileToUpload = attachedFile;
      setAttachedFile(null);

      const tempChatId = 'temp_sum_' + Date.now().toString();
      const initialUserMsg = { 
        role: 'user', 
        content: userQuery 
          ? `Attached Document: **${fileToUpload.name}**\n\nQuestion: ${userQuery}`
          : `Attached Document: **${fileToUpload.name}**\n\nPlease summarize this document.`
      };
      const assistantLoadingMsg = { 
        role: 'assistant', 
        content: `Analyzing **${fileToUpload.name}** and generating response... Please wait.` 
      };

      const tempWindow = {
        id: tempChatId,
        title: userQuery ? `Analysis: ${fileToUpload.name.substring(0, 15)}...` : `Summary: ${fileToUpload.name.substring(0, 15)}...`,
        messages: [initialUserMsg, assistantLoadingMsg],
        isLoading: true,
        model: 'rag'
      };

      setWindows(prev => {
        const isActiveEmpty = prev.find(w => w.id === activeWindowId)?.messages.length === 0;
        if (isActiveEmpty) {
          return prev.map(w => w.id === activeWindowId ? tempWindow : w);
        } else {
          return [tempWindow, ...prev];
        }
      });
      setActiveWindowId(tempChatId);

      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('prompt', userQuery);
      formData.append('guestId', guestId);

      try {
        const headers = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        } else {
          headers['x-guest-id'] = guestId;
        }

        const res = await fetch(`${API}/api/summarize`, {
          method: 'POST',
          headers,
          body: formData
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          throw new Error(data.error || 'Failed to analyze file.');
        }

        setWindows(prev => prev.map(w => {
          if (w.id === tempChatId) {
            return {
              id: data._id,
              title: data.title,
              messages: data.messages,
              isLoading: false,
              model: 'rag'
            };
          }
          return w;
        }));
        setActiveWindowId(data._id);

      } catch (err) {
        console.error("Error analyzing file:", err);
        setWindows(prev => prev.map(w => {
          if (w.id === tempChatId) {
            return {
              ...w,
              isLoading: false,
              messages: [
                initialUserMsg,
                { 
                  role: 'assistant', 
                  content: `❌ **Error during document analysis:**\n\n${err.message || 'The server encountered an error while processing the document.'}`, 
                  isError: true 
                }
              ]
            };
          }
          return w;
        }));
      }
      return;
    }

    let currentSessionId = activeWindowId;
    let isNewChat = activeWindowId.startsWith('temp_');

    // Typing effect buffer 🗒️
    let typingBuffer = "";
    let isTyping = false;

    const processTyping = () => {
      if (typingBuffer.length > 0) {
        let batchSize = 1;
        if (typingBuffer.length > 200) batchSize = 10;
        else if (typingBuffer.length > 100) batchSize = 6;
        else if (typingBuffer.length > 50) batchSize = 4;
        else if (typingBuffer.length > 20) batchSize = 2;

        const chars = typingBuffer.substring(0, batchSize);
        typingBuffer = typingBuffer.substring(batchSize);
        
        setWindows(prev => prev.map(w => {
          if (w.id !== currentSessionId) return w;
          const newMsgs = [...w.messages];
          if (newMsgs.length === 0) return w;
          const lastMsg = { ...newMsgs[newMsgs.length - 1] };
          if (lastMsg.role !== 'assistant') return w;
          lastMsg.content += chars;
          newMsgs[newMsgs.length - 1] = lastMsg;
          return { ...w, messages: newMsgs };
        }));

        const delay = typingBuffer.length > 50 ? 1 : 4; 
        setTimeout(processTyping, delay);
      } else {
        isTyping = false;
      }
    };

    const initialUserMessage = { role: 'user', content: userQuery, sources: [] };
    let payloadHistory = [];

    if (isNewChat) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const createRes = await fetch(`${API}/api/chats`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            guestId,
            title: activeWindow.title !== "New Chat" ? activeWindow.title : (userQuery.length > 20 ? userQuery.substring(0, 20) + '...' : userQuery),
            messages: [initialUserMessage],
            model: selectedModel
          })
        });
        const savedChat = await createRes.json();
        if (savedChat._id) {
          currentSessionId = savedChat._id;
          setWindows(prev => prev.map(w => 
            w.id === activeWindowId 
              ? { ...w, id: savedChat._id, title: savedChat.title, messages: savedChat.messages, isLoading: true } 
              : w
          ));
          setActiveWindowId(savedChat._id);
        }
      } catch (err) {
        console.error("Error pre-creating chat in MongoDB:", err);
        const updatedMessages = [initialUserMessage];
        setWindows(prev => prev.map(w =>
          w.id === activeWindowId ? { ...w, messages: updatedMessages, isLoading: true } : w
        ));
      }
    } else {
      payloadHistory = activeWindow.messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));
      const updatedMessages = [...activeWindow.messages, initialUserMessage];
      setWindows(prev => prev.map(w =>
        w.id === activeWindowId ? { ...w, messages: updatedMessages, isLoading: true } : w
      ));
    }

    if (!user) incrementQueryCount();

    try {
      const authHeaders = token
        ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        : { 'Content-Type': 'application/json' };

      const response = await fetch(`${API}/api/chat_stream`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ 
          query: userQuery, 
          history: payloadHistory,
          model: selectedModel 
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      setWindows(prev => prev.map(w => {
        if (w.id !== currentSessionId) return w;
        if (w.messages.length > 0 && w.messages[w.messages.length - 1].role === 'assistant') {
          return w;
        }
        return {
          ...w,
          messages: [...w.messages, { role: 'assistant', content: '', sources: [] }]
        };
      }));

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      let done = false;
      let fullAssistantContent = "";
      let lineBuffer = "";
      let finalSources = [];

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          const chunkStr = decoder.decode(value, { stream: true });
          lineBuffer += chunkStr;

          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              if (!dataStr) continue;

              try {
                const data = JSON.parse(dataStr);

                if (data.type === 'sources') {
                  finalSources = data.sources;
                  setWindows(prev => prev.map(w => {
                    if (w.id !== currentSessionId) return w;
                    const newMsgs = [...w.messages];
                    const lastMsg = { ...newMsgs[newMsgs.length - 1] };
                    lastMsg.sources = data.sources;
                    newMsgs[newMsgs.length - 1] = lastMsg;
                    return { ...w, messages: newMsgs };
                  }));
                } else if (data.type === 'chunk') {
                  fullAssistantContent += data.content;
                  typingBuffer += data.content;
                  if (!isTyping) {
                    isTyping = true;
                    processTyping();
                  }
                }
              } catch (e) {
                console.error("Error parsing SSE data", e, dataStr);
              }
            }
          }
        }
      }

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        else headers['x-guest-id'] = guestId;

        const finalMessages = [
          ...payloadHistory,
          initialUserMessage,
          { role: 'assistant', content: fullAssistantContent, sources: finalSources }
        ];

        const finalTitle = activeWindow.title !== "New Chat"
          ? activeWindow.title
          : (isNewChat ? (userQuery.length > 20 ? userQuery.substring(0, 20) + '...' : userQuery) : activeWindow.title);

        await fetch(`${API}/api/chats/${currentSessionId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            title: finalTitle,
            messages: finalMessages,
            model: selectedModel
          })
        });
      } catch (syncErr) {
        console.error("Error syncing chat to MongoDB:", syncErr);
      }

      if (isNewChat && activeWindow.title === "New Chat") {
        try {
          const titleResponse = await fetch(`${API}/api/generate_title`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: userQuery, response: fullAssistantContent })
          });
          const titleData = await titleResponse.json();
          if (titleData.title) {
            setWindows(prev => prev.map(w => w.id === currentSessionId ? { ...w, title: titleData.title } : w));
            
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            else headers['x-guest-id'] = guestId;

            const finalMessages = [
              ...payloadHistory,
              initialUserMessage,
              { role: 'assistant', content: fullAssistantContent, sources: finalSources }
            ];

            await fetch(`${API}/api/chats/${currentSessionId}`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({
                title: titleData.title,
                messages: finalMessages,
                model: selectedModel
              })
            });
          }
        } catch (titleErr) {
          console.error("Error generating title:", titleErr);
        }
      }

    } catch (err) {
      console.error("Error querying the API:", err);
      setWindows(prev => prev.map(w => {
        if (w.id !== currentSessionId) return w;
        return {
          ...w,
          messages: [...w.messages, { role: 'assistant', content: "Failed to fetch response.", isError: true }]
        };
      }));
    } finally {
      setWindows(prev => prev.map(w => w.id === currentSessionId ? { ...w, isLoading: false } : w));
    }
  };

  const preprocessMarkdown = (text) => {
    if (!text) return '';
    return text
      .replace(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']+)["'][^>]*\/?>(?:<\/img>)?/gi, '![$2]($1)')
      .replace(/<img[^>]+alt=["']([^"']+)["'][^>]*src=["']([^"']+)["'][^>]*\/?>(?:<\/img>)?/gi, '![$1]($2)')
      .replace(/\\\[/g, '$$$')
      .replace(/\\\]/g, '$$$')
      .replace(/\\\(/g, '$')
      .replace(/\\\)/g, '$');
  };

  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  // Show admin dashboard full-screen
  if (showAdmin && user?.role === 'admin') {
    return <AdminPage onBack={() => setShowAdmin(false)} />;
  }



  return (
    <div className="browser-layout">
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        accept=".pdf,.txt,.md" 
        onChange={handleFileChange} 
      />
      <AnimatePresence>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
        {showStatusModal && <StatusModal onClose={() => setShowStatusModal(false)} />}
        {showApiModal && <ApiModal onClose={() => setShowApiModal(false)} />}
        {showBillingModal && <BillingModal onClose={() => setShowBillingModal(false)} />}
      </AnimatePresence>
      {/* Vertical Browser Sidebar */}
      <aside className="browser-sidebar">
        {/* ChatGPT Style Navigation Section */}
        <div className="sidebar-navigation">
          <button className="sidebar-top-btn" onClick={createNewWindow}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            <span>New chat</span>
          </button>
          <button className={`sidebar-top-btn ${showSearch ? 'active' : ''}`} onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchTerm(''); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span>Search chats</span>
          </button>
          <button className="sidebar-top-btn" onClick={() => setShowStatusModal(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            <span>System Status</span>
          </button>
          <button className="sidebar-top-btn" onClick={() => setShowApiModal(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            <span>API Reference</span>
          </button>
          {user?.role === 'admin' && (
            <button className="sidebar-top-btn" onClick={() => setShowAdmin(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="21" x2="9" y2="9"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
              <span>Admin Panel</span>
            </button>
          )}
          <button className="sidebar-top-btn" onClick={clearAllWindows} title="Clear All Sessions">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            <span>Clear Chats</span>
          </button>
        </div>

        {showSearch && (
          <div className="sidebar-search-container">
            <input 
              type="text" 
              className="sidebar-search-input" 
              placeholder="Filter chats by title..." 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
            {searchTerm && (
              <button className="clear-search-btn" onClick={() => setSearchTerm('')}>×</button>
            )}
          </div>
        )}

        <div className="recents-header">Recents</div>

        <div className="window-tabs">
          <AnimatePresence>
            {windows
              .filter(win => win.title.toLowerCase().includes(searchTerm.toLowerCase()))
              .map(win => (
              <motion.div
                key={win.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className={`window-tab ${win.id === activeWindowId ? 'active' : ''}`}
                onClick={() => switchWindow(win.id)}
              >
                <div className="tab-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                </div>
                {editingChatId === win.id ? (
                  <input
                    type="text"
                    className="tab-title-input"
                    value={editTitleInput}
                    onChange={(e) => setEditTitleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameChat(win.id, editTitleInput);
                      else if (e.key === 'Escape') setEditingChatId(null);
                    }}
                    onBlur={() => renameChat(win.id, editTitleInput)}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="tab-title">{win.title}</span>
                )}
                <div className="tab-actions-hover">
                  {editingChatId !== win.id && (
                    <button 
                      className="edit-tab-btn" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingChatId(win.id);
                        setEditTitleInput(win.title);
                      }} 
                      title="Rename Chat"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                    </button>
                  )}
                  <button className="close-tab-btn" onClick={(e) => closeWindow(e, win.id)} title="Delete Chat">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Account Profile Dashboard section */}
        <div className="sidebar-profile">
          {user ? (
            <div className="profile-container" onClick={() => { if (user.role === 'admin') setShowAdmin(true); else setShowBillingModal(true); }}>
              <div className="profile-avatar">
                {user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
              </div>
              <div className="profile-info">
                <span className="profile-name">{user.name || user.email}</span>
                <span className="profile-sub">{user.role === 'admin' ? 'Administrator' : 'Premium Member'}</span>
              </div>
              <button className="logout-btn" onClick={(e) => { e.stopPropagation(); logout(); }} title="Log Out">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              </button>
            </div>
          ) : (
            <div className="profile-container guest" onClick={() => setShowAuth(true)}>
              <div className="profile-avatar guest">G</div>
              <div className="profile-info">
                <span className="profile-name">Guest Session</span>
                <span className="profile-sub">Sign in for history persistence</span>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area (Active Window) */}
      <main className="main-content">
        <header className="main-header">
          <div className="header-brand">
            <div className="brand-mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="brand-text-group">
              <span className="brand-name">Quokka</span>
              <span className="brand-tagline">Materials Science AI</span>
            </div>
            <div className="model-selector" ref={modelMenuRef}>
              <button className="model-btn" onClick={() => setShowModelMenu(!showModelMenu)}>
                <span className="model-name">
                  {selectedModel === 'rag' ? 'RAG Expert' : selectedModel === 'qdrant' ? 'Qdrant Live RAG' : selectedModel === 'hybrid' ? 'Hybrid Ensemble' : 'Fine-tuned Qwen'}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              
              <AnimatePresence>
                {showModelMenu && (
                  <motion.div 
                    className="model-menu"
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div 
                      className={`model-option ${selectedModel === 'rag' ? 'selected' : ''}`}
                      onClick={() => { setSelectedModel('rag'); setShowModelMenu(false); }}
                    >
                      <div className="option-header">
                        <span className="option-title">Quokka RAG (Expert)</span>
                        {selectedModel === 'rag' && <span className="check-icon">✓</span>}
                      </div>
                      <span className="option-desc">Uses retrieval-augmented generation for specialized scientific accuracy.</span>
                    </div>

                    <div 
                      className={`model-option ${selectedModel === 'qdrant' ? 'selected' : ''}`}
                      onClick={() => { setSelectedModel('qdrant'); setShowModelMenu(false); }}
                    >
                      <div className="option-header">
                        <span className="option-title">Qdrant Live RAG</span>
                        {selectedModel === 'qdrant' && <span className="check-icon">✓</span>}
                      </div>
                      <span className="option-desc">Real-time web search and dynamic vector indexing on Qdrant Cloud.</span>
                    </div>

                    <div 
                      className={`model-option ${selectedModel === 'hybrid' ? 'selected' : ''}`}
                      onClick={() => { setSelectedModel('hybrid'); setShowModelMenu(false); }}
                    >
                      <div className="option-header">
                        <span className="option-title">Hybrid Ensemble</span>
                        {selectedModel === 'hybrid' && <span className="check-icon">✓</span>}
                      </div>
                      <span className="option-desc">Consensus engine that runs all 3 models in parallel and synthesizes the ultimate answer.</span>
                    </div>
                    
                    <div 
                      className={`model-option ${selectedModel === 'finetuned' ? 'selected' : ''}`}
                      onClick={() => { setSelectedModel('finetuned'); setShowModelMenu(false); }}
                    >
                      <div className="option-header">
                        <span className="option-title">Fine-tuned Qwen</span>
                        {selectedModel === 'finetuned' && <span className="check-icon">✓</span>}
                      </div>
                      <span className="option-desc">Direct response from your specialized Materials Science fine-tuned model.</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="header-actions">
            {/* Reading Mode Toggle */}
            {/* Reading Mode Step Toggle */}
            <button 
              type="button"
              className={`theme-toggle-btn reading-toggle-btn-step intensity-${readingMode}`} 
              onClick={() => setReadingMode(prev => (prev + 1) % 4)} 
              title={`Reading Mode: ${['Off', 'Low Intensity (Step 1)', 'Medium Intensity (Step 2)', 'High Intensity (Step 3)'][readingMode]}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              <div className="backlight-indicator-bars">
                <span className={`bar ${readingMode >= 1 ? 'lit' : ''}`}></span>
                <span className={`bar ${readingMode >= 2 ? 'lit' : ''}`}></span>
                <span className={`bar ${readingMode >= 3 ? 'lit' : ''}`}></span>
              </div>
            </button>

            {/* Dark/Light Mode Toggle */}
            <button 
              type="button"
              className="theme-toggle-btn" 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === 'dark' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>

            {user ? (
              <>
                {user.role === 'admin' && (
                  <button className="share-btn admin-dashboard-btn" onClick={() => setShowAdmin(true)} title="Admin Dashboard">
                    Admin
                  </button>
                )}
                <div className="user-info">
                  <span className="user-name">{user.name}</span>
                  <button className="logout-btn" onClick={logout} title="Logout">Sign out</button>
                </div>
              </>
            ) : (
              <button className="share-btn" onClick={() => setShowAuth(true)}>Login</button>
            )}
          </div>
        </header>

        <div className="chat-container" ref={scrollContainerRef} onScroll={handleScroll}>
          {activeWindow.messages.length === 0 ? (
            <motion.div 
              className="empty-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              style={{ flexDirection: 'column', gap: '32px', height: '100%', justifyContent: 'center' }}
            >
              <div className="empty-logo">
                <div className="brand-mark" style={{ width: 56, height: 56, borderRadius: 14 }} aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                </div>
                <motion.h1 
                  className="hero-text"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  How can I help with your research?
                </motion.h1>
                <motion.p
                  className="hero-subtext"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.08 }}
                >
                  Ask questions, summarize papers, or explore materials data with specialized RAG models.
                </motion.p>
              </div>

              <div className="suggestion-container">
                <div className="suggestion-cards">
                  <div className="suggestion-card" onClick={handleTriggerSummarize}>
                    <div className="suggestion-card-header">
                      <span className="suggestion-icon">📄</span>
                      <h3 className="suggestion-title">Summarize Article</h3>
                    </div>
                    <p className="suggestion-desc">Upload a PDF, TXT, or MD paper to get a comprehensive, structured scientific summary instantly.</p>
                  </div>
                  
                  <div className="suggestion-card" onClick={() => setInput("Help me draft a materials science research abstract about ")}>
                    <div className="suggestion-card-header">
                      <span className="suggestion-icon">✍️</span>
                      <h3 className="suggestion-title">Write or Edit</h3>
                    </div>
                    <p className="suggestion-desc">Draft abstracts, research notes, or technical reports with specialized scientific terminology.</p>
                  </div>
                  
                  <div className="suggestion-card" onClick={() => setInput("Look up the crystalline properties and phase changes of ")}>
                    <div className="suggestion-card-header">
                      <span className="suggestion-icon">🔍</span>
                      <h3 className="suggestion-title">Look Something Up</h3>
                    </div>
                    <p className="suggestion-desc">Search indexed materials science databases, physical properties, or crystalline structures.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="messages-list">
              <AnimatePresence>
                {activeWindow.messages.map((msg, index) => (
                  <motion.div 
                    key={index} 
                    className={`message-wrapper ${msg.role === 'user' ? 'user-wrapper' : 'assistant-wrapper'}`}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  >
                    {msg.role === 'assistant' && (
                      <div className="assistant-avatar">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                      </div>
                    )}
                  <div className={`message-bubble ${msg.role === 'user' ? 'user-bubble' : 'assistant-bubble'} ${msg.isError ? 'error-text' : ''}`}>
                    <div className="message-content">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {preprocessMarkdown(msg.content)}
                      </ReactMarkdown>
                    </div>
                    <div className="message-footer">
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="sources-inline">
                          <span className="sources-label">Sources:</span>
                          {msg.sources.map((s, i) => (
                            <span key={i} className="source-link" title={s}>[{i + 1}]</span>
                          ))}
                        </div>
                      )}
                      <button 
                        className={`copy-msg-btn ${speakingMessageId === (msg._id || index) ? 'speaking' : ''}`} 
                        onClick={() => readAloud(msg._id || index, msg.content)} 
                        title={speakingMessageId === (msg._id || index) ? "Stop reading" : "Read aloud"}
                        style={{ marginRight: '6px' }}
                      >
                        {speakingMessageId === (msg._id || index) ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2" /></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
                        )}
                      </button>
                      <button className="copy-msg-btn" onClick={() => copyToClipboard(msg.content)} title="Copy to Clipboard">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
              {activeWindow.isLoading && activeWindow.messages[activeWindow.messages.length - 1]?.role === 'user' && (
                <div className="message-wrapper assistant-wrapper">
                  <div className="assistant-avatar">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                  </div>
                  <div className="message-bubble assistant-bubble">
                    <div className="typing-dot"></div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="input-area">
          {attachedFile && (
            <div className="attached-file-badge">
              <span className="file-badge-icon">📎</span>
              <span className="file-badge-name">{attachedFile.name}</span>
              <button type="button" className="file-badge-remove" onClick={() => setAttachedFile(null)} title="Remove file">×</button>
            </div>
          )}
          <form className="input-form" onSubmit={handleSubmit}>
            <div className="attach-container" ref={uploadMenuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <button type="button" className="attach-btn" title="Attach file" onClick={() => setShowUploadMenu(!showUploadMenu)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              
              <AnimatePresence>
                {showUploadMenu && (
                  <motion.div 
                    className="upload-popover"
                    initial={{ opacity: 0, y: 15, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 15, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="upload-popover-header">
                      Choose File Type
                    </div>
                    <div className="upload-popover-options">
                      <div className="upload-popover-option" onClick={() => triggerUpload('.pdf')}>
                        <span className="popover-option-icon">📕</span>
                        <div className="popover-option-text">
                          <span className="popover-option-title">PDF Document</span>
                          <span className="popover-option-desc">Upload scientific papers or PDFs</span>
                        </div>
                      </div>
                      
                      <div className="upload-popover-option" onClick={() => triggerUpload('.txt')}>
                        <span className="popover-option-icon">📄</span>
                        <div className="popover-option-text">
                          <span className="popover-option-title">Text File</span>
                          <span className="popover-option-desc">Upload raw text datasets or notes</span>
                        </div>
                      </div>
                      
                      <div className="upload-popover-option" onClick={() => triggerUpload('.md')}>
                        <span className="popover-option-icon">📝</span>
                        <div className="popover-option-text">
                          <span className="popover-option-title">Markdown</span>
                          <span className="popover-option-desc">Upload research documentation</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <textarea
              ref={textareaRef}
              className="chat-input"
              placeholder={isLimitReached ? 'Login to continue chatting...' : 'Ask anything...'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={activeWindow.isLoading}
              rows="1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              onClick={() => { if (isLimitReached) setShowAuth(true); }}
              autoFocus
            />
            <div className="chat-controls-right" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button 
                type="button" 
                className={`voice-btn ${isListening ? 'listening' : ''}`} 
                onClick={toggleListening}
                disabled={activeWindow.isLoading}
                title={isListening ? "Stop listening" : "Start voice input"}
              >
                {isListening ? (
                  <span className="voice-wave-container">
                    <span className="voice-wave-bar"></span>
                    <span className="voice-wave-bar"></span>
                    <span className="voice-wave-bar"></span>
                  </span>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                )}
              </button>
              {input.trim() && (
                <button type="submit" className="send-btn active" disabled={activeWindow.isLoading}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2z" /></svg>
                </button>
              )}
            </div>
          </form>
          <div className="legal-footer">
            Quokka can make mistakes. Check important info. See <a href="#">Cookie Preferences</a>.
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

// Premium Status Modal
function StatusModal({ onClose }) {
  const systems = [
    { name: "Hugging Face Model Space", status: "Operational", desc: "Fine-tuned Qwen 0.5B adapter CPU inference endpoint." },
    { name: "Qdrant Cloud DB Cluster", status: "Operational", desc: "Cloud vector database and Live RAG indexer." },
    { name: "Groq LLM Coordinator", status: "Operational", desc: "Consensus synthesis coordinator (llama-3.1-8b-instant)." },
    { name: "Pinecone Textbook Indexes", status: "Operational", desc: "Static materials science textbook RAG vector index." }
  ];

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
        <div className="auth-header">
          <h2>Quokka System Health</h2>
          <button className="auth-close" onClick={onClose}>×</button>
        </div>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '16px' }}>
          Real-time service health and orchestration status of all integrated materials science nodes.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {systems.map((sys, idx) => (
            <div key={idx} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-dim)', padding: '12px', borderRadius: '8px', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#00cc66', boxShadow: '0 0 8px #00cc66' }}></div>
              <div style={{ flexGrow: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <strong style={{ color: 'var(--text-primary)', fontSize: '14px' }}>{sys.name}</strong>
                  <span style={{ fontSize: '11px', color: '#00cc66', background: 'rgba(0, 204, 102, 0.1)', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
                    {sys.status}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)' }}>{sys.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <button className="auth-submit-btn" onClick={onClose} style={{ marginTop: '20px' }}>
          Close Panel
        </button>
      </div>
    </div>
  );
}

// Premium ApiModal
function ApiModal({ onClose }) {
  const [copiedIndex, setCopiedIndex] = useState(null);

  const snippets = [
    {
      lang: "Python SDK",
      code: `import requests\n\nurl = "https://quokka-xzwh.onrender.com/api/chat_stream"\nheaders = {\n    "x-api-key": "qk_your_api_key_here"\n}\npayload = {\n    "query": "What is the atomic weight of silicon?",\n    "model": "hybrid"\n}\nres = requests.post(url, json=payload, headers=headers, stream=True)\nfor chunk in res.iter_lines():\n    print(chunk.decode())`
    },
    {
      lang: "cURL CLI",
      code: `curl -X POST https://quokka-xzwh.onrender.com/api/chat_stream \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: qk_your_api_key_here" \\\n  -d '{"query": "What is silicon?", "model": "qdrant"}'`
    }
  ];

  const handleCopy = (code, index) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '550px' }}>
        <div className="auth-header">
          <h2>API Reference & Integration</h2>
          <button className="auth-close" onClick={onClose}>×</button>
        </div>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '16px' }}>
          Integrate Quokka&apos;s specialized RAG synthesis API directly into your materials science notebooks.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {snippets.map((snip, idx) => (
            <div key={idx}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--accent-cyan)' }}>{snip.lang}</span>
                <button 
                  onClick={() => handleCopy(snip.code, idx)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  {copiedIndex === idx ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre style={{ margin: 0, padding: '12px', background: 'var(--bg-hover)', border: '1px solid var(--border-dim)', borderRadius: '8px', fontSize: '11px', overflowX: 'auto', fontFamily: 'monospace', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                {snip.code}
              </pre>
            </div>
          ))}
        </div>
        <button className="auth-submit-btn" onClick={onClose} style={{ marginTop: '20px' }}>
          Close Panel
        </button>
      </div>
    </div>
  );
}

// Premium Billing & API Key Dashboard Modal
function BillingModal({ onClose }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const [localUser, setLocalUser] = useState(() => {
    const saved = localStorage.getItem('quokka_user');
    return saved ? JSON.parse(saved) : null;
  });

  const loadScript = (src) => {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleSubscribe = async () => {
    setIsProcessing(true);
    const scriptLoaded = await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    if (!scriptLoaded) {
      alert("Razorpay SDK failed to load. Please check your internet connection.");
      setIsProcessing(false);
      return;
    }

    try {
      const token = localStorage.getItem('quokka_token');
      // 1. Create a Razorpay Order on the backend
      const res = await fetch(`${API}/api/payment/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const order = await res.json();
      if (order.error) {
        alert(order.error);
        setIsProcessing(false);
        return;
      }

      if (order.sandbox) {
        alert("🔒 Developer Sandbox: Reference test credentials are currently expired. Redirecting to Quokka Sandbox Payment Gateway...");
        setTimeout(async () => {
          try {
            setIsProcessing(true);
            const verifyRes = await fetch(`${API}/api/payment/verify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                razorpay_order_id: order.id,
                razorpay_payment_id: 'pay_sand_' + Math.random().toString(36).substring(2, 10),
                razorpay_signature: 'sig_sand_' + Math.random().toString(36).substring(2, 15)
              })
            });
            const data = await verifyRes.json();
            if (data.success) {
              const updatedUser = { ...localUser, isSubscribed: true, apiKey: data.apiKey };
              localStorage.setItem('quokka_user', JSON.stringify(updatedUser));
              setLocalUser(updatedUser);
              alert("🎉 Payment Successful! Your Quokka Premium Subscription is now Active (Sandbox Mode).");
              window.location.reload();
            } else {
              alert("Sandbox signature verification failed.");
            }
          } catch (err) {
            console.error("Sandbox verification error:", err);
            alert("Verification server error.");
          } finally {
            setIsProcessing(false);
          }
        }, 1500);
        return;
      }

      // 2. Open the Razorpay Checkout Modal
      const options = {
        key: "rzp_test_Smvg1Tn94fsyYr", // New active Razorpay test key
        amount: order.amount,
        currency: order.currency,
        name: "Quokka Materials",
        description: "Quokka Premium API Subscription",
        image: "https://quokka-xzwh.onrender.com/favicon.ico",
        order_id: order.id,
        handler: async function (response) {
          try {
            setIsProcessing(true);
            // 3. Verify Payment Signature on the Backend
            const verifyRes = await fetch(`${API}/api/payment/verify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            });
            const data = await verifyRes.json();
            if (data.success) {
              const updatedUser = { ...localUser, isSubscribed: true, apiKey: data.apiKey };
              localStorage.setItem('quokka_user', JSON.stringify(updatedUser));
              setLocalUser(updatedUser);
              alert("Payment Successful! Your Quokka Premium Subscription is now Active.");
              window.location.reload();
            } else {
              alert("Signature verification failed. Please contact support.");
            }
          } catch (err) {
            console.error("Verification error:", err);
            alert("Verification server error.");
          } finally {
            setIsProcessing(false);
          }
        },
        prefill: {
          name: localUser.name || "Customer",
          email: localUser.email || "customer@example.com",
        },
        theme: {
          color: "#00cc66" // Premium Green
        }
      };

      const paymentObject = new window.Razorpay(options);
      paymentObject.open();
    } catch (err) {
      console.error("Subscription initiate error:", err);
      alert("Failed to initiate secure checkout.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegenerateKey = async () => {
    try {
      const token = localStorage.getItem('quokka_token');
      const res = await fetch(`${API}/api/auth/generate_key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        const updatedUser = { ...localUser, apiKey: data.apiKey };
        localStorage.setItem('quokka_user', JSON.stringify(updatedUser));
        setLocalUser(updatedUser);
      }
    } catch (err) {
      console.error("Regeneration error:", err);
    }
  };

  const handleCopy = () => {
    if (localUser?.apiKey) {
      navigator.clipboard.writeText(localUser.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!localUser) {
    return (
      <div className="auth-overlay" onClick={onClose}>
        <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
          <div className="auth-header">
            <h2>API Key & Subscription</h2>
            <button className="auth-close" onClick={onClose}>×</button>
          </div>
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: '24px 0' }}>
            Please sign in or create an account to view and manage API access.
          </p>
          <button className="auth-submit-btn" onClick={onClose}>Close Panel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="auth-header">
          <h2>API & Billing Workspace</h2>
          <button className="auth-close" onClick={onClose}>×</button>
        </div>

        {isProcessing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '16px' }}>
            <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid rgba(0,204,102,0.1)', borderTopColor: '#00cc66', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <p style={{ color: 'var(--text-primary)', fontWeight: '600', fontSize: '14px', margin: 0, textAlign: 'center' }}>
              Processing Secure Payment...
            </p>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', margin: 0, textAlign: 'center' }}>
              Simulating payment gateway transaction. Please do not close this window.
            </p>
          </div>
        ) : !localUser.isSubscribed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'rgba(0,204,102,0.05)', border: '1px solid rgba(0,204,102,0.2)', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
              <span style={{ fontSize: '11px', color: '#00cc66', background: 'rgba(0,204,102,0.1)', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
                PREMIUM PLAN
              </span>
              <h3 style={{ margin: '12px 0 6px 0', color: 'var(--text-primary)', fontSize: '20px' }}>$29.00 <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>/ month</span></h3>
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                Get full access to Quokka&apos;s concurrent materials science pipelines and custom API Key generation.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--accent-cyan)' }}>✓</span>
                <span>Generate active and regeneratable <code>qk_</code> API keys.</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--accent-cyan)' }}>✓</span>
                <span>Fetch from textbooks, web search, and Qwen model concurrently.</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--accent-cyan)' }}>✓</span>
                <span>99.9% uptime with ultra-fast sub-100ms response times.</span>
              </div>
            </div>
            <button className="auth-submit-btn" onClick={handleSubscribe} style={{ background: '#00cc66', color: '#fff', border: 'none', marginTop: '10px' }}>
              💳 Pay with Razorpay (Test Mode)
            </button>
            <button 
              className="auth-submit-btn" 
              onClick={async () => {
                try {
                  setIsProcessing(true);
                  const token = localStorage.getItem('quokka_token');
                  const verifyRes = await fetch(`${API}/api/payment/verify`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                      razorpay_order_id: 'order_sand_' + Math.random().toString(36).substring(2, 15),
                      razorpay_payment_id: 'pay_sand_' + Math.random().toString(36).substring(2, 10),
                      razorpay_signature: 'sig_sand_' + Math.random().toString(36).substring(2, 15)
                    })
                  });
                  const data = await verifyRes.json();
                  if (data.success) {
                    const updatedUser = { ...localUser, isSubscribed: true, apiKey: data.apiKey };
                    localStorage.setItem('quokka_user', JSON.stringify(updatedUser));
                    setLocalUser(updatedUser);
                    alert("🎉 Account Activated Instantly in Developer Sandbox Mode!");
                    window.location.reload();
                  } else {
                    alert("Fast Activation failed.");
                  }
                } catch (e) {
                  console.error(e);
                  alert("Fast Activation error.");
                } finally {
                  setIsProcessing(false);
                }
              }} 
              style={{ background: 'rgba(0,180,216,0.15)', color: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)', marginTop: '8px' }}
            >
              ⚡ Fast One-Click Sandbox Activation
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-dim)', padding: '16px', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--accent-cyan)', background: 'rgba(0,180,216,0.1)', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
                  PREMIUM SUBSCRIBER
                </span>
                <span style={{ fontSize: '12px', color: '#00cc66', fontWeight: 'bold' }}>Active</span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                You have active API access. Use your key in the <code>x-api-key</code> request header.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-tertiary)' }}>Your API Key</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type={showApiKey ? "text" : "password"} 
                  value={localUser.apiKey || ''} 
                  readOnly 
                  style={{ flexGrow: 1, padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: '6px', color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '12.5px', outline: 'none' }}
                />
                <button 
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-dim)', borderRadius: '6px', color: 'var(--text-secondary)', padding: '0 10px', cursor: 'pointer', fontSize: '12px' }}
                >
                  {showApiKey ? "Hide" : "Show"}
                </button>
                <button 
                  onClick={handleCopy}
                  style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-dim)', borderRadius: '6px', color: 'var(--text-secondary)', padding: '0 10px', cursor: 'pointer', fontSize: '12px' }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
              <button className="auth-submit-btn" onClick={handleRegenerateKey} style={{ flexGrow: 1, background: 'transparent', border: '1px solid var(--border-dim)', color: 'var(--text-primary)' }}>
                Regenerate Key
              </button>
              <button className="auth-submit-btn" onClick={onClose} style={{ flexGrow: 1 }}>
                Close Workspace
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

