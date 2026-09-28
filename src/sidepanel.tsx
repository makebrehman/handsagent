import React, { useEffect, useRef, useState, Component } from "react"
import type { ErrorInfo, ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import "./sidepanel.css"
import { HandsLogo } from "./HandsLogo"
import { saveChat, getAllChats, deleteChat, getChat } from "./utils/db"
import type { ChatSession } from "./utils/db"

const CHAT_MODELS = [
  { id: "qwen/qwen3.8-max-0902", label: "Qwen 3.8 Max 0902" },
  { id: "meta-models/Muse-Glimmer-30B", label: "Muse Glimmer 30B" },
  { id: "MiniMaxAI/MiniMax-M3", label: "MiniMax M3" },
  { id: "Qwen/Qwen3.5-9B", label: "Qwen 3.5 9B" },
  { id: "moonshotai/Kimi-K3", label: "Kimi K3 (Experimental)" },
  { id: "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo", label: "Llama 3.2 90B Vision (Uncensored Default)" },
  { id: "zai-org/GLM-5.3-Flash", label: "GLM 5.3 Flash (Censored/Legacy)" }
]

interface ChatMessage {
  role: "user" | "assistant"
  text: string
  screenshot?: string
  images?: string[]
  isStreaming?: boolean
  isError?: boolean
  isMissingByokKey?: boolean
  milestones?: string[]
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

const MilestoneCheck = () => (
  <svg viewBox="0 0 24 24" style={{ width: '18px', height: '18px', minWidth: '18px', flexShrink: 0, marginTop: '2px' }}>
    <circle cx="12" cy="12" r="10" fill="#10a37f" />
    <path d="M8 12.5L11 15.5L16 9" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
)

const renderMilestones = (milestones: string[]) => {
  if (!milestones || milestones.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
      {milestones.map((m, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: 'var(--text)' }}>
          <MilestoneCheck />
          <span style={{ fontSize: '13.5px', lineHeight: '1.5' }}>{m}</span>
        </div>
      ))}
    </div>
  );
};

export default function SidePanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState("")
  const [msgCount, setMsgCount] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [useCustomProvider, setUseCustomProvider] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [customModel, setCustomModel] = useState("")
  const [savedSettings, setSavedSettings] = useState({
    apiKey: "",
    baseUrl: "",
    useCustomProvider: false,
    customModel: ""
  })
  const apiKeyInputRef = useRef<HTMLInputElement>(null)
  
  // Phase 4 State (Auth & Limits)
  const [authToken, setAuthToken] = useState("")
  const [userEmail, setUserEmail] = useState("")
  const [tokenLimit, setTokenLimit] = useState<{weekly: {used: number, max: number}, hourly: {used: number, max: number}, tier?: string} | null>(null)
  const [isRefreshingTokens, setIsRefreshingTokens] = useState(false)
  const isPro = tokenLimit?.tier === "pro" || (tokenLimit ? tokenLimit.weekly.max >= 4000000 : false)
  
  // Phase 3 State
  const [chatId, setChatId] = useState<string>(generateId())
  const [chats, setChats] = useState<ChatSession[]>([])
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [toasts, setToasts] = useState<{id: string, text: string, type: string}[]>([])
  const [approvalReq, setApprovalReq] = useState<any>(null)
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editChatTitle, setEditChatTitle] = useState("")

  // Streaming State (Active Buffer)
  const [activeStream, setActiveStream] = useState("")
  const [activeMilestones, setActiveMilestones] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamError, setStreamError] = useState(false)
  const [streamScreenshot, setStreamScreenshot] = useState<string | null>(null)
  const [activeTabUrl, setActiveTabUrl] = useState("")

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    loadChats()
    
    portRef.current = chrome.runtime.connect({ name: "hands-keepalive" })
    const heartbeat = setInterval(() => {
      portRef.current?.postMessage({ type: "ping" })
    }, 20000)

    // Listen for background events (approvals, errors)
    const handleMsg = (msg: any) => {
      if (msg.type === "REQUIRE_APPROVAL") {
        setApprovalReq(msg.payload)
      } else if (msg.type === "AGENT_ERROR") {
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
        setStreamError(true)
        setIsLoading(false)
        setIsStreaming(false)
        setStatus("Failed")
        chrome.storage.local.set({ streamDone: true, streamStatus: "Failed" })
        
        chrome.storage.local.get(["useCustomProvider", "streamActions"], (s) => {
          const isCustom = !!s.useCustomProvider;
          const isQuotaError = msg.error && (msg.error.includes("Limit Reached") || msg.error.includes("Burst Limit"));
          const isTrafficError = msg.error && (msg.error.includes("heavy traffic") || msg.error.includes("rate limits"));
          const errMsg = isCustom || isQuotaError || isTrafficError ? (msg.error || "Failed to communicate with AI provider") : "Hands Super model is currently experiencing heavy load or network issues. Please try again in a moment.";
          showToast(errMsg, "error");
          const finalMilestones = s.streamActions ? s.streamActions.filter((a: any) => a.user_update && a.user_update.trim().length > 0).map((a: any) => a.user_update.trim()) : [];
              setMessages(prev => [...prev, { 
                role: "assistant", 
                isError: true, 
                text: errMsg,
                screenshot: streamScreenshot || undefined,
                milestones: finalMilestones
              }]);
          setActiveMilestones([]);
        });
      }
    }
    chrome.runtime.onMessage.addListener(handleMsg)

    return () => {
      clearInterval(heartbeat)
      portRef.current?.disconnect()
      chrome.runtime.onMessage.removeListener(handleMsg)
    }
  }, [streamScreenshot])

  useEffect(() => {
    chrome.storage.local.get(["apiKey", "baseUrl", "useCustomProvider", "customModel", "authToken", "userEmail", "googleToken"], async (storage) => {
      if (storage.apiKey) setApiKey(storage.apiKey)
      if (storage.baseUrl) setBaseUrl(storage.baseUrl)
      if (storage.useCustomProvider !== undefined) setUseCustomProvider(storage.useCustomProvider)
      if (storage.customModel) setCustomModel(storage.customModel)
      setSavedSettings({
        apiKey: storage.apiKey || "",
        baseUrl: storage.baseUrl || "",
        useCustomProvider: storage.useCustomProvider !== undefined ? storage.useCustomProvider : false,
        customModel: storage.customModel || ""
      })
      if (storage.userEmail) setUserEmail(storage.userEmail)
      if (storage.authToken) {
        setAuthToken(storage.authToken)
        
        const targetBaseUrl = "https://bilinil.vercel.app";
        let initialTokens = { weekly: {used: 0, max: 1250000}, hourly: {used: 0, max: 500000} };
        chrome.runtime.sendMessage({ 
          type: "FETCH_TOKENS", 
          token: storage.authToken, 
          baseUrl: targetBaseUrl 
        }, (res) => {
          if (res?.success) {
            initialTokens = res.data;
            setTokenLimit(initialTokens);
          } else if (res?.error && res.error.includes("401")) {
            // Silently upgrade stale token to a fresh 30-day session
            chrome.identity.getAuthToken({ interactive: false }, (newGoogleToken) => {
              if (newGoogleToken) {
                chrome.runtime.sendMessage({
                  type: "CREATE_SESSION",
                  googleToken: newGoogleToken,
                  baseUrl: targetBaseUrl
                }, (sessRes) => {
                  if (sessRes?.success && sessRes.data?.sessionToken) {
                    const newSession = sessRes.data.sessionToken;
                    chrome.storage.local.set({ authToken: newSession, googleToken: newGoogleToken });
                    setAuthToken(newSession);
                    chrome.runtime.sendMessage({ type: "FETCH_TOKENS", token: newSession, baseUrl: targetBaseUrl }, (retryRes) => {
                      if (retryRes?.success) setTokenLimit(retryRes.data);
                    });
                  }
                });
              }
            });
          }
        });
      }
    })
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
      if (res?.messages && res.messages.length > 0) {
        setMessages(res.messages)
        setChatId(res.chatId || generateId())
      }
      setMsgCount(res?.messageCount || 1)
    })
    chrome.storage.local.set({ streamBuffer: "", streamDone: false, streamStatus: "", streamScreenshot: null, streamActions: [] })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, status, activeStream])

  // Save chat to DB whenever messages change
  useEffect(() => {
    if (messages.length === 0) return;
    
    getChat(chatId).then(existing => {
      let newUpdatedAt = existing ? existing.updatedAt : Date.now();
      if (!existing || existing.messages.length !== messages.length) {
        newUpdatedAt = Date.now();
      }
      saveChat({
        id: chatId,
        title: existing?.title || (messages[0].text.substring(0, 30) + "..."),
        updatedAt: newUpdatedAt,
        messages: messages
      }).then(() => loadChats())
    })
  }, [messages, chatId])

  async function loadChats() {
    const all = await getAllChats()
    // Ensure all loaded chats have no active streaming states
    const safeChats = all.map(c => ({
      ...c,
      messages: c.messages.map(m => ({ ...m, isStreaming: false }))
    }))
    setChats(safeChats)
  }

  function showToast(text: string, type: "error"|"success" = "success") {
    const id = generateId()
    const safeText = text && text.length > 160 ? text.substring(0, 160) + "..." : text
    setToasts(prev => [...prev, { id, text: safeText, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }

  function startPolling() {
    let lastBuffer = ""

    pollingRef.current = setInterval(async () => {
      const result = await chrome.storage.local.get(["streamBuffer", "streamDone", "streamStatus", "streamScreenshot", "streamActions"])

      if (result.streamStatus) setStatus(result.streamStatus)

      if (result.streamBuffer !== undefined && result.streamBuffer !== lastBuffer) {
        lastBuffer = result.streamBuffer
        setActiveStream(result.streamBuffer)
      }

      if (result.streamActions && Array.isArray(result.streamActions)) {
         const miles = result.streamActions
             .filter(a => a.user_update && a.user_update.trim().length > 0)
             .map(a => a.user_update.trim());
         setActiveMilestones(miles);
      }

      if (result.streamScreenshot) {
        chrome.storage.local.set({ streamScreenshot: null })
        setStreamScreenshot(result.streamScreenshot)
      }

      if (result.streamDone) {
        clearInterval(pollingRef.current!)
        pollingRef.current = null
        setIsLoading(false)
        setIsStreaming(false)

        if (result.streamStatus === "Failed") {
          setStatus("Failed")
          setStreamError(true)
          chrome.storage.local.set({ streamDone: true, streamStatus: "Failed" })
          
          chrome.storage.local.get(["useCustomProvider"], (s) => {
            const isCustom = !!s.useCustomProvider;
            const isQuotaError = result.streamBuffer && (result.streamBuffer.includes("Limit Reached") || result.streamBuffer.includes("Burst Limit"));
            const isTrafficError = result.streamBuffer && (result.streamBuffer.includes("heavy traffic") || result.streamBuffer.includes("rate limits"));
            const errMsg = isCustom || isQuotaError || isTrafficError ? (result.streamBuffer || "Failed to communicate with AI provider") : "Hands Super model is currently experiencing heavy load or network issues. Please try again in a moment.";
            const finalMilestones = result.streamActions ? result.streamActions.filter((a: any) => a.user_update && a.user_update.trim().length > 0).map((a: any) => a.user_update.trim()) : [];
            setMessages(prev => [...prev, { 
              role: "assistant", 
              isError: true, 
              text: errMsg,
              screenshot: streamScreenshot || undefined,
              milestones: finalMilestones
            }]);
            setActiveMilestones([]);
          })
          return
        }

        setStatus("")
        chrome.storage.local.set({ streamBuffer: "", streamDone: false, streamStatus: "", streamScreenshot: null, streamActions: [] })
        
        let clean = result.streamBuffer || lastBuffer
        if (clean) {
          clean = clean.replace(/```json\s*[\s\S]*?```/g, "").replace(/ACTION:\s*\{[\s\S]*?\}(?:\n|$)/g, "").replace(/<tool>[\s\S]*?<\/tool>/g, "").replace(/\{\s*"action"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[^}]*\}\s*\}/g, "").trim();
          const openBrace = clean.lastIndexOf("{");
          if (openBrace !== -1 && clean.indexOf("}", openBrace) === -1) {
            clean = clean.substring(0, openBrace).trim();
          }
        }
        
        const finalMilestones = result.streamActions ? result.streamActions.filter(a => a.user_update && a.user_update.trim().length > 0).map(a => a.user_update.trim()) : [];
        
        if (clean.length > 0 || streamScreenshot || finalMilestones.length > 0) {
            setMessages(prev => [...prev, { 
                role: "assistant", 
                text: clean,
                screenshot: streamScreenshot || undefined,
                milestones: finalMilestones
            }])
        }
        setActiveMilestones([])
      }
    }, 100)
  }

  function sendMessage() {
    if (!input.trim() && selectedImages.length === 0) return

    const text = input
    const imagesToSend = [...selectedImages]
    setInput("")
    setSelectedImages([])
    setIsLoading(true)
    setStatus("Thinking...")
    
    // Reset stream states
    setActiveStream("")
    setIsStreaming(true)
    setStreamError(false)
    setStreamScreenshot(null)

    const isMissingByokKey = useCustomProvider && (!apiKey || !apiKey.trim());
    const isNotAuthenticated = !authToken && !useCustomProvider;

    if (isMissingByokKey || isNotAuthenticated) {
      setInput("");
      setSelectedImages([]);
      setIsLoading(false);
      setStatus("");
      setIsStreaming(false);
      const newMessages: ChatMessage[] = [
        ...messages,
        { role: "user", text, images: imagesToSend },
        {
          role: "assistant",
          isError: true,
          isMissingByokKey: true,
          text: "MISSING_BYOK_KEY"
        }
      ];
      setMessages(newMessages);
      return;
    }

    const newMessages = [...messages, { role: "user" as const, text, images: imagesToSend }]
    setMessages(newMessages)
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) setActiveTabUrl(tabs[0].url);
    });

    chrome.storage.local.set({ streamBuffer: "", streamDone: false, streamStatus: "", streamScreenshot: null, streamActions: [] }, () => {
      const taskId = generateId()
      chrome.runtime.sendMessage({ type: "CHAT", text, images: imagesToSend, chatId, taskId })
      startPolling()
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const processImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let { width, height } = img;
          const MAX_DIM = 800;

          if (width > height && width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          } else if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(img, 0, 0, width, height);
          
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    
    const maxFiles = Math.min(files.length, 5 - selectedImages.length);
    if (maxFiles <= 0) return;

    setIsLoading(true);
    const newImages = await Promise.all(
      Array.from(files).slice(0, maxFiles).map(f => processImage(f))
    );
    setSelectedImages(prev => [...prev, ...newImages]);
    setIsLoading(false);
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    
    if (imageFiles.length > 0) {
      const maxFiles = Math.min(imageFiles.length, 5 - selectedImages.length);
      if (maxFiles <= 0) return;
      
      setIsLoading(true);
      const newImages = await Promise.all(
        imageFiles.slice(0, maxFiles).map(f => processImage(f))
      );
      setSelectedImages(prev => [...prev, ...newImages]);
      setIsLoading(false);
    }
  }

  function removeImage(index: number) {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  }

  function stopAgent() {
    chrome.runtime.sendMessage({ type: "STOP" })
    setIsLoading(false)
    setStatus("")
    setIsStreaming(false)
    setActiveStream("")
    setStreamError(false)
    setStreamScreenshot(null)
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  function clearHistory() {
    chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" }, () => {
      setMessages([])
      setMsgCount(1)
      setChatId(generateId())
      setIsStreaming(false)
      setActiveStream("")
      setStreamError(false)
      setStreamScreenshot(null)
    })
  }

  const signIn = () => {
    console.log("signIn clicked");
    showToast("Starting Google Sign-In...", "success");

    const onGoogleTokenReceived = (googleToken: string) => {
      chrome.runtime.sendMessage({ type: "FETCH_USER_INFO", token: googleToken }, (infoRes) => {
        const email = infoRes?.success ? (infoRes.data?.email || "") : "";
        const targetBaseUrl = "https://bilinil.vercel.app";

        // Exchange Google access token for 30-day Hands Session JWT
        chrome.runtime.sendMessage({
          type: "CREATE_SESSION",
          googleToken,
          baseUrl: targetBaseUrl
        }, (sessionRes) => {
          const sessionToken = (sessionRes?.success && sessionRes.data?.sessionToken) 
            ? sessionRes.data.sessionToken 
            : googleToken;
          const tier = sessionRes?.data?.tier || "free";

          chrome.runtime.sendMessage({ type: "FETCH_TOKENS", token: sessionToken, baseUrl: targetBaseUrl }, (tRes) => {
            let initialTokens = { 
              tier,
              weekly: { used: 0, max: tier === "pro" ? 5000000 : 500000 }, 
              hourly: { used: 0, max: tier === "pro" ? 500000 : 150000 } 
            };
            if (tRes?.success) initialTokens = tRes.data;

            chrome.storage.local.set({ 
              authToken: sessionToken, 
              googleToken: googleToken, 
              userEmail: email 
            }, () => {
              setAuthToken(sessionToken);
              setUserEmail(email);
              setTokenLimit(initialTokens);
              showToast("Successfully signed in!", "success");
            });
          });
        });
      });
    };

    const webClientId = "937512875224-dcr7l32cmpbplg3gd0grtk410v5i6h0p.apps.googleusercontent.com";
    const redirectUri = chrome.identity.getRedirectURL();
    const scopes = encodeURIComponent("https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile");
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${webClientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&prompt=select_account`;

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectResponse) => {
      if (chrome.runtime.lastError || !redirectResponse) {
        console.error("WebAuthFlow error:", chrome.runtime.lastError);
        const errMsg = chrome.runtime.lastError?.message || "";
        if (errMsg.includes("User cancelled") || errMsg.includes("closed")) {
          showToast("Sign-in cancelled", "error");
          return;
        }
        showToast("Sign-in error: " + (errMsg || "Unknown error"), "error");
        return;
      }

      const m = redirectResponse.match(/[#&]access_token=([^&]+)/);
      if (m && m[1]) {
        onGoogleTokenReceived(m[1]);
      } else {
        showToast("Failed to retrieve access token", "error");
      }
    });
  };

  const refreshTokens = async () => {
    setIsRefreshingTokens(true);
    const targetBaseUrl = "https://bilinil.vercel.app";
    chrome.runtime.sendMessage({ type: "FETCH_TOKENS", token: authToken, baseUrl: targetBaseUrl }, (res) => {
      if (res?.success) {
        setTokenLimit(res.data);
        showToast("Usage allowance refreshed", "success");
        setIsRefreshingTokens(false);
      } else if (res?.error && res.error.includes("401")) {
        // Silently attempt background renewal
        console.log("Token 401, attempting silent background renewal...");
        chrome.identity.getAuthToken({ interactive: false }, (newGoogleToken) => {
          if (newGoogleToken) {
            chrome.runtime.sendMessage({
              type: "CREATE_SESSION",
              googleToken: newGoogleToken,
              baseUrl: targetBaseUrl
            }, (sessRes) => {
              if (sessRes?.success && sessRes.data?.sessionToken) {
                const newSession = sessRes.data.sessionToken;
                chrome.storage.local.set({ authToken: newSession, googleToken: newGoogleToken });
                setAuthToken(newSession);
                chrome.runtime.sendMessage({ type: "FETCH_TOKENS", token: newSession, baseUrl: targetBaseUrl }, (retryRes) => {
                  if (retryRes?.success) {
                    setTokenLimit(retryRes.data);
                    showToast("Usage allowance refreshed", "success");
                  } else {
                    showToast("Session expired. Please sign in again.", "error");
                  }
                  setIsRefreshingTokens(false);
                });
                return;
              }
              showToast("Session expired. Please sign in again.", "error");
              setIsRefreshingTokens(false);
            });
          } else {
            showToast("Session expired. Please sign in again.", "error");
            setIsRefreshingTokens(false);
          }
        });
      } else {
        showToast("Failed to refresh allowance: " + (res?.error || "Unknown error"), "error");
        setIsRefreshingTokens(false);
      }
    });
  };

  const signOut = () => {
    chrome.storage.local.get(["authToken", "googleToken"], (storage) => {
      const gToken = storage.googleToken;
      const sToken = storage.authToken;

      // 1. Revoke the Google token at Google OAuth servers so Google forgets consent & prompts next time
      if (gToken) {
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${gToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        }).catch(() => {});

        chrome.identity.removeCachedAuthToken({ token: gToken }, () => {});
      }
      if (sToken) {
        chrome.identity.removeCachedAuthToken({ token: sToken }, () => {});
      }

      // 2. Clear all cached tokens from Chrome's identity API if supported
      if ((chrome.identity as any)?.clearAllCachedAuthTokens) {
        try {
          (chrome.identity as any).clearAllCachedAuthTokens(() => {});
        } catch {}
      }

      // 3. Clear local storage
      chrome.storage.local.remove(["authToken", "googleToken", "userEmail"], () => {
        setAuthToken("");
        setUserEmail("");
        setTokenLimit(null);
        showToast("Signed out successfully", "success");
      });
    });
  };

  function loadPastChat(c: ChatSession) {
    chrome.runtime.sendMessage({ type: "LOAD_CHAT", messages: c.messages, chatId: c.id }, () => {
      setMessages(c.messages)
      setChatId(c.id)
      setIsSidebarOpen(false)
      setIsStreaming(false)
      setActiveStream("")
      setStreamError(false)
      setStreamScreenshot(null)
    })
  }

  function handleApproval(approved: boolean) {
    chrome.runtime.sendMessage({ type: "APPROVAL_RESPONSE", approved })
    setApprovalReq(null)
  }

  function retryLast() {
    setIsLoading(true)
    setStatus("Retrying...")
    setActiveStream("")
    setIsStreaming(true)
    setStreamError(false)
    setStreamScreenshot(null)
    setMessages(prev => {
      const copy = [...prev]
      if (copy.length > 0 && copy[copy.length - 1].role === "assistant") {
        copy.pop()
      }
      return copy
    })
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) setActiveTabUrl(tabs[0].url);
    });

    chrome.storage.local.set({ streamBuffer: "", streamDone: false, streamStatus: "", streamScreenshot: null, streamActions: [] }, () => {
      const taskId = generateId()
      chrome.runtime.sendMessage({ type: "RETRY_CHAT", taskId })
      startPolling()
    });
  }

  return (
    <div className="hands-root">
      {/* Modals & Overlays */}
      {approvalReq && (
        <div className="hands-modal-overlay">
          <div className="hands-modal">
            <div className="hands-modal-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0000FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span>Approval Required</span>
            </div>
            <div className="hands-modal-desc">
              The agent wants to perform a sensitive action:
              <div style={{ marginTop: '10px', padding: '10px', background: 'var(--bg-3)', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '12.5px' }}>
                <div style={{ marginBottom: '4px' }}><strong style={{ color: 'var(--text)' }}>Action:</strong> <span style={{ color: '#80aaff' }}>{approvalReq.action}</span></div>
                <div><strong style={{ color: 'var(--text)' }}>Reason:</strong> {approvalReq.reason}</div>
              </div>
            </div>
            <div className="hands-modal-actions">
              <button className="hands-btn-secondary" onClick={() => handleApproval(false)}>Deny</button>
              <button className="hands-btn-primary" onClick={() => handleApproval(true)}>Approve</button>
            </div>
          </div>
        </div>
      )}

      <div className="hands-toasts">
        {toasts.map(t => (
          <div key={t.id} className={`hands-toast ${t.type === 'error' ? 'hands-toast-error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>

      <div className={`hands-sidebar ${isSidebarOpen ? 'hands-sidebar-open' : ''}`}>
        <div className="hands-sidebar-header">
          <span>Recent Chats</span>
          <button className="hands-icon-btn" onClick={() => setIsSidebarOpen(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div className="hands-sidebar-list">
          {chats.map(c => (
            <div key={c.id} className={`hands-chat-item ${c.id === chatId ? 'hands-chat-item-active' : ''}`} onClick={() => { if (editingChatId !== c.id) loadPastChat(c); }}>
              {editingChatId === c.id ? (
                <div style={{ display: 'flex', width: '100%', gap: '4px', alignItems: 'center' }}>
                  <input 
                    autoFocus
                    value={editChatTitle}
                    onChange={(e) => setEditChatTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        saveChat({ ...c, title: editChatTitle }).then(() => { setEditingChatId(null); loadChats(); });
                      } else if (e.key === 'Escape') {
                        setEditingChatId(null);
                      }
                    }}
                    style={{ flex: 1, minWidth: 0, padding: '2px 4px', background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px' }} 
                  />
                  <button className="hands-icon-btn" style={{ padding: '4px' }} onClick={(e) => { e.stopPropagation(); saveChat({ ...c, title: editChatTitle }).then(() => { setEditingChatId(null); loadChats(); }); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </button>
                  <button className="hands-icon-btn" style={{ padding: '4px' }} onClick={(e) => { e.stopPropagation(); setEditingChatId(null); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              ) : (
                <>
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button className="hands-chat-item-del" title="Rename" style={{ color: 'var(--text-muted)' }} onClick={(e) => { e.stopPropagation(); setEditingChatId(c.id); setEditChatTitle(c.title || ""); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button className="hands-chat-item-del" title="Delete" onClick={(e) => { e.stopPropagation(); if(window.confirm("Are you sure you want to delete this chat?")) { deleteChat(c.id).then(()=>loadChats()) } }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="hands-header">
        <div className="hands-logo" style={{ cursor: 'pointer', gap: '0px' }} onClick={() => setIsSidebarOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          <HandsLogo animated={false} className="hands-header-logo" style={{ width: '22px', height: '22px', marginLeft: '10px' }} />
          <span className="hands-logo-name" style={{ marginLeft: '3px' }}>Hands</span>
        </div>
        <div className="hands-header-actions">
          <button
            className="hands-clear-btn"
            title="New Chat"
            onClick={clearHistory}>
            New Chat
          </button>
          <button
            className="hands-icon-btn"
            title="Settings"
            onClick={() => setShowSettings((v) => !v)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        </div>
      </div>

        {showSettings && (
          <div className="hands-settings" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontWeight: 'bold' }}>Use Custom Provider</label>
              <label className="hands-switch">
                <input type="checkbox" checked={useCustomProvider} onChange={(e) => setUseCustomProvider(e.target.checked)} />
                <span className="hands-slider"></span>
              </label>
            </div>

            {useCustomProvider ? (
              <>
                <div className="hands-setting-group">
                  <label>Custom API Key (BYOK)</label>
                  <input 
                    ref={apiKeyInputRef}
                    type="password" 
                    value={apiKey} 
                    onChange={(e) => setApiKey(e.target.value)} 
                    placeholder="Enter your API Key" 
                    style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)' }} 
                  />
                </div>

                <div className="hands-setting-group">
                  <label>Custom Base URL</label>
                  <input 
                    type="text" 
                    value={baseUrl} 
                    onChange={(e) => setBaseUrl(e.target.value)} 
                    placeholder="e.g. https://api.groq.com/openai/v1/chat/completions" 
                    style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)' }} 
                  />
                </div>
                
                <div className="hands-setting-group">
                  <label>Custom Model ID</label>
                  <input 
                    type="text" 
                    value={customModel} 
                    onChange={(e) => setCustomModel(e.target.value)} 
                    placeholder="e.g. llama3-70b-8192" 
                    style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)' }} 
                  />
                </div>
              </>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'var(--bg-2)', borderRadius: '6px', fontSize: '13px', color: 'var(--text)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                    <div>
                      {authToken ? (
                        <>Currently using <strong>Hands Super Model</strong></>
                      ) : (
                        <>Sign in with Google to use the <strong>Hands Super Model</strong></>
                      )}
                    </div>
                    {authToken && userEmail && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ background: 'var(--bg-4)', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', color: 'var(--text-dim)' }}>
                          {userEmail}
                        </div>
                        {isPro ? (
                          <span style={{ background: '#10b981', color: '#ffffff', padding: '1px 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                            PRO
                          </span>
                        ) : (
                          <span style={{ background: 'var(--bg-4)', color: 'var(--text-muted)', padding: '1px 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                            FREE
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {authToken ? (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                        
                        {(() => {
                          const weeklyConsumedPct = tokenLimit && tokenLimit.weekly.max > 0
                            ? Math.max(0, Math.min(100, Math.round((tokenLimit.weekly.used / tokenLimit.weekly.max) * 100)))
                            : 0;
                          const hourlyConsumedPct = tokenLimit && tokenLimit.hourly.max > 0
                            ? Math.max(0, Math.min(100, Math.round((tokenLimit.hourly.used / tokenLimit.hourly.max) * 100)))
                            : 0;

                          const getConsumedColor = (pct: number) => {
                            if (pct >= 100) return '#ef4444';
                            if (pct >= 80) return '#f59e0b';
                            return '#0000FF';
                          };

                          const getConsumedTextColor = (pct: number) => {
                            if (pct >= 100) return '#ef4444';
                            if (pct >= 80) return '#f59e0b';
                            return 'var(--text)';
                          };

                          return (
                            <>
                              {/* Weekly Usage */}
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Weekly Usage</span>
                                    <button 
                                      onClick={refreshTokens} 
                                      disabled={isRefreshingTokens}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                      title="Refresh usage"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: isRefreshingTokens ? 'spin 1s linear infinite' : 'none' }}>
                                        <polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                                      </svg>
                                    </button>
                                  </div>
                                  <strong style={{ color: getConsumedTextColor(weeklyConsumedPct) }}>
                                    {tokenLimit ? `${weeklyConsumedPct}% consumed` : 'Loading...'}
                                  </strong>
                                </div>
                                {tokenLimit && (
                                  <div style={{ width: '100%', height: '4px', background: 'var(--bg-4)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${weeklyConsumedPct}%`, height: '100%', background: getConsumedColor(weeklyConsumedPct), borderRadius: '2px', transition: 'width 0.4s ease' }} />
                                  </div>
                                )}
                              </div>

                              {/* Hourly Burst */}
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>Hourly Burst</span>
                                  <strong style={{ color: getConsumedTextColor(hourlyConsumedPct) }}>
                                    {tokenLimit ? `${hourlyConsumedPct}% consumed` : 'Loading...'}
                                  </strong>
                                </div>
                                {tokenLimit && (
                                  <div style={{ width: '100%', height: '4px', background: 'var(--bg-4)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${hourlyConsumedPct}%`, height: '100%', background: getConsumedColor(hourlyConsumedPct), borderRadius: '2px', transition: 'width 0.4s ease' }} />
                                  </div>
                                )}
                              </div>

                              {tokenLimit && (tokenLimit.weekly.used >= tokenLimit.weekly.max || tokenLimit.hourly.used >= tokenLimit.hourly.max) && (
                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px', lineHeight: 1.4 }}>
                                  {isPro 
                                    ? "Hourly burst capacity reached. Please wait a moment for it to replenish, or switch to BYOK." 
                                    : "Weekly allowance reached. Upgrade to Pro for 5x capacity or switch to BYOK anytime."}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        {!isPro ? (
                          <a 
                            href="https://gumroad.com/l/pdjyh?wanted=true"
                            target="_blank"
                            rel="noreferrer"
                            className="hands-upgrade-btn"
                            style={{ 
                              flex: 1, 
                              padding: '7px 12px', 
                              background: 'linear-gradient(135deg, #0061ff 0%, #60efff 100%)', 
                              color: '#ffffff', 
                              border: 'none', 
                              borderRadius: '6px', 
                              cursor: 'pointer', 
                              textDecoration: 'none', 
                              textAlign: 'center', 
                              fontWeight: 600,
                              fontSize: '12.5px',
                              letterSpacing: '0.01em',
                              boxShadow: '0 2px 10px rgba(0, 97, 255, 0.35)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              textShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
                              transition: 'transform 0.15s, box-shadow 0.15s'
                            }}>
                            Upgrade
                          </a>
                        ) : (
                          <a 
                            href="https://app.gumroad.com/library"
                            target="_blank"
                            rel="noreferrer"
                            className="hands-manage-sub-btn"
                            style={{ 
                              flex: 1, 
                              padding: '7px 12px', 
                              background: 'rgba(255, 255, 255, 0.08)', 
                              color: 'var(--text)', 
                              border: '1px solid var(--border)', 
                              borderRadius: '6px', 
                              cursor: 'pointer', 
                              textDecoration: 'none', 
                              textAlign: 'center', 
                              fontWeight: 500,
                              fontSize: '12px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'background 0.15s, border-color 0.15s'
                            }}>
                            Manage / Cancel
                          </a>
                        )}
                        <button 
                          onClick={signOut}
                          style={{ flex: 1, padding: '6px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text)', cursor: 'pointer' }}>
                          Sign Out
                        </button>
                      </div>
                    </>
                  ) : (
                    <button 
                      onClick={signIn}
                      className="hands-btn-primary"
                      style={{ marginTop: '8px', padding: '8px' }}>
                      Sign in with Google
                    </button>
                  )}
                </div>
            )}
            
            {(() => {
              const hasSettingsChanged = 
                apiKey !== savedSettings.apiKey ||
                baseUrl !== savedSettings.baseUrl ||
                useCustomProvider !== savedSettings.useCustomProvider ||
                customModel !== savedSettings.customModel;

              return (
                <button 
                  onClick={() => {
                    if (!hasSettingsChanged) return;
                    chrome.storage.local.set({ apiKey, baseUrl, useCustomProvider, customModel }, () => {
                      setSavedSettings({ apiKey, baseUrl, useCustomProvider, customModel });
                      showToast("Settings saved securely", "success");
                    });
                  }}
                  disabled={!hasSettingsChanged}
                  className={hasSettingsChanged ? "hands-btn-primary" : "hands-btn-secondary"}
                  style={{ 
                    width: '100%', 
                    marginTop: '4px',
                    padding: '10px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: hasSettingsChanged ? 'pointer' : 'not-allowed',
                    background: hasSettingsChanged ? '#0000FF' : 'var(--bg-3)',
                    color: hasSettingsChanged ? '#ffffff' : 'var(--text-muted)',
                    border: hasSettingsChanged ? 'none' : '1px solid var(--border)',
                    opacity: hasSettingsChanged ? 1 : 0.5,
                    boxShadow: hasSettingsChanged ? '0 2px 8px rgba(0, 0, 255, 0.35)' : 'none',
                    transition: 'all 0.2s ease'
                  }}>
                  {hasSettingsChanged ? "Save Settings" : "Saved"}
                </button>
              );
            })()}
          </div>
        )}

      {(!authToken && !useCustomProvider) ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '20px', padding: '20px', flex: 1 }}>
          <HandsLogo animated={false} style={{ width: '64px', height: '64px' }} />
          <h2 style={{ fontSize: '20px', margin: 0, fontWeight: 600 }}>Welcome to Hands</h2>
          <div style={{ textAlign: 'center', width: '100%', margin: 0, padding: 0 }}>
            <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'nowrap' }}>
              Use Hands Super Model for the best Execution
            </p>
            <p style={{ margin: '6px 0 0', color: 'var(--text-dim)', fontSize: '11.5px', lineHeight: 1.4, whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
              Have your own API key? Switch back to the BYOK anytime.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', marginTop: '20px' }}>
            <button 
              className="hands-btn-primary" 
              onClick={signIn}
              style={{ width: '100%', padding: '12px', fontSize: '13.5px' }}>
              Continue with Google (Hands Super Model)
            </button>
            <button 
              className="hands-btn-secondary" 
              onClick={() => {
                setUseCustomProvider(true);
                setShowSettings(true);
                chrome.storage.local.set({ useCustomProvider: true });
                setTimeout(() => apiKeyInputRef.current?.focus(), 150);
              }}
              style={{ width: '100%', padding: '12px', fontSize: '14px', backgroundColor: 'transparent', color: 'var(--text)', border: '1px solid var(--border)' }}>
              Continue with BYOK
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="hands-messages">
            {messages.length === 0 && !isLoading && (
              <div className="hands-empty">
                <div className="hands-empty-icon" style={{ marginBottom: '16px' }}>
                  <HandsLogo animated={true} className="hands-empty-logo" />
                </div>
                <div style={{ color: 'var(--text-dim)' }}>How can I help you today?</div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`hands-msg hands-msg-${msg.role}`}>
                <div className="hands-msg-bubble">
                  {msg.role === "assistant" && (
                    <div style={{ marginBottom: (msg.text || msg.isError) ? "8px" : "0", display: "flex", alignItems: "center", gap: "8px" }}>
                      <HandsLogo animated={false} />
                      {msg.isError && (
                        <span className="hands-failed-badge">
                          <span className="hands-failed-dot" />
                          <span>Failed</span>
                        </span>
                      )}
                    </div>
                  )}
                  {msg.images && msg.images.length > 0 && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      {msg.images.map((img, idx) => (
                        <img key={idx} src={img} style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '4px' }} alt="User Context" />
                      ))}
                    </div>
                  )}
                  {msg.isError ? (
                    (msg.isMissingByokKey || msg.text?.includes("MISSING_BYOK_KEY") || (useCustomProvider && (!apiKey || !apiKey.trim()))) ? (
                      <div className="hands-missing-key-card" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        background: 'var(--bg-2)',
                        border: '1px solid rgba(0, 0, 255, 0.35)',
                        borderTop: '2px solid #0000FF',
                        borderRadius: 'var(--radius)',
                        padding: '16px',
                        marginTop: '6px',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5), 0 0 16px rgba(0, 0, 255, 0.15)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ffb703', fontWeight: 600, fontSize: '13px' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                          <span>Can't find BYOK API Key</span>
                        </div>
                        <div style={{ color: 'var(--text-dim)', fontSize: '12.5px', lineHeight: 1.5 }}>
                          You haven't configured a custom API key yet. Connect with Google to use the Hands Super Model, or add your BYOK key in Settings.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                          <button 
                            className="hands-btn-primary" 
                            onClick={signIn}
                            style={{ 
                              width: '100%', 
                              padding: '10px 12px', 
                              fontSize: '13px', 
                              background: '#0000FF',
                              color: '#ffffff',
                              border: 'none',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer'
                            }}>
                            Continue with Google (Hands Super Model)
                          </button>
                          <button 
                            className="hands-btn-secondary" 
                            onClick={() => {
                              setShowSettings(true);
                              setTimeout(() => apiKeyInputRef.current?.focus(), 150);
                            }}
                            style={{ 
                              width: '100%', 
                              padding: '9px 12px', 
                              fontSize: '12.5px', 
                              background: 'var(--bg-3)', 
                              color: 'var(--text)', 
                              border: '1px solid var(--border)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              cursor: 'pointer'
                            }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                            <span>Enter BYOK Key</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="hands-error-banner">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                          <span>{msg.text || "An unexpected error occurred with the AI provider."}</span>
                        </div>
                        <button className="hands-retry-btn" onClick={retryLast}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> Retry
                        </button>
                      </>
                    )
                  ) : (
                    <>
                      {msg.milestones && msg.milestones.length > 0 && renderMilestones(msg.milestones)}
                      {msg.text ? <MessageContent text={msg.text} /> : null}
                    </>
                  )}
                </div>
              </div>
            ))}

            {(isStreaming || (streamError && activeStream)) && (
              <div className="hands-msg hands-msg-assistant">
                <div className="hands-msg-bubble">
                  <div style={{ marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <HandsLogo animated={true} />
                    {activeTabUrl && (
                      <img src={`chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(activeTabUrl)}&size=32`} style={{ width: '16px', height: '16px', borderRadius: '2px', opacity: 0.9 }} title="Active Tab Context" alt="" />
                    )}
                    <span className="hands-thinking-indicator">
                      <span className="hands-status-dot" />
                      <span>{status || "Thinking..."}</span>
                    </span>
                  </div>
                  {activeMilestones && activeMilestones.length > 0 && renderMilestones(activeMilestones)}
                  {activeStream ? <MessageContent text={activeStream} /> : null}
                </div>
              </div>
            )}
            
            <div ref={bottomRef} />
          </div>

          <div className="hands-input-area" style={{ flexDirection: 'column', gap: '8px' }}>
            {selectedImages.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {selectedImages.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative' }}>
                    <img src={img} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border)' }} />
                    <button 
                      onClick={() => removeImage(idx)}
                      className="hands-img-remove-btn"
                      title="Remove image">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <button 
                className="hands-icon-btn" 
                onClick={() => fileInputRef.current?.click()}
                title="Upload Image"
                disabled={selectedImages.length >= 5 || isLoading}
                style={{ alignSelf: 'flex-end', padding: '12px 8px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="image/png, image/jpeg, image/webp, image/gif" 
                multiple 
                style={{ display: 'none' }} 
              />
              <textarea
                ref={inputRef}
                className="hands-input"
                placeholder="Tell Hands what to do..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                rows={1}
              />
              {isLoading ? (
                <button 
                  className="hands-send-btn"
                  style={{ background: '#dc3545', color: 'white', borderColor: '#dc3545' }}
                  title="Force Stop Agent"
                  onClick={stopAgent}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>
                </button>
              ) : (
                <button 
                  className="hands-send-btn" 
                  onClick={sendMessage}
                  disabled={(!input.trim() && selectedImages.length === 0)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode, fallback?: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode, fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("MessageContent render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{ color: 'red', padding: '10px', background: 'rgba(255,0,0,0.1)', borderRadius: '4px' }}>
          Error rendering message content: {this.state.error?.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function MessageContent({ text }: { text: string }) {
  let cleanText = text
    .replace(/```json\s*[\s\S]*?```/g, "")
    .replace(/ACTION:\s*\{[\s\S]*?\}(?:\n|$)/g, "")
    .replace(/<tool>[\s\S]*?<\/tool>/g, "")
    .replace(/\{\s*"action"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[^}]*\}\s*\}/g, "")
    .trim()

  const openBrace = cleanText.lastIndexOf('{');
  if (openBrace !== -1 && cleanText.indexOf('}', openBrace) === -1) {
    cleanText = cleanText.substring(0, openBrace).trim();
  }

  const hasText = cleanText.length > 0;

  return (
    <div className="hands-msg-text">
      {hasText && (
        <ErrorBoundary fallback={<div>{cleanText}</div>}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || "")
                return !inline && match ? (
                  <SyntaxHighlighter
                    {...props}
                    style={vscDarkPlus as any}
                    language={match[1]}
                    PreTag="div"
                  >
                    {String(children).replace(/\n$/, "")}
                  </SyntaxHighlighter>
                ) : (
                  <code {...props} className={className}>
                    {children}
                  </code>
                )
              }
            }}
          >
            {cleanText}
          </ReactMarkdown>
        </ErrorBoundary>
      )}
    </div>
  )
}

