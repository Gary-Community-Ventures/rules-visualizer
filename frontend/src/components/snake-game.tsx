import { useEffect, useState, useCallback, useRef } from 'react'
import { useLocalStorage } from '@/lib/use-local-storage'

const WIDTH = 20
const HEIGHT = 4
const BRAILLE_BASE = 0x2800
const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

type Point = { x: number; y: number }
type Direction = 'up' | 'down' | 'left' | 'right'

function pointsEqual(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y
}

function spawnFood(snake: Point[]): Point {
  let food: Point
  do {
    food = {
      x: Math.floor(Math.random() * WIDTH),
      y: Math.floor(Math.random() * HEIGHT),
    }
  } while (snake.some((s) => pointsEqual(s, food)))
  return food
}

function renderBraille(snake: Point[], food: Point): string {
  const grid: number[][] = Array.from({ length: HEIGHT }, () =>
    Array(WIDTH).fill(0)
  )

  for (const { x, y } of snake) {
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) grid[y][x] = 1
  }
  if (food.x >= 0 && food.x < WIDTH && food.y >= 0 && food.y < HEIGHT) {
    grid[food.y][food.x] = 2
  }

  let out = ''
  for (let col = 0; col < WIDTH; col += 2) {
    let dots = 0
    for (let row = 0; row < Math.min(HEIGHT, 4); row++) {
      for (let subCol = 0; subCol < 2; subCol++) {
        const x = col + subCol
        if (x < WIDTH && grid[row][x]) {
          dots |= DOTS[row][subCol]
        }
      }
    }
    out += String.fromCharCode(BRAILLE_BASE + dots)
  }
  return out
}

const OPPOSITES: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

export function SnakeLoader() {
  const [snake, setSnake] = useState<Point[]>([
    { x: 5, y: 1 },
    { x: 4, y: 1 },
    { x: 3, y: 1 },
  ])
  const [food, setFood] = useState<Point>({ x: 15, y: 2 })
  const [direction, setDirection] = useState<Direction>('right')
  const [gameOver, setGameOver] = useState(false)
  const [highScore, setHighScore] = useLocalStorage('snake-highscore', 0)
  const nextDirRef = useRef(direction)
  const lastMovedRef = useRef(direction)
  const lastTickRef = useRef(Date.now())

  const tick = useCallback(() => {
    setSnake((prev) => {
      const head = prev[0]
      const d = nextDirRef.current
      lastMovedRef.current = d
      const delta = {
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
      }[d]
      const newHead = {
        x: (head.x + delta.x + WIDTH) % WIDTH,
        y: (head.y + delta.y + HEIGHT) % HEIGHT,
      }

      const ateFood = pointsEqual(newHead, food)
      const body = ateFood ? prev : prev.slice(0, -1)

      if (body.some((s) => pointsEqual(s, newHead))) {
        setGameOver(true)
        return prev
      }

      const newSnake = [newHead, ...prev]
      if (ateFood) {
        setFood(spawnFood(newSnake))
      } else {
        newSnake.pop()
      }
      return newSnake
    })
  }, [food])

  const reset = useCallback(() => {
    const initial = [
      { x: 5, y: 1 },
      { x: 4, y: 1 },
      { x: 3, y: 1 },
    ]
    setSnake(initial)
    setFood(spawnFood(initial))
    setDirection('right')
    nextDirRef.current = 'right'
    lastMovedRef.current = 'right'
    setGameOver(false)
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
        return

      if (gameOver) {
        reset()
        return
      }

      e.preventDefault()
      const keyToDir: Record<string, Direction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      }
      const newDir = keyToDir[e.key]
      if (newDir && newDir !== OPPOSITES[lastMovedRef.current]) {
        nextDirRef.current = newDir
        setDirection(newDir)
        tick()
        lastTickRef.current = Date.now()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [gameOver, reset, tick])

  useEffect(() => {
    if (gameOver) {
      const score = snake.length - 3
      if (score > highScore) {
        setHighScore(score)
      }
      return
    }

    const interval = setInterval(() => {
      const now = Date.now()
      if (now - lastTickRef.current >= 100) {
        lastTickRef.current = now
        tick()
      }
    }, 100)

    return () => clearInterval(interval)
  }, [gameOver, snake.length, highScore, setHighScore, tick])

  const display = renderBraille(snake, food)
  const score = snake.length - 3

  return (
    <span className="font-mono text-sm select-none whitespace-nowrap inline-flex items-center gap-2">
      <span className="tracking-tight border rounded px-1">{display}</span>
      <span className="text-muted-foreground">
        [{score}] hi:{highScore}
        {gameOver && ' [gg]'}
      </span>
    </span>
  )
}
