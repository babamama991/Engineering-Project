import { useLang } from '../i18n.jsx';
import api from '../api/client.js';

export default function LangToggle({ subtle = false }) {
  const { lang, setLang } = useLang();

  const switchTo = (next) => {
    setLang(next);
    // Remember the choice server-side too, so a new device starts right.
    api.post('/auth/language', { lang: next }).catch(() => {});
  };

  return (
    <button
      type="button"
      className={subtle ? 'lang-toggle subtle' : 'lang-toggle'}
      onClick={() => switchTo(lang === 'en' ? 'ar' : 'en')}
      aria-label="Switch language"
    >
      {lang === 'en' ? 'ع' : 'EN'}
    </button>
  );
}
