/**
 * AI Assistant panel — floating button + slide-in chat drawer.
 * Accessible from any page. Scoped to pktHub's own registry/audit state
 * (the backend builds that context server-side, not the frontend).
 */
import { useState, useRef, useEffect } from 'react'
import { api } from '../api/client'

interface Message {
  role: 'user' | 'assistant'
  text: string
  error?: boolean
}

export default function AiAssistant() {
  const [open, setOpen]           = useState(false)
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const q = input.trim()
    if (!q || loading) return

    setInput('')
    setMessages(m => [...m, { role: 'user', text: q }])
    setLoading(true)

    try {
      const data = await api.aiChat(q)
      setMessages(m => [...m, { role: 'assistant', text: data.answer }])
    } catch (e: any) {
      setMessages(m => [...m, { role: 'assistant', text: e.message || 'Network error — could not reach AI service.', error: true }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="AI Assistant"
        className={`fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all ${
          open ? 'bg-gray-700 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
        }`}
      >
        {open ? '✕' : '✦'}
      </button>

      {open && (
        <div className="fixed bottom-20 right-6 z-40 w-96 max-w-[calc(100vw-3rem)] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col"
          style={{ height: '28rem' }}>

          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <span className="text-blue-400 text-sm">✦</span>
              <span className="text-sm font-semibold text-white">AI Assistant</span>
              <span className="text-xs text-gray-500">Claude</span>
            </div>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} className="text-xs text-gray-500 hover:text-white transition-colors">
                Clear
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
            {messages.length === 0 && (
              <div className="text-gray-500 text-xs space-y-2">
                <p>Ask about pktHub's registry, app health, or audit log:</p>
                {[
                  'Which registered apps are unhealthy right now?',
                  'What happened in the audit log recently?',
                  'Which apps are in managed mode?',
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="block text-left text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 w-full transition-colors text-xs"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : m.error
                      ? 'bg-red-900/40 text-red-300 border border-red-700/40'
                      : 'bg-gray-800 text-gray-200'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 rounded-xl px-3 py-2 text-xs text-gray-400 animate-pulse">
                  Thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="px-4 py-3 border-t border-gray-800 flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={loading}
              placeholder="Ask about pktHub…"
              rows={1}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm transition-colors"
            >
              →
            </button>
          </div>
        </div>
      )}
    </>
  )
}
