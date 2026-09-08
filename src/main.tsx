import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './style.css'
import './features.css'
import { enableAnonymousRider } from './optionalRider'
createRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>)
enableAnonymousRider()
