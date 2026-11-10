import { useEffect, useState } from 'react';
import { useTranslation } from '../src/i18n/useTranslation';
import PanelCloseButton from './PanelCloseButton';
import './SettingsDialog.css';

const DEFAULT_SETTINGS = {
  IB_HOST: '127.0.0.1',
  IB_PORT: '4002',
  IB_CLIENT_ID: '1',
  IB_PORTFOLIO_SYNC_TIMEOUT_MS: '30000',
  IB_ORDER_ID_WAIT_TIMEOUT_MS: '15000',
  IB_OPEN_ORDERS_SYNC_TIMEOUT_MS: '15000',
  FINNHUB_KEY: '',
  OPENAI_BASE_URL: '',
  OPENAI_API_KEY: '',
  OPENAI_MODEL: '',
};
// The AI chat connection has its own backend route: it applies immediately and
// is available to browser clients, unlike the desktop-only general settings.
const AI_CONNECTION_KEYS = ['OPENAI_BASE_URL', 'OPENAI_API_KEY'];
const withoutAiConnection = values => Object.fromEntries(
  Object.entries(values || {}).filter(([key]) => !AI_CONNECTION_KEYS.includes(key)),
);

async function readSettingsResponse(response, fallbackMessage) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(fallbackMessage);
  }
  if (!data || typeof data !== 'object') throw new Error(fallbackMessage);
  if (!response.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

function SettingsDialog({ isOpen, onClose, activeMode = 'paper', ibConnected = false, onSelectTradingMode, onResetPaper = () => {}, paperError, paperReadOnly = false, showConnectionSettings = true, showAiConnection = true, onAiConnectionSaved = () => {} }) {
  const { t, language, setLanguage } = useTranslation();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [configuredSecrets, setConfiguredSecrets] = useState({});
  const [visibleSecrets, setVisibleSecrets] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [paperBalance, setPaperBalance] = useState('100000');
  const desktop = showConnectionSettings;

  const applyAiConnection = data => {
    setSettings(current => ({ ...current, OPENAI_BASE_URL: data.settings?.OPENAI_BASE_URL ?? '', OPENAI_API_KEY: '' }));
    setConfiguredSecrets(current => ({ ...current, OPENAI_API_KEY: Boolean(data.configuredSecrets?.OPENAI_API_KEY) }));
  };
  const applyDesktopSettings = data => {
    setSettings(current => ({ ...current, ...withoutAiConnection(data.settings) }));
    setConfiguredSecrets(current => ({ ...current, ...withoutAiConnection(data.configuredSecrets) }));
  };

  useEffect(() => {
    if (!isOpen || (!desktop && !showAiConnection)) return;
    const controller = new AbortController();
    const load = url => fetch(url, { signal: controller.signal })
      .then(response => readSettingsResponse(response, t('settingsLoadFailed')));
    setLoading(true);
    setMessage(null);

    Promise.all([
      showAiConnection && load('/api/settings/ai-connection').then(applyAiConnection),
      desktop && load('/api/settings').then(applyDesktopSettings),
    ])
      .catch(error => {
        if (error.name !== 'AbortError') setMessage({ type: 'error', text: error.message });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [desktop, isOpen, showAiConnection, t]);

  if (!isOpen) return null;

  const change = event => setSettings(current => ({ ...current, [event.target.name]: event.target.value }));
  const field = (name, label, options = {}) => (
    <div className="settings-field">
      <label htmlFor={`setting-${name}`}>{label}{options.required && <span aria-hidden="true"> *</span>}</label>
      <input
        id={`setting-${name}`}
        name={name}
        value={settings[name]}
        onChange={change}
        required={options.required}
        type={options.type || 'text'}
        min={options.min}
        max={options.max}
        autoComplete="off"
      />
      {options.hint && <small>{options.hint}</small>}
    </div>
  );
  const secretField = (name, label) => (
    <div className="settings-field">
      <label htmlFor={`setting-${name}`}>{label}</label>
      <span className="settings-secret-row">
        <input
          id={`setting-${name}`}
          name={name}
          value={settings[name]}
          onChange={change}
          type={visibleSecrets[name] ? 'text' : 'password'}
          placeholder={configuredSecrets[name] ? t('secretConfigured') : ''}
          autoComplete="off"
        />
        <button
          type="button"
          className="settings-secret-toggle"
          onClick={() => setVisibleSecrets(current => ({ ...current, [name]: !current[name] }))}
          aria-label={visibleSecrets[name] ? t('hideSecret') : t('showSecret')}
        >
          {visibleSecrets[name] ? t('hide') : t('show')}
        </button>
      </span>
      <small>{configuredSecrets[name] ? t('leaveBlankKeepSecret') : t('secretStoredLocally')}</small>
    </div>
  );

  const resetPaper = async () => {
    const balance = Number(paperBalance);
    if (!Number.isFinite(balance) || balance <= 0) {
      setMessage({ type: 'error', text: t('paperBalanceInvalid') });
      return;
    }
    if (!window.confirm(t('confirmPaperReset'))) return;
    try {
      await onResetPaper(balance);
      setMessage({ type: 'success', text: t('paperResetDone') });
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const save = async (url, values, apply, successText) => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      apply(await readSettingsResponse(response, t('settingsSaveFailed')));
      setMessage({ type: 'success', text: successText });
      return true;
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submit = event => {
    event.preventDefault();
    save('/api/settings', withoutAiConnection(settings), applyDesktopSettings, t('settingsSavedRestart'));
  };

  const submitAiConnection = async event => {
    event.preventDefault();
    const values = Object.fromEntries(AI_CONNECTION_KEYS.map(key => [key, settings[key]]));
    if (await save('/api/settings/ai-connection', values, applyAiConnection, t('aiConnectionSaved'))) onAiConnectionSaved();
  };

  return (
    <section id="settings-dialog-sidebar" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
      <header id="settings-dialog-header">
        <div className="settings-header-left">
          <div className="settings-badge">{t('configuration')}</div>
          <h2 id="settings-dialog-title">{t('settings')}</h2>
        </div>
        <PanelCloseButton onClick={onClose} label={t('closeSettings')} />
      </header>

      <div className="settings-general">
        <div className="settings-row">
          <span>{t('language')}</span>
          <button
            type="button"
            className="btn-language"
            onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
            aria-label={t('language')}
            title={language === 'en' ? t('traditionalChinese') : t('english')}
          >
            <span className={language === 'en' ? 'is-active' : ''}>EN</span>
            <span className={language === 'en' ? '' : 'is-active'}>繁</span>
          </button>
        </div>
        <div className="settings-row">
          <span>{t('tradingMode')}</span>
          <div className={`trading-mode-switch is-${activeMode}`} role="group" aria-label={t('tradingMode')}>
            <button
              type="button"
              className={activeMode === 'live' ? 'is-active' : ''}
              onClick={() => onSelectTradingMode('live')}
              disabled={!ibConnected}
              aria-pressed={activeMode === 'live'}
              title={!ibConnected ? t('liveUnavailable') : t('liveMode')}
            >{t('liveMode')}</button>
            <button
              type="button"
              className={activeMode === 'paper' ? 'is-active' : ''}
              onClick={() => onSelectTradingMode('paper')}
              aria-pressed={activeMode === 'paper'}
            >{t('paperMode')}</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="settings-loading" role="status"><span className="settings-spinner" />{t('loadingSettings')}</div>
      ) : (
        <div className="settings-form">
          {message && <div className={`settings-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>}

          <fieldset>
            <legend>{t('paperAccount')}</legend>
            <div className="settings-field">
              <label htmlFor="paper-starting-balance">{t('paperStartingBalance')}</label>
              <input id="paper-starting-balance" type="number" min="0.01" step="0.01" value={paperBalance} onChange={(event) => setPaperBalance(event.target.value)} />
              <small>{t('paperResetWarning')}</small>
            </div>
            {paperError && <div className="settings-message error" role="alert">{paperError}</div>}
            <button type="button" className="settings-save" onClick={resetPaper} disabled={paperReadOnly}>{t('resetPaperAccount')}</button>
          </fieldset>

          {showAiConnection && (
            <form className="settings-form" onSubmit={submitAiConnection}>
              <fieldset>
                <legend>{t('aiChatConnection')}</legend>
                {field('OPENAI_BASE_URL', t('openAiBaseUrl'), { type: 'url' })}
                {secretField('OPENAI_API_KEY', t('openAiApiKey'))}
                <button className="settings-save" type="submit" disabled={saving}>
                  {saving ? t('savingSettings') : t('saveAiConnection')}
                </button>
              </fieldset>
            </form>
          )}

          {desktop && <form className="settings-form" onSubmit={submit}>
          <fieldset>
            <legend>{t('ibConnection')}</legend>
            {field('IB_HOST', t('ibHost'), { required: true })}
            {field('IB_PORT', t('ibPort'), { required: true, type: 'number', min: 1, max: 65535, hint: t('ibPortHint') })}
            {field('IB_CLIENT_ID', t('ibClientId'), { required: true, type: 'number', min: 0 })}
          </fieldset>

          <fieldset>
            <legend>{t('marketAndAi')}</legend>
            {secretField('FINNHUB_KEY', t('finnhubApiKey'))}
            {field('OPENAI_MODEL', t('openAiModel'))}
          </fieldset>

          <details className="settings-advanced">
            <summary>{t('advancedTimeouts')}</summary>
            {field('IB_PORTFOLIO_SYNC_TIMEOUT_MS', t('portfolioTimeout'), { required: true, type: 'number', min: 1000, max: 300000 })}
            {field('IB_ORDER_ID_WAIT_TIMEOUT_MS', t('orderIdTimeout'), { required: true, type: 'number', min: 1000, max: 300000 })}
            {field('IB_OPEN_ORDERS_SYNC_TIMEOUT_MS', t('openOrdersTimeout'), { required: true, type: 'number', min: 1000, max: 300000 })}
          </details>

          <p className="settings-note">{t('settingsRestartNote')}</p>
          <button className="settings-save" type="submit" disabled={saving}>
            {saving ? t('savingSettings') : t('saveSettings')}
          </button>
          </form>}
        </div>
      )}
    </section>
  );
}

export default SettingsDialog;
