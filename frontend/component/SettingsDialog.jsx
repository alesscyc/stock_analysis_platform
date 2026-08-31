import { useEffect, useState } from 'react';
import { useTranslation } from '../src/i18n/useTranslation';
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

function SettingsDialog({ isOpen, onClose }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [configuredSecrets, setConfiguredSecrets] = useState({});
  const [visibleSecrets, setVisibleSecrets] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoading(true);
    setMessage(null);

    fetch('/api/settings', { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t('settingsLoadFailed'));
        setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
        setConfiguredSecrets(data.configuredSecrets || {});
      })
      .catch(error => {
        if (error.name !== 'AbortError') setMessage({ type: 'error', text: error.message });
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [isOpen, t]);

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

  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('settingsSaveFailed'));
      setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      setConfiguredSecrets(data.configuredSecrets || {});
      setMessage({ type: 'success', text: t('settingsSavedRestart') });
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="settings-dialog-sidebar" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
      <header id="settings-dialog-header">
        <div>
          <div className="settings-badge">{t('configuration')}</div>
          <h2 id="settings-dialog-title">{t('settings')}</h2>
        </div>
        <button id="settings-dialog-close" onClick={onClose} aria-label={t('closeSettings')}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      {loading ? (
        <div className="settings-loading" role="status"><span className="settings-spinner" />{t('loadingSettings')}</div>
      ) : (
        <form className="settings-form" onSubmit={submit}>
          {message && <div className={`settings-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>}

          <fieldset>
            <legend>{t('ibConnection')}</legend>
            {field('IB_HOST', t('ibHost'), { required: true })}
            {field('IB_PORT', t('ibPort'), { required: true, type: 'number', min: 1, max: 65535, hint: t('ibPortHint') })}
            {field('IB_CLIENT_ID', t('ibClientId'), { required: true, type: 'number', min: 0 })}
          </fieldset>

          <fieldset>
            <legend>{t('marketAndAi')}</legend>
            {secretField('FINNHUB_KEY', t('finnhubApiKey'))}
            {field('OPENAI_BASE_URL', t('openAiBaseUrl'), { type: 'url' })}
            {secretField('OPENAI_API_KEY', t('openAiApiKey'))}
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
        </form>
      )}
    </section>
  );
}

export default SettingsDialog;
