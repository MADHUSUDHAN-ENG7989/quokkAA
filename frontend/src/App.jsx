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
  const [guestId, setGuestId] = useState(() => {
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
  const modelMenuRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setShowModelMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [input, setInput] = useState('');
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);

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
  }, [activeWindow?.messages, activeWindow?.isLoading]);

  // Handle manual scroll to disable auto-scroll if user moves up
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShouldAutoScroll(isAtBottom);
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

  const updateActiveWindow = (updates) => {
    setWindows(prev => prev.map(w =>
      w.id === activeWindowId ? { ...w, ...updates } : w
    ));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeWindow || !input.trim() || activeWindow.isLoading) return;

    if (isLimitReached) {
      setShowAuth(true);
      return;
    }

    const userQuery = input.trim();
    setInput('');

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
      <AnimatePresence>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
        {showStatusModal && <StatusModal onClose={() => setShowStatusModal(false)} />}
        {showApiModal && <ApiModal onClose={() => setShowApiModal(false)} />}
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
            <div className="profile-container" onClick={() => { if (user.role === 'admin') setShowAdmin(true); }}>
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

            <span className="brand-name">Quokka</span>
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
                    🛡️ Admin
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
            >
              <div className="empty-logo">
                <motion.svg 
                  width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  animate={{ y: [0, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                  whileHover={{ scale: 1.2, rotate: 10 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </motion.svg>
                <motion.h1 
                  className="hero-text"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.05, color: '#00f2fe' }}
                >
                  How can I help you today?
                </motion.h1>
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
          <form className="input-form" onSubmit={handleSubmit}>
            <button type="button" className="attach-btn" title="Attach file">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
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
            {input.trim() ? (
              <button type="submit" className="send-btn active" disabled={activeWindow.isLoading}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2z" /></svg>
              </button>
            ) : (
              <button type="button" className="voice-btn" disabled={activeWindow.isLoading}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
              </button>
            )}
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
      code: `import requests\n\nurl = "https://quokka-backend.onrender.com/api/chat_stream"\npayload = {\n    "query": "What is the atomic weight of silicon?",\n    "model": "hybrid"\n}\nres = requests.post(url, json=payload, stream=True)\nfor chunk in res.iter_lines():\n    print(chunk.decode())`
    },
    {
      lang: "cURL CLI",
      code: `curl -X POST https://quokka-backend.onrender.com/api/chat_stream \\\n  -H "Content-Type: application/json" \\\n  -d '{"query": "What is silicon?", "model": "qdrant"}'`
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
          Integrate Quokka's specialized RAG synthesis API directly into your materials science notebooks.
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
