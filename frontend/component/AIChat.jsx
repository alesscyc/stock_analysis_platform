import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../src/i18n/useTranslation';
import './AIChat.css';

const MARKET_FIELDS = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume', '10MA', '20MA', '50MA', '150MA', '200MA'];

function AIChat({ stockSymbol, stockData, currentInterval, fundamentals, aiPrediction, onReviewDraft }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const messagesRef = useRef(null);
  const requestRef = useRef(null);
  const modelsRequestRef = useRef(null);
  const modelsLoadedRef = useRef(false);
  const { t } = useTranslation();

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, loading]);

  useEffect(() => () => {
    requestRef.current?.abort();
    modelsRequestRef.current?.abort();
  }, []);

  const loadModels = async () => {
    if (modelsLoadedRef.current) return;
    modelsLoadedRef.current = true;
    setModelsLoading(true);
    setModelsError(null);

    const controller = new AbortController();
    modelsRequestRef.current = controller;

    try {
      const response = await fetch('/api/chat/models', { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('modelsFailed'));

      const availableModels = Array.isArray(data.models) ? data.models : [];
      if (data.defaultModel && !availableModels.includes(data.defaultModel)) {
        availableModels.unshift(data.defaultModel);
      }
      setModels(availableModels);
      setSelectedModel(data.defaultModel || availableModels[0] || '');
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        modelsLoadedRef.current = false;
        setModelsError(requestError.message || t('modelsFailed'));
      }
    } finally {
      if (!controller.signal.aborted) setModelsLoading(false);
      if (modelsRequestRef.current === controller) modelsRequestRef.current = null;
    }
  };

  const hasChart = Boolean(stockSymbol)
    && Array.isArray(stockData)
    && stockData.some((row) => row?.Date && row?.Close != null);
  const promptLabel = hasChart
    ? t('chatPlaceholder', { symbol: stockSymbol })
    : t('selectStockFirst');

  const sendMessage = async (event) => {
    event.preventDefault();
    const question = input.trim();
    if (!question || loading || !hasChart) return;

    const userMessage = { role: 'user', content: question };
    const requestMessages = [...messages, userMessage]
      .slice(-10)
      .map(({ role, content }) => ({ role, content }));
    const compactStockData = stockData
      .filter((row) => row?.Date && row?.Close != null)
      .map((row) => Object.fromEntries(
        MARKET_FIELDS
          .filter((field) => row[field] != null)
          .map((field) => [field, row[field]])
      ));

    setMessages((current) => [...current, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          symbol: stockSymbol,
          interval: currentInterval,
          model: selectedModel || undefined,
          messages: requestMessages,
          stockData: compactStockData,
          fundamentals,
          aiPrediction,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('chatFailed'));

      setMessages((current) => [...current, {
        role: 'assistant',
        content: data.answer,
        draftOrder: data.draftOrder,
      }]);
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setError(requestError.message || t('chatFailed'));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const toggleChat = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) loadModels();
  };

  return (
    <div className={`ai-chat-shell${isOpen ? ' ai-chat-open' : ''}`}>
      <section
        id="ai-chat-panel"
        className="ai-chat-panel"
        role="dialog"
        aria-label={t('aiChat')}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <header className="ai-chat-header">
          <div>
            <div className="ai-chat-title-row">
              <span className="ai-chat-pulse" />
              <h2>{t('aiChat')}</h2>
              {stockSymbol && <span className="ai-chat-symbol">{stockSymbol}</span>}
            </div>
            <span className="ai-chat-grounded">{t('loadedDataOnly')}</span>
          </div>
          <label className="ai-chat-model">
            <span>{t('model')}</span>
            <div>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={modelsLoading || loading}
                aria-label={t('model')}
                title={modelsError || selectedModel}
              >
                {modelsLoading && <option value="">{t('loadingModels')}</option>}
                {!modelsLoading && models.length === 0 && <option value="">{t('defaultModel')}</option>}
                {models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
              {modelsError && <span className="ai-chat-model-error" role="status" aria-label={modelsError}>!</span>}
            </div>
          </label>
        </header>

        <div ref={messagesRef} className="ai-chat-messages" aria-live="polite">
          {messages.length === 0 && (
            <div className="ai-chat-empty">
              <span className="ai-chat-empty-mark">AI</span>
              <p>{hasChart ? t('askAboutStock', { symbol: stockSymbol }) : t('selectStockFirst')}</p>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`ai-chat-message ai-chat-${message.role}`}>
              <span className="ai-chat-role">{message.role === 'user' ? t('you') : 'AI'}</span>
              <div>
                {message.content}
                {message.draftOrder && onReviewDraft && (
                  <button
                    type="button"
                    className="ai-chat-draft-button"
                    onClick={() => onReviewDraft(message.draftOrder)}
                  >
                    {t('reviewDraft')}
                  </button>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="ai-chat-message ai-chat-assistant ai-chat-thinking">
              <span className="ai-chat-role">AI</span>
              <div><span /><span /><span /> {t('thinking')}</div>
            </div>
          )}

          {error && <div className="ai-chat-error" role="alert">{error}</div>}
        </div>

        <form className="ai-chat-form" onSubmit={sendMessage}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={promptLabel}
            aria-label={promptLabel}
            maxLength={4000}
            rows={2}
            disabled={loading || !hasChart}
          />
          <button type="submit" disabled={loading || !hasChart || !input.trim()} aria-label={t('send')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </form>
        <p className="ai-chat-disclaimer">{t('chatDisclaimer')}</p>
      </section>

      <button
        type="button"
        className="ai-chat-toggle"
        onClick={toggleChat}
        aria-controls="ai-chat-panel"
        aria-expanded={isOpen}
        aria-label={isOpen ? t('closeAiChat') : t('openAiChat')}
      >
        <span>{t('aiChat')}</span>
        <svg className="ai-chat-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}

export default AIChat;
