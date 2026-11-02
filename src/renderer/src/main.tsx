import { StrictMode, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Home } from './home/Home'
import { ControlBar } from './recorder/ControlBar'
import { CameraBubble } from './recorder/CameraBubble'
import { Countdown } from './recorder/Countdown'
import { Editor } from './editor/Editor'

function route(): string {
  return window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'home'
}

const views: Record<string, () => ReactElement> = {
  home: () => <Home />,
  bar: () => <ControlBar />,
  bubble: () => <CameraBubble />,
  countdown: () => <Countdown />,
  editor: () => <Editor />
}

const r = route()
document.documentElement.dataset.route = r
const View = views[r] ?? views.home

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <View />
  </StrictMode>
)
