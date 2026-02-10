import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Model, ModelElement } from './lib/model'
import { generateId, createDefaultDecision } from './lib/model'

type MainContext = {
  model: Model
  setModel: Dispatch<SetStateAction<Model>>
}

const MainContext = createContext<MainContext | undefined>(undefined)

export function Wrapper({ children }: { children: React.ReactNode }) {
  const [model, setModel] = useState<Model>({
    id: generateId('model'),
    name: 'Benefits Eligibility',
    namespace: 'https://example.com/model',
    elements: {
      test: createDefaultDecision('test', 'test'),
    },
  })

  return (
    <MainContext.Provider value={{ model, setModel }}>
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

export function useElement(id: string): ModelElement {
  const { model } = useMainContext()

  const element = model.elements[id]

  if (element === undefined) {
    throw new Error(`Element with id '${id}' not found`)
  }

  return element
}

export function useUpdateElement() {
  const { setModel } = useMainContext()

  return (id: string, updater: (element: ModelElement) => ModelElement) => {
    setModel((model) => ({
      ...model,
      elements: {
        ...model.elements,
        [id]: updater(model.elements[id]),
      },
    }))
  }
}

export function useAddElement() {
  const { setModel } = useMainContext()

  return (id: string, element: ModelElement) => {
    setModel((model) => ({
      ...model,
      elements: {
        ...model.elements,
        [id]: element,
      },
    }))
  }
}
