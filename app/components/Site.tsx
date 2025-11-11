'use client'

import React, { useMemo, useEffect } from "react"

import { Header } from '@/app/components/Header'
import { Footer } from '@/app/components/Footer'

import { openDbase } from '@/app/utils/dbase'

import {
  StoreContext,
  StoreAction,
  rootReducer,
  initialState,
  useReducerWithThunk
} from '@/app/store/store'

export const Site = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {

  const [state, dispatch] = useReducerWithThunk(rootReducer, initialState)
  const store = useMemo(() => {
    return { state: state, dispatch: dispatch }
  }, [state, dispatch]) 

  useEffect(() => {
  
    const doDBaseOps = async () => {

      if (!store.state.db) {

        const db = await openDbase()
        store.dispatch({
          type: StoreAction.DBOpen,
          payload: db
        })

      }
    }

    doDBaseOps()

  }, [store])

  return (    
    <StoreContext.Provider value={store}>
      <Header /> 
      <main>           
        {children}
      </main>  
      <Footer />
    </StoreContext.Provider>
  )
}
