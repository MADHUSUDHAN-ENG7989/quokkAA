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


function App() {
  // Guard: show admin page full screen if requested
  const { user, token, isLimitReached, incrementQueryCount, logout } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [windows, setWindows] = useState(() => {
    const saved = localStorage.getItem('quokka_windows');
    return saved ? JSON.parse(saved) : [
      { id: '1', title: 'New Chat', messages: [], isLoading: false }
    ];
  });

  const [activeWindowId, setActiveWindowId] = useState(() => {
    const savedId = localStorage.getItem('quokka_active_window_id');
    // Ensure the saved ID actually exists in the current windows
    const saved = localStorage.getItem('quokka_windows');
    if (savedId && saved) {
      const parsed = JSON.parse(saved);
      if (parsed.some(w => w.id === savedId)) return savedId;
    }
    return windows[0]?.id || '1';
  });


  const [input, setInput] = useState('');
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const activeWindow = windows.find(w => w.id === activeWindowId) || windows[0];

  // Sync to LocalStorage whenever state changes
  useEffect(() => {
    localStorage.setItem('quokka_windows', JSON.stringify(windows.map(w => ({ ...w, isLoading: false }))));
    localStorage.setItem('quokka_active_window_id', activeWindowId);
  }, [windows, activeWindowId]);

  const scrollToBottom = (instant = false) => {
    if (shouldAutoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: instant ? "auto" : "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeWindow.messages, activeWindow.isLoading]);

  // Handle manual scroll to disable auto-scroll if user moves up
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShouldAutoScroll(isAtBottom);
  };

  const createNewWindow = () => {
    const newId = Date.now().toString();
    const newWindow = { id: newId, title: 'New Chat', messages: [], isLoading: false };
    setWindows(prev => [newWindow, ...prev]);
    setActiveWindowId(newId);
    setInput('');
  };

  const switchWindow = (id) => {
    setActiveWindowId(id);
    setInput('');
  };

  const closeWindow = (e, id) => {
    e.stopPropagation(); // Don't switch to tab when closing it

    setWindows(prev => {
      const remaining = prev.filter(w => w.id !== id);

      // If we closed the last tab, create a new fresh one immediately
      if (remaining.length === 0) {
        const newId = Date.now().toString();
        const newWindow = { id: newId, title: 'New Chat', messages: [], isLoading: false };
        setActiveWindowId(newId);
        return [newWindow];
      }

      // If we closed the active tab, switch to the first remaining one
      if (id === activeWindowId) {
        setActiveWindowId(remaining[0].id);
      }

      return remaining;
    });
  };

  const clearAllWindows = () => {
    if (window.confirm("Are you sure you want to clear all chat sessions? This cannot be undone.")) {
      const newId = Date.now().toString();
      const freshWindow = { id: newId, title: 'New Chat', messages: [], isLoading: false };
      setWindows([freshWindow]);
      setActiveWindowId(newId);
      localStorage.clear();
    }
  };

  const exportCurrentChat = () => {
    if (activeWindow.messages.length === 0) return;

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
    if (!input.trim() || activeWindow.isLoading) return;

    // Check free query limit
    if (isLimitReached) {
      setShowAuth(true);
      return;
    }

    const userQuery = input.trim();
    setInput('');

    // Update title if it's the first message
    const newTitle = activeWindow.messages.length === 0 ?
      (userQuery.length > 20 ? userQuery.substring(0, 20) + '...' : userQuery) :
      activeWindow.title;

    // Add user message to UI
    const updatedMessages = [...activeWindow.messages, { role: 'user', content: userQuery }];

    setWindows(prev => prev.map(w =>
      w.id === activeWindowId ? { ...w, messages: updatedMessages, isLoading: true, title: newTitle } : w
    ));

    // Increment query count for guests
    if (!user) incrementQueryCount();

    const payloadHistory = activeWindow.messages.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));


    try {
      const authHeaders = token
        ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        : { 'Content-Type': 'application/json' };

      const response = await fetch('http://localhost:8000/api/chat_stream', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ query: userQuery, history: payloadHistory }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      // Add empty assistant message that we will stream into
      setWindows(prev => prev.map(w => {
        if (w.id !== activeWindowId) return w;
        // Ensure we don't add a new assistant message if the last one is already an assistant message
        // (e.g., if the user spams submit before the first response comes back)
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
      let lineBuffer = ""; // Fix for partial lines! 🧩

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          const chunkStr = decoder.decode(value, { stream: true });
          lineBuffer += chunkStr;

          const lines = lineBuffer.split('\n');
          // Keep the last (potentially partial) line in the buffer
          lineBuffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              if (!dataStr) continue;

              try {
                const data = JSON.parse(dataStr);

                if (data.type === 'sources') {
                  setWindows(prev => prev.map(w => {
                    if (w.id !== activeWindowId) return w;
                    const newMsgs = [...w.messages];
                    const lastMsg = { ...newMsgs[newMsgs.length - 1] };
                    lastMsg.sources = data.sources;
                    newMsgs[newMsgs.length - 1] = lastMsg;
                    return { ...w, messages: newMsgs };
                  }));
                } else if (data.type === 'chunk') {
                  fullAssistantContent += data.content;
                  setWindows(prev => prev.map(w => {
                    if (w.id !== activeWindowId) return w;
                    const newMsgs = [...w.messages];
                    const lastMsg = { ...newMsgs[newMsgs.length - 1] };
                    lastMsg.content += data.content;
                    newMsgs[newMsgs.length - 1] = lastMsg;
                    return { ...w, messages: newMsgs };
                  }));
                }
              } catch (e) {
                console.error("Error parsing SSE data", e, dataStr);
              }
            }
          }
        }
      }

      // If it was the first user message, generate a title using Groq
      if (activeWindow.messages.length === 0) {
        try {
          const titleResponse = await fetch('http://localhost:8000/api/generate_title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: userQuery, response: fullAssistantContent })
          });
          const titleData = await titleResponse.json();
          if (titleData.title) {
            setWindows(prev => prev.map(w => w.id === activeWindowId ? { ...w, title: titleData.title } : w));
          }
        } catch (titleErr) {
          console.error("Error generating title:", titleErr);
        }
      }

    } catch (err) {
      console.error("Error querying the API:", err);
      setWindows(prev => prev.map(w => {
        if (w.id !== activeWindowId) return w;
        return {
          ...w,
          messages: [...w.messages, { role: 'assistant', content: "Failed to fetch response.", isError: true }]
        };
      }));
    } finally {
      updateActiveWindow({ isLoading: false });
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
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {/* Vertical Browser Sidebar */}
      <aside className="browser-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-actions">
            <button className="sidebar-action-icon" onClick={clearAllWindows} title="Clear All Sessions">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          </div>
        </div>
        <div className="window-tabs">
          {windows.map(win => (
            <div
              key={win.id}
              className={`window-tab ${win.id === activeWindowId ? 'active' : ''}`}
              onClick={() => switchWindow(win.id)}
            >
              <div className="tab-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
              </div>
              <span className="tab-title">{win.title}</span>
              <button className="close-tab-btn" onClick={(e) => closeWindow(e, win.id)} title="Close Tab">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          ))}
          <button className="new-window-btn" onClick={createNewWindow} title="New Window">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            <span className="btn-label">New Chat</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area (Active Window) */}
      <main className="main-content">
        <header className="main-header">
          <div className="header-brand">
            <span className="brand-name">Quokka</span>
          </div>
          <div className="header-actions">
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
            <div className="empty-state">
              <div className="empty-logo">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                <h1 className="hero-text">How can I help you today?</h1>
              </div>
            </div>
          ) : (
            <div className="messages-list">
              {activeWindow.messages.map((msg, index) => (
                <div key={index} className={`message-wrapper ${msg.role === 'user' ? 'user-wrapper' : 'assistant-wrapper'}`}>
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
                </div>
              ))}
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
