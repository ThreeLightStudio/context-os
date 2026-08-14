import './styles.css'

import { createRoot } from 'react-dom/client'
import { App } from './App'
import type { ChromeSurface } from './types'

const root = document.getElementById('root')
const surface = (document.body.dataset.surface || 'sidepanel') as ChromeSurface

if (!root) {
  throw new Error('Context Shelf root element not found')
}

createRoot(root).render(<App surface={surface} />)
