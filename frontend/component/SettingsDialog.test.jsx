import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';
import SettingsDialog from './SettingsDialog';

describe('SettingsDialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads settings and saves changed values without exposing stored secrets', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
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
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await screen.findByText('Settings saved. Restart the app to apply them.');
    const saveCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
    const body = JSON.parse(saveCall[1].body);
    expect(body.IB_PORT).toBe('7497');
    expect(body.FINNHUB_KEY).toBe('');
    expect(body.OPENAI_API_KEY).toBe('new-secret');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
