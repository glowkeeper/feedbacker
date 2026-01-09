'use client'

import React, { useReducer } from 'react'

export type Store = {
  state: AppState
  dispatch: (action: (() => void) | AppAction) => void
} | null

export const StoreContext = React.createContext<Store>(null)

export enum StoreAction {
  TitleInit = 'title/init',
  TitleSet = 'title/set',
  RubricInit = 'rubric/init',
  RubricSet = 'rubric/set',
  StudentInit = 'student/init',
  StudentSet = 'student/set',
  CommentedRubricInit = 'commented/init',
  CommentedRubricSet = 'commented/set',
}

export type TitleAction = {
  type: StoreAction
  payload: string
}

export type RubricAction = {
  type: StoreAction
  payload: string
}

export type StudentAction = {
  type: StoreAction
  payload: string
}

export type CommentedAction = {
  type: StoreAction
  payload: string
}

export type AppAction = TitleAction | RubricAction | StudentAction | CommentedAction

export type AppState = {
  title: string
  rubric: string
  student: string
  commented: string
}

export const initialState: AppState = {
  title: '',
  rubric: '',
  student: '',
  commented: '',
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

export const rubricReducer = (state: string, action: AppAction): string => {
  switch (action.type) {
    case StoreAction.RubricInit:
      return ''
    case StoreAction.RubricSet:
      return (action as RubricAction).payload
    default:
      return state
  }
}

export const studentReducer = (state: string, action: AppAction): string => {
  switch (action.type) {
    case StoreAction.StudentInit:
      return ''
    case StoreAction.StudentSet:
      return (action as StudentAction).payload
    default:
      return state
  }
}

export const commentedReducer = (state: string, action: AppAction): string => {
  switch (action.type) {
    case StoreAction.CommentedRubricInit:
      return ''
    case StoreAction.CommentedRubricSet:
      return (action as CommentedAction).payload
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
  rubric: (state: string, action: AppAction) => string
  student: (state: string, action: AppAction) => string
  commented: (state: string, action: AppAction) => string
}) => {
  return (state: AppState = initialState, action: AppAction): AppState => {
    return {
      title: reducers.title(state.title, action),      
      rubric: reducers.rubric(state.rubric, action),     
      student: reducers.student(state.student, action),     
      commented: reducers.commented(state.commented, action),     
    }
  }
}

export const rootReducer = combineReducers({
  title: titleReducer,     
  rubric: rubricReducer,     
  student: studentReducer,     
  commented: commentedReducer,     
})
