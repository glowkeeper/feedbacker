import { openDB, deleteDB, IDBPDatabase } from 'idb';

import { dB, dBase as dBaseTables } from '@/app/config'

import type { Table } from '@/app/store/types'

const createDbase = (dBase: IDBPDatabase) => {

    try {

        Object.keys(dBaseTables).map(table => {

            // Checks if the object store exists:
            console.log('Need to create store',  dBaseTables[`${table}`].name, "?")
    
            if (dBase.objectStoreNames.contains(dBaseTables[`${table}`].name)) {

                // might wanna consider migrating data, too
                console.log('Deleting old object store',  dBaseTables[`${table}`].name)
                dBase.deleteObjectStore(dBaseTables[`${table}`].name)
            }

            const tableName = dBaseTables[`${table}`].name
            const key = dBaseTables[`${table}`].key
            // const tableKey = `${tableName}.${key}`
                
            // If the object store does not exist, create it:
            console.log('Creating a new object store', tableName, key);            

            dBase.createObjectStore(tableName, { keyPath: key, autoIncrement: false })
            
        })

    } catch (error) {
        console.error('createDbase', error)
    }    
}

export const deleteDbase = async () => await deleteDB(dB.name);

// call this first
export const openDbase = async () => {

    try {
        
        const db = await openDB(dB.name, dB.version, {

            upgrade (dBase) {                

                createDbase(dBase)
            }
        })

        return db

    } catch (error) {
        console.error('openDbase', error)
        return null
    }
}

export const initStore = async (dBase: IDBPDatabase, table: string) => {

    try {
        
        // Create a transaction on the store in read/write mode:
        const tx = dBase.transaction(table, 'readwrite')
    
        // Add data to store
        await tx.store.clear()
        await tx.done   

    } catch (error) {
        console.error('initStore', error)
    }
}

export const addData = async (dBase: IDBPDatabase, table: string, data: Table) => {

    try {
        
        // Create a transaction on the store in read/write mode:
        const tx = dBase.transaction(table, 'readwrite')
    
        // Add data to store
        await tx.store.add(data)
        await tx.done   

    } catch (error) {
        console.error('addData', error)
    }
}

export const deleteData = async (dBase: IDBPDatabase, table: string, key: string) => {

//console.log('deleting', key)
    try {  

        // Create a transaction on the store in read/write mode:
        const tx = dBase.transaction(table, 'readwrite')

        // Delete a value 
        await tx.store.delete(key)
        await tx.done

    } catch (error) {
        console.error('deleteData', error)
    }
}

export const updateData = async (dBase: IDBPDatabase, table: string, data: Table) => {

    //console.log('update', store, data)

    try {
        
        // Create a transaction on the store in read/write mode:
        const tx = dBase.transaction(table, 'readwrite')

        // Add data to store
        await tx.store.put(data)
        await tx.done

    } catch (error) {
        console.error('updateData', error)
    }
}  

export const getAllData = async (dBase: IDBPDatabase, table: string) => {

    // Get all values
    const data = await dBase.getAll(table)
    //console.log('this data', store, data)
    return data
}

export const getAllKeys = async (dBase: IDBPDatabase, table: string) => {

    // Get all keys
    const data = await dBase.getAllKeys(table)
    //console.log('this data', data)
    return data
}

export const getData = async (dBase: IDBPDatabase, table: string, key: string | number) => {

// Get a value from the object store by its primary key value:
    const data = await dBase.get(table, key);
    return data
}
  

