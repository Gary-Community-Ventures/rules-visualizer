import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL

export const socket: Socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
})

export function useSocketEvent<T extends unknown[]>(
  socket: Socket,
  eventName: string,
  callback: (...data: T) => void
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const handler = (...args: T) => callbackRef.current(...args)
    socket.on(eventName, handler)
    return () => {
      socket.off(eventName, handler)
    }
  }, [socket, eventName])
}
