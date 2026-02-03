import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
} from 'react'

// NOTE: don't forget to update the Clerk localizations
export const LANGUAGES = ['en', 'es'] as const
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  es: 'Español',
}
export const DEFAULT_LANGUAGE = 'en' as const

export type DefaultLanguage = typeof DEFAULT_LANGUAGE
export type Language = (typeof LANGUAGES)[number]

export type LanguageContextType = {
  lang: Language
  setLang: Dispatch<SetStateAction<Language>>
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
)

export function LanguageWrapper({ children }: PropsWithChildren) {
  const storedLang = localStorage.getItem('lang')

  let initialLang: Language = DEFAULT_LANGUAGE
  if (LANGUAGES.includes(storedLang as Language)) {
    initialLang = storedLang as Language
  }

  const [lang, setLang] = useState<Language>(initialLang)

  useEffect(() => {
    localStorage.setItem('lang', lang)
  }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguageContext(): LanguageContextType {
  const context = useContext(LanguageContext)

  if (context === undefined) {
    throw new Error("'useLanguageContext' must be used within the Wrapper")
  }

  return context
}

export type TranslatableText = Partial<Record<Language, string>> &
  Record<DefaultLanguage, string>

export function useText() {
  const { lang } = useLanguageContext()

  return (
    text: TranslatableText,
    data?: Record<string, string | number | undefined>
  ) => {
    let translatedText = text[lang]

    if (translatedText === undefined) {
      console.error(
        `Missing translation for ${lang}. Falling back to: ${text[DEFAULT_LANGUAGE]}\n${new Error().stack}`
      )
      translatedText = text[DEFAULT_LANGUAGE]
    }

    if (data) {
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          const value = data[key]
          translatedText = translatedText.replace(
            new RegExp(`\\{${key}\\}`, 'g'),
            String(value)
          )
        }
      }
    }

    return translatedText
  }
}

type TextProps = {
  text: TranslatableText
  data?: Record<string, string | number | undefined>
}

export function Text({ text, data }: TextProps) {
  const textFunc = useText()

  return textFunc(text, data)
}
