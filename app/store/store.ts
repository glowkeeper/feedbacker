'use client'

import React, { useReducer } from 'react'

export type Store = {
  state: AppState
  dispatch: (action: (() => void) | AppAction) => void
} | null

export const StoreContext = React.createContext<Store>(null)

export enum StoreAction {
  TitleInit = 'title/init',
  TitleSet = 'title/set'
}

export type TitleAction = {
  type: StoreAction
  payload: string
}

export type AppAction = TitleAction

export type AppState = {
  title: string
}

export const initialState: AppState = {
  title: '',
}

export const titleReducer = (state: string, action: AppAction): string => {
  switch (action.type) {
    case StoreAction.TitleInit:
      return action.payload as string
    case StoreAction.TitleSet:
      return (action as TitleAction).payload
    default:
      return state
  }
}

export const useReducerWithThunk = (
  reducer: (state: AppState, action: AppAction) => AppState,
  initialState: AppState,
): [AppState, (action: (() => void) | AppAction) => void] => {
  const [state, dispatch] = useReducer(reducer, initialState)

  const customDispatch = (action: (() => void) | AppAction) => {
    if (typeof action === 'function') {
      action()
    } else {
      dispatch(action)
    }
  }

  return [state, customDispatch]
}

const combineReducers = (reducers: {
  title: (state: string, action: AppAction) => string
}) => {
  return (state: AppState = initialState, action: AppAction): AppState => {
    return {
      title: reducers.title(state.title, action),
    }
  }
}

export const rootReducer = combineReducers({
  title: titleReducer,
})
