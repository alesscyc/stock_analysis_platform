import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';
import SettingsDialog from './SettingsDialog';

describe('SettingsDialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads settings and saves changed values without exposing stored secrets', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (url === '/api/settings/ai-connection') {
        return { ok: true, json: async () => ({ settings: { OPENAI_BASE_URL: '' }, configuredSecrets: { OPENAI_API_KEY: false } }) };
      }
      if (options?.method === 'PUT') {
        return {
          ok: true,
          json: async () => ({
            settings: { IB_HOST: '127.0.0.1', IB_PORT: '7497', IB_CLIENT_ID: '1' },
            configuredSecrets: { FINNHUB_KEY: true, OPENAI_API_KEY: true },
            restartRequired: true,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          settings: { IB_HOST: '127.0.0.1', IB_PORT: '4002', IB_CLIENT_ID: '1' },
          configuredSecrets: { FINNHUB_KEY: true, OPENAI_API_KEY: false },
        }),
      };
    });

    render(<I18nProvider><SettingsDialog isOpen onClose={() => {}} /></I18nProvider>);

    const port = await screen.findByLabelText(/Socket port/);
    expect(port).toHaveValue(4002);
    expect(screen.getByLabelText('Finnhub API key')).toHaveValue('');
    expect(screen.getByPlaceholderText('Configured — leave blank to keep')).toHaveValue('');

    fireEvent.change(port, { target: { value: '7497' } });
    fireEvent.change(screen.getByLabelText('Finnhub API key'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await screen.findByText('Settings saved. Restart the app to apply them.');
    const saveCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(saveCall[0]).toBe('/api/settings');
    const body = JSON.parse(saveCall[1].body);
    expect(body.IB_PORT).toBe('7497');
    expect(body.FINNHUB_KEY).toBe('new-secret');
    expect(body).toHaveProperty('OPENAI_MODEL');
    expect(body).not.toHaveProperty('OPENAI_BASE_URL');
    expect(body).not.toHaveProperty('OPENAI_API_KEY');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('shows the AI chat connection in the browser and saves it without exposing the key', async () => {
    const onAiConnectionSaved = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      expect(url).toBe('/api/settings/ai-connection');
      const savedUrl = options?.method === 'PUT' ? 'https://new.example/v1' : 'https://old.example/v1';
      return { ok: true, json: async () => ({ settings: { OPENAI_BASE_URL: savedUrl }, configuredSecrets: { OPENAI_API_KEY: true } }) };
    });

    render(<I18nProvider><SettingsDialog isOpen onClose={() => {}} showConnectionSettings={false} onAiConnectionSaved={onAiConnectionSaved} /></I18nProvider>);

    const url = await screen.findByLabelText('OpenAI-compatible base URL');
    expect(url).toHaveValue('https://old.example/v1');
    const key = screen.getByLabelText('API key');
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('placeholder', 'Configured — leave blank to keep');
    expect(screen.queryByLabelText(/Socket port/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();

    fireEvent.change(url, { target: { value: 'https://new.example/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save AI connection' }));

    await screen.findByText('AI chat connection saved. New chat requests use it now.');
    const saveCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(JSON.parse(saveCall[1].body)).toEqual({ OPENAI_BASE_URL: 'https://new.example/v1', OPENAI_API_KEY: '' });
    expect(onAiConnectionSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('reports failed AI connection saves without signalling a change', async () => {
    const onAiConnectionSaved = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => (options?.method === 'PUT'
      ? { ok: false, json: async () => ({ error: 'Invalid value for OPENAI_BASE_URL' }) }
      : { ok: true, json: async () => ({ settings: { OPENAI_BASE_URL: '' }, configuredSecrets: { OPENAI_API_KEY: false } }) }));

    render(<I18nProvider><SettingsDialog isOpen onClose={() => {}} showConnectionSettings={false} onAiConnectionSaved={onAiConnectionSaved} /></I18nProvider>);

    fireEvent.change(await screen.findByLabelText('API key'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save AI connection' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid value for OPENAI_BASE_URL');
    expect(onAiConnectionSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('API key')).toHaveValue('secret');
  });

  it('labels the AI chat connection in Traditional Chinese', async () => {
    localStorage.setItem('stockai-language', 'zh');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ settings: { OPENAI_BASE_URL: '' }, configuredSecrets: { OPENAI_API_KEY: false } }),
    });

    render(<I18nProvider><SettingsDialog isOpen onClose={() => {}} showConnectionSettings={false} /></I18nProvider>);

    expect(await screen.findByLabelText('OpenAI 相容服務網址')).toBeInTheDocument();
    expect(screen.getByText('AI 對話連線')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '儲存 AI 連線' })).toBeInTheDocument();
    localStorage.removeItem('stockai-language');
  });

  it('reports localized errors for malformed load and save responses', async () => {
    const notJson = { json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, ...notJson })
      .mockResolvedValueOnce({ ok: true, json: async () => null });

    render(<I18nProvider><SettingsDialog isOpen onClose={() => {}} showConnectionSettings={false} /></I18nProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load settings');
    fireEvent.click(screen.getByRole('button', { name: 'Save AI connection' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to save settings'));
    expect(screen.queryByText(/Unexpected token|null/)).not.toBeInTheDocument();
  });

  it('hides the AI chat connection without a backend', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<I18nProvider><SettingsDialog isOpen onClose={() => {}} showConnectionSettings={false} showAiConnection={false} /></I18nProvider>);
    expect(screen.queryByLabelText('OpenAI-compatible base URL')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
