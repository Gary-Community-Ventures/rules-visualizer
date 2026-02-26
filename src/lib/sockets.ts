import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL

export function useSocket(): Socket {
  const [socket] = useState<Socket>(() => {
    return io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })
  })

  return socket
}

export function useSocketEvent<T extends any[]>(
  socket: Socket,
  eventName: string,
  callback: (...data: T) => void
): void {
  useEffect(() => {
    socket.on(eventName, callback)
    return () => {
      socket.off(eventName, callback)
    }
  }, [socket, eventName])
}
