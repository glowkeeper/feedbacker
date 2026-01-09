'use client'

import React, { useMemo } from "react"

import { Header } from '@/app/components/Header'
import { Footer } from '@/app/components/Footer'


import {
  StoreContext,
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
