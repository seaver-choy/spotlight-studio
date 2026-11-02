import { useEffect, useState, type ReactNode } from 'react'

export function Countdown(): ReactNode {
  const [n, setN] = useState(3)
  useEffect(() => {
    const id = setInterval(() => setN((v) => Math.max(1, v - 1)), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="grid h-full w-full place-items-center">
      <div
        key={n}
        className="grid h-48 w-48 place-items-center rounded-full bg-black/70 text-8xl font-bold text-white shadow-2xl"
        style={{ animation: 'pop 1s ease-out' }}
      >
        {n}
      </div>
      <style>{`@keyframes pop { from { transform: scale(1.25); opacity: 0.4 } 20% { transform: scale(1); opacity: 1 } }`}</style>
    </div>
  )
}
