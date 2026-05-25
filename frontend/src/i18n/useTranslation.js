import { useContext, useCallback } from 'react';
import { I18nContext } from './I18nContext.js';
import { translations } from './translations';

export function useTranslation() {
  const { language, setLanguage } = useContext(I18nContext);

  const t = useCallback(
    (key, vars = {}) => {
      const dict = translations[language] || translations.en;
      let text = dict[key] ?? translations.en[key] ?? key;

      // Simple {{var}} interpolation
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{{${k}}}`, String(v));
      }

      return text;
    },
    [language]
  );

  return { t, language, setLanguage };
}
