import { createContext, useContext, useState, type Dispatch, type SetStateAction } from 'react'

type MainContext = {
  count: number
  setCount: Dispatch<SetStateAction<number>>
}

const MainContext = createContext<MainContext | undefined>(undefined)

export function Wrapper({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0)

  return (
    <MainContext.Provider value={{ count, setCount }}>
      {children}
    </MainContext.Provider>
  )
}

export function useMainContext(): MainContext {
  const context = useContext(MainContext)

  if (context === undefined) {
    throw new Error("'useMainContext' must be used within the Wrapper")
  }

  return context
}

