'use client'

import React, { useReducer } from 'react'
import { IDBPDatabase } from 'idb';

export type Store = {
  state: AppState
  dispatch: (action: (() => void) | AppAction) => void
} | null

export const StoreContext = React.createContext<Store>(null)

export enum StoreAction {
  TitleInit = 'title/init',
  TitleSet = 'title/set',
  DBOpen = 'db/open',
  DBClose = 'db/close',
  TableUpdate = 'table/update',
}

export type TitleAction = {
  type: StoreAction
  payload: string
}

export type DBAction = {
  type: StoreAction
  payload: IDBPDatabase | null
}

export type TableAction = {
  type: StoreAction
  payload: boolean
}

export type AppAction = TitleAction | DBAction | TableAction

export type AppState = {
  title: string
  db: IDBPDatabase | null
  tableToggle: boolean
}

export const initialState: AppState = {
  title: '',
  db: null,
  tableToggle: false
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

export const dbReducer = (state: IDBPDatabase, action: AppAction): IDBPDatabase | null => {
  switch (action.type) {
    case StoreAction.DBOpen:
      //console.log('open db') 
      return action.payload as IDBPDatabase
    case StoreAction.DBClose:
      return null
    default:
      return state
  }
}

export const tableReducer = (state: boolean, action: AppAction): boolean => {
  switch (action.type) {
    case StoreAction.TableUpdate:
      return !state
    default:
      return false
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
  db:  (state: IDBPDatabase, action: AppAction) => IDBPDatabase | null
  tableToggle: (state: boolean, action: AppAction) => boolean
}) => {
  return (state: AppState = initialState, action: AppAction): AppState => {
    return {
      title: reducers.title(state.title, action),
      db: reducers.db(state.db as IDBPDatabase, action),
      tableToggle: reducers.tableToggle(state.tableToggle, action)
    }
  }
}

export const rootReducer = combineReducers({
  title: titleReducer,
  db: dbReducer,
  tableToggle: tableReducer
})
